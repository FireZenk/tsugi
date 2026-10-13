// External ratings. Crunchyroll's own stars are inflated (most shows sit at 4.6–4.9),
// so we add AniList's community score (0–100, plus how many users track the show):
//   · AniList GraphQL API — free, no key, CORS-enabled. Its entries link back to the
//     Crunchyroll series, so most matches are exact (by Crunchyroll id or slug), not
//     guessed from titles. Shows split into several AniList entries (one per season)
//     get a popularity-weighted average.
//   · A second pass by AniList id adds themes (tags), studio, source material, trailer
//     and the next airing time — used by search facets, the quick view and the agenda.
//   · MyAnimeList score (via the Jikan API) is fetched on demand in the quick view.
// Only titles/ids of series are sent to these services; nothing about the user.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.ext = (() => {
  const store = CRP.store;
  const { norm, clamp } = CRP.util;
  const KEY = 'ext:anilist:v1';
  const DAY = 86400000;
  const TTL = 30 * DAY;
  const MISS_TTL = 7 * DAY;
  const AIRING_TTL = 12 * 3600 * 1000; // airing shows: refresh next-episode time often
  const BATCH = 20;
  const ANILIST = 'https://graphql.anilist.co';

  // { [crId]: { al, mal, ids, s, u, n, c: 'id'|'title', t,
  //             tg: [[tag, rank]], ge, st, src, tr, nx: { at, ep }, status, mals, dT } | { t, none: 1 } }
  let map = null;
  let byAl = null;          // AniList id -> crId (all seasons)
  let byMal = null;         // MAL id -> crId
  let loading = null;
  let saveTimer = null;
  const updateFns = new Set();
  const progressFns = new Set();
  let progress = null;      // { done, total } while enriching

  function load() {
    if (map) return Promise.resolve(map);
    if (!loading) loading = store.localGet(KEY).then((m) => (map = m || {}));
    return loading;
  }
  const save = () => {
    byAl = null;
    byMal = null;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.localSet(KEY, map), 800);
  };

  // entry with a score, or null (also null when the user turned external ratings off)
  const get = (id) => {
    if (store.get().ext === false) return null;
    const e = map && map[id];
    return e && !e.none ? e : null;
  };
  const score = (id) => { const e = get(id); return e && e.s != null ? e.s : null; };

  // ------------------------------------------------------------------ AniList
  let nextSlot = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Serialized, rate-limited (AniList allows ~30 requests/min right now).
  let chain = Promise.resolve();
  function anilist(query, variables) {
    const run = async () => {
      const wait = nextSlot - Date.now();
      if (wait > 0) await sleep(wait);
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(ANILIST, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
        });
        const rem = res.headers.get('x-ratelimit-remaining');
        const remaining = rem == null ? 30 : +rem;
        nextSlot = Date.now() + (remaining <= 2 ? 20000 : 2100);
        if (res.status === 429) {
          await sleep((+res.headers.get('retry-after') || 60) * 1000);
          continue;
        }
        const j = await res.json();
        if (!res.ok && !j.data) throw new Error('AniList ' + res.status);
        return j.data || {};
      }
      throw new Error('AniList rate limited');
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  const FIELDS = 'id idMal title { romaji english } synonyms averageScore popularity startDate { year } format externalLinks { url }';

  async function searchMany(terms) {
    const vars = {};
    const defs = [];
    const parts = [];
    terms.forEach((t, i) => {
      vars['s' + i] = t;
      defs.push(`$s${i}: String`);
      parts.push(`q${i}: Page(perPage: 5) { media(search: $s${i}, type: ANIME, sort: SEARCH_MATCH) { ${FIELDS} } }`);
    });
    const data = await anilist(`query (${defs.join(', ')}) { ${parts.join('\n')} }`, vars);
    return terms.map((_, i) => (data['q' + i] && data['q' + i].media) || []);
  }

  const slugWords = (x) => (x.slug || '').replace(/-/g, ' ').trim();
  const flat = (s) => norm(s).replace(/[^a-z0-9]/g, '');

  // Does this AniList entry link to this Crunchyroll series?
  function linksTo(m, x) {
    const slug = flat(x.slug);
    return (m.externalLinks || []).some((l) => {
      let u;
      try { u = new URL(l.url); } catch (e) { return false; }
      if (!/crunchyroll\.com$/.test(u.hostname)) return false;
      if (u.pathname.includes('/series/' + x.id)) return true;
      const seg = u.pathname.split('/').filter(Boolean);
      return slug && seg.length === 1 && flat(seg[0]) === slug;
    });
  }

  function pick(x, candidates) {
    const exact = candidates.filter((m) => linksTo(m, x));
    let chosen = exact;
    let conf = 'id';
    if (!exact.length) {
      // Fallback: same name (English/romaji/synonym) as the slug or a title, and the
      // closest launch year. Year must agree (±1) unless only one entry has that name
      // (Crunchyroll's "launch year" is sometimes when it was added, not aired).
      const want = new Set([flat(slugWords(x)), flat(x.title), x._en ? flat(x._en) : ''].filter(Boolean));
      const movie = x.kind === 'movie_listing';
      const named = candidates.filter((m) => {
        const names = [m.title.english, m.title.romaji, ...(m.synonyms || [])].filter(Boolean).map(flat);
        const kindOk = movie ? m.format === 'MOVIE' : m.format !== 'MOVIE';
        return kindOk && names.some((n) => want.has(n));
      });
      const dy = (m) => (x.year && m.startDate.year ? Math.abs(m.startDate.year - x.year) : 0);
      const best = named.sort((a, b) => dy(a) - dy(b))[0];
      chosen = best && (dy(best) <= 1 || named.length === 1) ? [best] : [];
      conf = 'title';
    }
    if (!chosen.length) return null;
    const scored = chosen.filter((m) => m.averageScore != null);
    const weight = scored.reduce((a, m) => a + (m.popularity || 1), 0);
    const first = [...chosen].sort((a, b) => (a.startDate.year || 9999) - (b.startDate.year || 9999))[0];
    return {
      al: first.id,
      mal: first.idMal || null,
      ids: [...chosen].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).map((m) => m.id),
      s: scored.length ? Math.round(scored.reduce((a, m) => a + m.averageScore * (m.popularity || 1), 0) / weight) : null,
      u: Math.max(0, ...chosen.map((m) => m.popularity || 0)),
      n: chosen.length,   // AniList entries combined (seasons)
      c: conf,
      t: Date.now(),
    };
  }

  // Search passes, each only for what's still unmatched:
  //   1. slug words ("frieren beyond journeys end")
  //   2. first two words ("frieren beyond") — survives apostrophes/subtitles
  //   3. the title as the site shows it ("Fate/strange Fake", "Hell's Paradise")
  //   4. the English title (the site may be in another language)
  const PASSES = [
    (x) => slugWords(x),
    (x) => slugWords(x).split(' ').filter((w) => w.length > 2).slice(0, 2).join(' '),
    (x) => x.title,
    (x) => x._en,
  ];
  async function resolve(items) {
    const out = new Map();
    let todo = items;
    for (let p = 0; p < PASSES.length && todo.length; p++) {
      if (p === 3) {
        try {
          const en = new Map((await CRP.api.objects(todo.map((x) => x.id), { locale: 'en-US' })).map((o) => [o.id, o.title]));
          todo = todo.map((x) => ({ ...x, _en: en.get(x.id) }));
        } catch (e) { break; }
      }
      // skip items whose term repeats an earlier one (punctuation counts: AniList's
      // search treats "Fate/strange Fake" and "fatestrange fake" differently)
      const term = PASSES[p];
      const same = (a, b) => norm(a).replace(/\s+/g, ' ').trim() === norm(b).replace(/\s+/g, ' ').trim();
      const valid = todo.filter((x) => term(x) && !PASSES.slice(0, p).some((q) => same(q(x), term(x))));
      if (!valid.length) continue;
      const results = await searchMany(valid.map(term));
      valid.forEach((x, i) => { const e = pick(x, results[i]); if (e) out.set(x.id, e); });
      todo = todo.filter((x) => !out.has(x.id));
    }
    for (const x of todo) out.set(x.id, { t: Date.now(), none: 1 });
    return out;
  }

  const stale = (e) => !e || Date.now() - e.t > (e.none ? MISS_TTL : TTL);

  // ----------------------------------------------------------- details by id
  const DETAILS = 'id idMal genres source status tags { name rank isMediaSpoiler } studios(isMain: true) { nodes { name } } trailer { id site } nextAiringEpisode { airingAt episode }';
  const needsDetails = (e) => !!e && !e.none && (!e.dT || Date.now() - e.dT > (e.status === 'RELEASING' ? AIRING_TTL : TTL));

  async function details(entries) {
    const ids = [...new Set(entries.flatMap(([, e]) => e.ids || [e.al]))];
    const byId = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const data = await anilist(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ${DETAILS} } } }`, { ids: ids.slice(i, i + 50) });
      ((data.Page && data.Page.media) || []).forEach((m) => byId.set(m.id, m));
    }
    for (const [, e] of entries) {
      const ms = (e.ids || [e.al]).map((id) => byId.get(id)).filter(Boolean);
      e.dT = Date.now();
      if (!ms.length) continue;
      const main = ms[0];                      // most popular entry
      const first = byId.get(e.al) || main;    // earliest (season 1)
      e.tg = main.tags.filter((t) => !t.isMediaSpoiler && t.rank >= 60).slice(0, 14).map((t) => [t.name, t.rank]);
      e.ge = [...new Set(ms.flatMap((m) => m.genres || []))];
      e.st = (first.studios.nodes.length ? first.studios : main.studios).nodes.map((n) => n.name).slice(0, 2);
      e.src = first.source || main.source || null;
      const tr = [first, ...ms].find((m) => m.trailer && m.trailer.site === 'youtube');
      e.tr = tr ? tr.trailer.id : null;
      const nx = ms.map((m) => m.nextAiringEpisode).filter(Boolean).sort((a, b) => a.airingAt - b.airingAt)[0];
      e.nx = nx ? { at: nx.airingAt * 1000, ep: nx.episode } : null;
      e.status = ms.some((m) => m.status === 'RELEASING') ? 'RELEASING' : (main.status || null);
      e.mals = [...new Set(ms.map((m) => m.idMal).filter(Boolean))];
    }
  }

  // Background fill of the whole catalog, most popular first. One tab at a time.
  async function enrich(items) {
    await load();
    const run = async () => {
      const queue = items.filter((x) => x.slug && stale(map[x.id]));
      progress = { done: 0, total: queue.length };
      for (let i = 0; i < queue.length; i += BATCH) {
        const batch = queue.slice(i, i + BATCH);
        try {
          const got = await resolve(batch);
          got.forEach((e, id) => { map[id] = e; });
          save();
        } catch (e) {
          console.warn('[CR+] AniList batch failed', e);
          await sleep(30000);
        }
        progress.done = Math.min(queue.length, i + BATCH);
        progressFns.forEach((fn) => fn(progress));
        updateFns.forEach((fn) => fn());
      }
      // phase 2: themes, studio, trailer, airing time
      const need = Object.entries(map).filter(([, e]) => needsDetails(e));
      if (need.length) {
        progress = { done: 0, total: need.length, phase: 'detalles' };
        for (let i = 0; i < need.length; i += 40) {
          try {
            await details(need.slice(i, i + 40));
            save();
          } catch (e) {
            console.warn('[CR+] AniList details failed', e);
            await sleep(30000);
          }
          progress.done = Math.min(need.length, i + 40);
          progressFns.forEach((fn) => fn(progress));
        }
        updateFns.forEach((fn) => fn());
      }
      progress = null;
      progressFns.forEach((fn) => fn(null));
    };
    if (navigator.locks) return navigator.locks.request('crp-anilist', { ifAvailable: true }, (lock) => (lock ? run() : null));
    return run();
  }

  // One series right now (quick view), jumping the background queue.
  async function ensure(x) {
    await load();
    if (stale(map[x.id])) {
      const got = await resolve([x]);
      got.forEach((e, id) => { map[id] = e; });
      save();
    }
    if (needsDetails(map[x.id])) {
      await details([[x.id, map[x.id]]]);
      save();
    }
    return get(x.id);
  }

  // ------------------------------------------------------------- watch order
  // Walk AniList relations from this series' entries: the PREQUEL/SEQUEL line plus
  // side stories (films, OVAs), sorted by release date. Each entry says whether it's
  // on Crunchyroll (via AniList's links) so the quick view can jump to it.
  const FOLLOW = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY']);
  // relations two hops deep per request, so long franchises need few requests
  const ORDER_FIELDS = 'id title { english romaji } format episodes status startDate { year month day } externalLinks { url } relations { edges { relationType node { id type relations { edges { relationType node { id type } } } } } }';
  async function watchOrder(x) {
    const cached = await store.cacheGet('order:' + x.id, 7 * DAY);
    if (cached) return cached;
    const e = await ensure(x);
    if (!e) return null;
    const start = e.ids || [e.al];
    const nodes = new Map();      // AniList id -> media
    const kind = new Map();       // AniList id -> 'main' | 'extra'
    start.forEach((id) => kind.set(id, 'main'));
    const consider = (fromId, edge, next) => {
      const n = edge.node;
      if (n.type !== 'ANIME' || !FOLLOW.has(edge.relationType) || kind.has(n.id)) return null;
      // side stories of side stories aren't part of the watch order
      if (edge.relationType === 'SIDE_STORY' && kind.get(fromId) === 'extra') return null;
      kind.set(n.id, edge.relationType === 'SIDE_STORY' ? 'extra' : kind.get(fromId) === 'extra' ? 'extra' : 'main');
      next.push(n.id);
      return n;
    };
    let frontier = start;
    for (let round = 0; round < 8 && frontier.length && nodes.size < 40; round++) {
      const data = await anilist(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ${ORDER_FIELDS} } } }`, { ids: frontier });
      const next = [];
      for (const m of (data.Page && data.Page.media) || []) {
        nodes.set(m.id, m);
        for (const edge of m.relations.edges) {
          const n1 = consider(m.id, edge, next) || (kind.has(edge.node.id) ? edge.node : null);
          if (!n1 || !n1.relations) continue;
          for (const edge2 of n1.relations.edges) consider(n1.id, edge2, next);
        }
      }
      frontier = [...new Set(next)].filter((id) => !nodes.has(id)).slice(0, 40 - nodes.size);
    }
    const index = CRP.catalog.current();
    const bySlug = index ? new Map(index.items.map((i) => [i.slug.toLowerCase(), i.id])) : new Map();
    const crOf = (m) => {
      for (const l of m.externalLinks || []) {
        let u;
        try { u = new URL(l.url); } catch (err) { continue; }
        if (!/crunchyroll\.com$/.test(u.hostname)) continue;
        const mm = u.pathname.match(/\/series\/([A-Z0-9]{8,})/);
        if (mm && index && index.byId.has(mm[1])) return mm[1];
        const seg = u.pathname.split('/').filter(Boolean);
        if (seg.length === 1 && bySlug.has(seg[0].toLowerCase())) return bySlug.get(seg[0].toLowerCase());
      }
      return crFromAniList(m.id);
    };
    const date = (m) => (m.startDate.year || 9999) * 10000 + (m.startDate.month || 12) * 100 + (m.startDate.day || 28);
    const list = [...nodes.values()].sort((a, b) => date(a) - date(b)).map((m) => ({
      al: m.id,
      title: m.title.english || m.title.romaji,
      format: m.format,
      episodes: m.episodes,
      year: m.startDate.year,
      status: m.status,
      kind: kind.get(m.id) || 'main',
      cr: crOf(m),
      here: start.includes(m.id),
    }));
    await store.cacheSet('order:' + x.id, list);
    return list;
  }

  // ---------------------------------------------------------------- accessors
  function indexes() {
    if (byAl) return;
    byAl = new Map();
    byMal = new Map();
    for (const [cr, e] of Object.entries(map || {})) {
      if (e.none) continue;
      (e.ids || [e.al]).forEach((id) => byAl.set(id, cr));
      (e.mals || (e.mal ? [e.mal] : [])).forEach((id) => byMal.set(id, cr));
    }
  }
  const crFromAniList = (id) => { indexes(); return byAl.get(id) || null; };
  const crFromMal = (id) => { indexes(); return byMal.get(id) || null; };
  const tags = (id) => { const e = get(id); return (e && e.tg) || []; };          // [[name, rank]]
  const studios = (id) => { const e = get(id); return (e && e.st) || []; };
  const source = (id) => { const e = get(id); return (e && e.src) || null; };
  const trailer = (id) => { const e = get(id); return (e && e.tr) || null; };
  // AniList tags + genres as a Set (cached per entry version)
  const themeCache = new Map();
  const themes = (id) => {
    const e = get(id);
    if (!e || (!e.tg && !e.ge)) return null;
    const c = themeCache.get(id);
    if (c && c.dT === e.dT) return c.set;
    const set = new Set([...(e.tg || []).map((t) => t[0]), ...(e.ge || [])]);
    themeCache.set(id, { dT: e.dT, set });
    return set;
  };
  // every theme / studio present in the data, with counts (feeds the parser and facets)
  function vocabulary() {
    const themesC = new Map();
    const studiosC = new Map();
    for (const e of Object.values(map || {})) {
      if (e.none) continue;
      for (const [n] of e.tg || []) themesC.set(n, (themesC.get(n) || 0) + 1);
      for (const g of e.ge || []) themesC.set(g, (themesC.get(g) || 0) + 1);
      for (const st of e.st || []) studiosC.set(st, (studiosC.get(st) || 0) + 1);
    }
    return { themes: themesC, studios: studiosC };
  }
  const nextAiring = (id) => { const e = get(id); return e && e.nx && e.nx.at > Date.now() - 3600000 ? e.nx : null; };

  // MyAnimeList score via Jikan (unofficial MAL API), cached a week.
  async function malScore(idMal) {
    if (!idMal) return null;
    const cached = await store.cacheGet('mal:' + idMal, 7 * 86400000);
    if (cached) return cached;
    const res = await fetch(`https://api.jikan.moe/v4/anime/${idMal}`);
    if (!res.ok) return null;
    const d = (await res.json()).data || {};
    const out = { score: d.score, users: d.scored_by, rank: d.rank, url: d.url };
    await store.cacheSet('mal:' + idMal, out);
    return out;
  }

  // 0..1 quality blending Crunchyroll's vote-smoothed stars with AniList's score.
  // CR stars are compressed near the top, so AniList (when known) weighs more.
  function quality(x) {
    const cr = x.quality == null ? null : clamp((x.quality - 4.0) / 0.9, 0, 1);
    const s = score(x.id);
    const al = s == null ? null : clamp((s - 55) / 35, 0, 1);
    if (cr == null && al == null) return null;
    if (al == null) return cr;
    if (cr == null) return al;
    return 0.65 * al + 0.35 * cr;
  }

  const stats = () => {
    const all = Object.values(map || {});
    return { matched: all.filter((e) => !e.none).length, missed: all.filter((e) => e.none).length, progress };
  };

  return {
    load, get, score, enrich, ensure, malScore, quality, stats,
    tags, themes, studios, source, trailer, nextAiring, crFromAniList, crFromMal, vocabulary, watchOrder,
    onUpdate: (fn) => { updateFns.add(fn); return () => updateFns.delete(fn); },
    onProgress: (fn) => { progressFns.add(fn); return () => progressFns.delete(fn); },
    reset: async () => { map = {}; await store.localSet(KEY, map); },
    _test: { pick, linksTo },
  };
})();
