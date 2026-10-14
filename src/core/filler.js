// Filler and recap episodes, from MyAnimeList: Jikan's /anime/{id}/episodes marks each
// episode `filler` / `recap`. A Crunchyroll series reaches its MAL entry through AniList
// (CRP.ext). Crunchyroll episode numbers are only matched to MAL's when the numbering is
// unambiguous (first season, or a later season numbered absolutely — see agenda `abs`);
// otherwise only the series summary is shown.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.filler = (() => {
  const store = CRP.store;
  const KEY = 'filler:v1';
  const DAY = 86400000;
  const LONG = 40;           // series this long are checked in the background (for search)
  let map = null;            // { [idMal]: { t: total, f: [n…], r: [n…], ts, done } }
  const sets = new Map();    // idMal -> { f: Set, r: Set }
  const fns = new Set();

  async function load() {
    if (!map) map = (await store.localGet(KEY)) || {};
    return map;
  }
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.localSet(KEY, map), 400); };

  const extOf = (id) => (CRP.ext && CRP.ext.get(id)) || null;
  const malOf = (id) => { const e = extOf(id); return e && e.mal ? e.mal : null; };
  const info = (id) => { const m = malOf(id); return m && map ? map[m] || null : null; };
  const fresh = (i) => !!i && Date.now() - i.ts < (i.done ? 30 : 7) * DAY;

  // Jikan allows about 3 requests a second: one queue for every caller.
  let chain = Promise.resolve();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function jikan(url) {
    const run = chain.then(async () => {
      for (let i = 0; i < 3; i++) {
        const res = await fetch(url).catch(() => null);
        if (res && res.ok) { await sleep(400); return res.json(); }
        if (res && res.status === 404) { await sleep(400); return null; }
        await sleep(1500 * (i + 1)); // 429 or network error
      }
      throw new Error('Jikan no responde');
    });
    chain = run.catch(() => {});
    return run;
  }

  async function fetchMal(idMal, finished) {
    await load();
    if (fresh(map[idMal])) return map[idMal];
    const f = [];
    const r = [];
    let total = 0;
    for (let page = 1; page <= 40; page++) {
      const j = await jikan(`https://api.jikan.moe/v4/anime/${idMal}/episodes?page=${page}`);
      if (!j) break;
      for (const e of j.data || []) {
        total = Math.max(total, e.mal_id || 0);
        if (e.filler) f.push(e.mal_id);
        if (e.recap) r.push(e.mal_id);
      }
      if (!j.pagination || !j.pagination.has_next_page) break;
    }
    const out = { t: total, f, r, ts: Date.now(), done: !!finished };
    map[idMal] = out;
    sets.delete(idMal);
    save();
    fns.forEach((fn) => { try { fn(idMal); } catch (e) { /* ignore */ } });
    return out;
  }

  async function forSeries(x) {
    const m = malOf(x.id);
    if (!m) return null;
    const e = extOf(x.id);
    return fetchMal(m, e && e.status === 'FINISHED');
  }

  // [1,2,3,7,9,10] -> [[1,3],[7,7],[9,10]]
  function ranges(nums) {
    const out = [];
    for (const n of [...nums].sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      if (last && n === last[1] + 1) last[1] = n;
      else out.push([n, n]);
    }
    return out;
  }
  const fmtRanges = (rs) => rs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');

  function summary(id) {
    const i = info(id);
    if (!i || !i.t) return null;
    return { mal: malOf(id), total: i.t, filler: i.f.length, recap: i.r.length, share: i.f.length / i.t, fillerRanges: ranges(i.f), recapRanges: ranges(i.r) };
  }

  // 'filler' | 'recap' | null for MAL episode number n of a series
  function kindOf(seriesId, n) {
    const m = malOf(seriesId);
    const i = m && map ? map[m] : null;
    n = +n;
    if (!i || !(n >= 1 && n <= i.t)) return null;
    let s = sets.get(m);
    if (!s) { s = { f: new Set(i.f), r: new Set(i.r) }; sets.set(m, s); }
    return s.f.has(n) ? 'filler' : s.r.has(n) ? 'recap' : null;
  }

  // Share of filler episodes (0..1), or null when not known (yet).
  const share = (id) => { const i = info(id); return i && i.t ? i.f.length / i.t : null; };
  const hasMal = (id) => !!malOf(id);

  // Background: long series in the catalog (for the "little filler" search), one tab at a time.
  async function enrich(items) {
    await load();
    const todo = items.filter((x) => x.kind !== 'movie_listing' && x.episodes >= LONG && malOf(x.id) && !fresh(map[malOf(x.id)]));
    if (!todo.length) return;
    const work = async () => {
      for (const x of todo) {
        try { await forSeries(x); } catch (e) { if (CRP.diag) CRP.diag.error('relleno (Jikan)', e); break; }
      }
    };
    if (globalThis.navigator && navigator.locks) await navigator.locks.request('crp-filler', { ifAvailable: true }, (lock) => (lock ? work() : null));
    else await work();
  }

  return {
    load, forSeries, summary, fmtRanges, kindOf, share, hasMal, enrich, LONG,
    onUpdate: (fn) => { fns.add(fn); return () => fns.delete(fn); },
    _test: { ranges, fetchMal, reset: () => { map = {}; sets.clear(); } },
  };
})();
