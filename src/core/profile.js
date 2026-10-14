// Imported taste from the user's public AniList or MyAnimeList list: what they've seen
// (even outside Crunchyroll) and how they scored it. Used to mark series as seen and as
// strong positive / negative signals for recommendations.
//   · AniList: public GraphQL (MediaListCollection by user name), straight from here.
//   · MyAnimeList: the public list JSON, fetched by the extension's background worker
//     (myanimelist.net doesn't allow cross-origin requests from web pages).
// Entries are mapped to Crunchyroll series through the AniList data CR+ already has;
// anything left is resolved through AniList's links to Crunchyroll.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.profile = (() => {
  const store = CRP.store;
  const KEY = 'profile:import';
  const ANILIST = 'https://graphql.anilist.co';
  let data = null;   // { source, user, ts, total, items: { [crId]: { s, st } } }

  async function load() {
    data = (await store.localGet(KEY)) || null;
    return data;
  }
  const active = () => !!(data && data.items && store.get().useImport !== false);
  const get = (id) => (active() ? data.items[id] || null : null);
  const seen = (id) => { const e = get(id); return !!e && e.st !== 'planning'; };
  const entries = () => (active() ? Object.entries(data.items).map(([id, e]) => ({ id, ...e })) : []);

  function summary() {
    if (!data) return null;
    const all = Object.values(data.items || {});
    return { source: data.source, user: data.user, ts: data.ts, total: data.total, mapped: all.length, scored: all.filter((e) => e.s != null).length };
  }

  async function gql(query, variables) {
    const res = await fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
    const j = await res.json();
    if (j.errors && !j.data) {
      const msg = j.errors.map((e) => e.message).join('; ');
      throw new Error(/private/i.test(msg) ? t('La lista es privada: hazla pública en los ajustes de AniList.') : /not found/i.test(msg) ? t('No existe ese usuario en AniList.') : msg);
    }
    return j.data;
  }

  // Crunchyroll series id from an AniList external link (new or old URL style).
  function crIdFromLinks(links, bySlug) {
    for (const l of links || []) {
      let u;
      try { u = new URL(l.url); } catch (e) { continue; }
      if (!/crunchyroll\.com$/.test(u.hostname)) continue;
      const m = u.pathname.match(/\/series\/([A-Z0-9]{8,})/);
      if (m) return m[1];
      const seg = u.pathname.split('/').filter(Boolean);
      if (seg.length === 1 && bySlug.has(seg[0].toLowerCase())) return bySlug.get(seg[0].toLowerCase());
    }
    return null;
  }

  // AniList ids (or MAL ids) the local map doesn't know -> Crunchyroll ids, first via
  // AniList's links to Crunchyroll, then by exact title + launch year (±1) against the
  // catalog. Links to a *related* entry (sequel, film) are deliberately not used: they'd
  // mark e.g. "Dragon Ball Super" as seen because you watched "Dragon Ball Z".
  const flat = (s) => CRP.util.norm(s).replace(/[^a-z0-9]/g, '');
  async function linkUnmapped(ids, field) {
    const index = CRP.catalog.current();
    if (!index || !ids.length) return new Map();
    const bySlug = new Map(index.items.map((x) => [x.slug.toLowerCase(), x.id]));
    const byTitle = new Map();
    for (const x of index.items) {
      for (const k of [flat(x.title), flat(x.slug.replace(/-/g, ' '))]) {
        if (k.length > 2) (byTitle.get(k) || byTitle.set(k, []).get(k)).push(x);
      }
    }
    const out = new Map();
    const arg = field === 'mal' ? 'idMal_in' : 'id_in';
    for (let i = 0; i < ids.length; i += 50) {
      const d = await gql(`query ($ids: [Int]) { Page(perPage: 50) { media(${arg}: $ids, type: ANIME) { id idMal format title { english romaji } synonyms startDate { year } externalLinks { url } } } }`, { ids: ids.slice(i, i + 50) });
      for (const m of (d.Page && d.Page.media) || []) {
        let cr = crIdFromLinks(m.externalLinks, bySlug);
        if (!cr) {
          const names = [m.title.english, m.title.romaji, ...(m.synonyms || [])].map(flat).filter((n) => n.length > 2);
          const hits = [...new Set(names.flatMap((n) => byTitle.get(n) || []))]
            .filter((x) => !x.year || !m.startDate.year || Math.abs(x.year - m.startDate.year) <= 1)
            .filter((x) => (m.format === 'MOVIE') === (x.kind === 'movie_listing'));
          if (hits.length === 1) cr = hits[0].id;
        }
        if (cr && index.byId.has(cr)) out.set(field === 'mal' ? m.idMal : m.id, cr);
      }
      await new Promise((r) => setTimeout(r, 2100));
    }
    return out;
  }

  const RANK = { watching: 5, completed: 4, paused: 3, dropped: 2, planning: 1 };
  function aggregate(rows) {
    // rows: [{ cr, s (0-100|null), st }] — several AniList/MAL entries can be seasons of one series
    const items = {};
    for (const r of rows) {
      const cur = items[r.cr];
      if (!cur) { items[r.cr] = { s: r.s, st: r.st, n: 1 }; continue; }
      if (r.s != null) cur.s = cur.s == null ? r.s : Math.round((cur.s * cur.n + r.s) / (cur.n + 1));
      cur.n += 1;
      if (RANK[r.st] > RANK[cur.st]) cur.st = r.st;
    }
    for (const v of Object.values(items)) delete v.n;
    return items;
  }

  async function importAniList(user, onStep) {
    await Promise.all([CRP.catalog.load(), CRP.ext.load()]);
    onStep && onStep(t('Leyendo tu lista de AniList…'));
    const d = await gql(`query ($u: String) { MediaListCollection(userName: $u, type: ANIME) { user { name } lists { entries { mediaId status score(format: POINT_100) } } } }`, { u: user });
    const ST = { CURRENT: 'watching', REPEATING: 'completed', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped', PLANNING: 'planning' };
    const list = (d.MediaListCollection.lists || []).flatMap((l) => l.entries).map((e) => ({ id: e.mediaId, s: e.score || null, st: ST[e.status] || 'planning' }));
    const unmapped = [...new Set(list.filter((e) => !CRP.ext.crFromAniList(e.id)).map((e) => e.id))];
    onStep && onStep(t('Emparejando {n} entradas con Crunchyroll…', { n: list.length }));
    const extra = await linkUnmapped(unmapped, 'anilist');
    const rows = list.map((e) => ({ cr: CRP.ext.crFromAniList(e.id) || extra.get(e.id), s: e.s, st: e.st })).filter((r) => r.cr);
    data = { source: 'anilist', user: d.MediaListCollection.user.name, ts: Date.now(), total: list.length, items: aggregate(rows) };
    await store.localSet(KEY, data);
    return summary();
  }

  async function importMal(user, onStep) {
    await Promise.all([CRP.catalog.load(), CRP.ext.load()]);
    onStep && onStep(t('Leyendo tu lista de MyAnimeList…'));
    const r = await chrome.runtime.sendMessage({ type: 'mal-list', user });
    if (!r || r.error) throw new Error(r && r.error ? t(r.error) : t('No se pudo leer la lista de MyAnimeList.'));
    const ST = { 1: 'watching', 2: 'completed', 3: 'paused', 4: 'dropped', 6: 'planning' };
    const list = r.items.map((e) => ({ mal: e.anime_id, s: e.score ? e.score * 10 : null, st: ST[e.status] || 'planning' }));
    const unmapped = [...new Set(list.filter((e) => !CRP.ext.crFromMal(e.mal)).map((e) => e.mal))];
    onStep && onStep(t('Emparejando {n} entradas con Crunchyroll…', { n: list.length }));
    const extra = await linkUnmapped(unmapped, 'mal');
    const rows = list.map((e) => ({ cr: CRP.ext.crFromMal(e.mal) || extra.get(e.mal), s: e.s, st: e.st })).filter((x) => x.cr);
    data = { source: 'mal', user, ts: Date.now(), total: list.length, items: aggregate(rows) };
    await store.localSet(KEY, data);
    return summary();
  }

  async function clear() {
    data = null;
    await store.localSet(KEY, null);
  }

  return { load, active, get, seen, entries, summary, importAniList, importMal, clear };
})();
