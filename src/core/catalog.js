// Local index of the whole Crunchyroll catalog (~1.600 series/films) so search and
// filtering are instant and can use facets the site doesn't offer: dub language,
// episode count, year, rating with vote count, airing/finished, excluded genres…
// Synced from /discover/browse (sorted by popularity, so list position = popularity
// rank) once a day and kept in chrome.storage.local.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.catalog = (() => {
  const M = CRP.model;
  const api = CRP.api;
  const store = CRP.store;
  const { pool, contentLocale, norm } = CRP.util;
  const TTL = 24 * 3600 * 1000;
  const VERSION = 3; // 3: fill titles missed by popularity paging
  const DAY = 86400000;
  const AIRING_DAYS = 14;

  let index = null;
  let loading = null;
  const progressFns = new Set();
  const updateFns = new Set();
  const key = () => 'catalog:' + contentLocale();

  function build(snap) {
    for (const it of snap.items) {
      it._t = norm(it.title);
      it._d = norm(it.description);
    }
    return { ...snap, byId: new Map(snap.items.map((i) => [i.id, i])), N: snap.items.length };
  }

  async function sync() {
    const PAGE = 100;
    const report = (p) => progressFns.forEach((fn) => fn(p));
    const first = await api.browse({ sort_by: 'popularity', n: PAGE, start: 0 });
    const total = first.total || (first.data || []).length;
    const starts = [];
    for (let s = PAGE; s < total; s += PAGE) starts.push(s);
    const pages = starts.length + 2; // + seasons step
    let done = 1;
    report(done / pages);
    const rest = await pool(starts, 4, async (start) => {
      const r = await api.browse({ sort_by: 'popularity', n: PAGE, start });
      report(++done / pages);
      return r.data || [];
    });

    // Popularity order shifts while paging, so a few titles slip between pages. If any
    // are missing, one alphabetical pass (stable order) fills them in, ranked last.
    let raw = [first.data || [], ...rest.map((x) => x || [])].flat();
    const have = new Set(raw.map((x) => x && x.id));
    if (have.size < total) {
      const alpha = await pool(starts.concat([0]), 4, async (start) => (await api.browse({ sort_by: 'alphabetical', n: PAGE, start })).data || []);
      raw = raw.concat(alpha.flat().filter((x) => x && !have.has(x.id)));
    }

    // Season tags (current + 3 previous) so "Otoño 2026" can be a facet.
    let tags = [];
    const tagMap = new Map();
    try {
      tags = (await api.seasonalTags()).slice(0, 4).map((t) => ({ id: t.id, title: (t.localization && t.localization.title) || t.id }));
      await pool(tags, 4, async (t) => {
        const r = await api.browse({ seasonal_tag: t.id, n: 100, ratings: null });
        for (const it of r.data || []) {
          if (!tagMap.has(it.id)) tagMap.set(it.id, []);
          tagMap.get(it.id).push(t.id);
        }
      });
    } catch (e) { /* facet just won't show */ }
    report(1);

    const seen = new Set();
    const items = [];
    for (const it of raw) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      const rec = M.record(it, items.length);
      rec.tags = tagMap.get(it.id) || [];
      items.push(rec);
    }
    const snap = { v: VERSION, ts: Date.now(), locale: contentLocale(), total, tags, items };
    await store.localSet(key(), snap);
    return snap;
  }

  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = (async () => {
        const snap = await store.localGet(key());
        if (snap && snap.v === VERSION && snap.items && snap.items.length) {
          index = build(snap);
          if (Date.now() - snap.ts > TTL) refresh();
          return index;
        }
        index = build(await sync());
        return index;
      })().finally(() => { loading = null; });
    }
    return loading;
  }

  function refresh() {
    return sync().then((snap) => {
      index = build(snap);
      updateFns.forEach((fn) => fn(index));
      return index;
    }).catch((e) => { console.warn('[CR+] catalog refresh failed', e); });
  }

  const onProgress = (fn) => { progressFns.add(fn); return () => progressFns.delete(fn); };
  const onUpdate = (fn) => { updateFns.add(fn); return () => updateFns.delete(fn); };
  const get = (id) => index && index.byId.get(id);

  // ---------------------------------------------------------------- filtering
  const isAiring = (x) => !!x.lastPublic && Date.now() - Date.parse(x.lastPublic) < AIRING_DAYS * DAY;

  const LEN = {
    movie: (x) => x.kind === 'movie_listing',
    short: (x) => x.kind !== 'movie_listing' && x.episodes > 0 && x.episodes <= 13,
    mid: (x) => x.kind !== 'movie_listing' && x.episodes >= 14 && x.episodes <= 26,
    long: (x) => x.kind !== 'movie_listing' && x.episodes >= 27 && x.episodes <= 75,
    huge: (x) => x.kind !== 'movie_listing' && x.episodes > 75,
  };

  // Filter state (all optional):
  // { text, audio:[], len, epsMin, epsMax, kind, ratingMin, yearMin, yearMax, status,
  //   season, genresIn:[], genresOut:[], mine, noMature, likeIds:Set }
  // Each group maps to one predicate so facet counts can ignore their own group.
  function predicates(F, ctx, skip = []) {
    const p = [];
    const on = (g) => !skip.includes(g);
    if (on('audio') && F.audio && F.audio.length) p.push((x) => F.audio.some((a) => x.audio.includes(a)));
    if (on('len') && F.len && LEN[F.len]) p.push(LEN[F.len]);
    if (on('len') && (F.epsMin != null || F.epsMax != null)) {
      p.push((x) => x.kind !== 'movie_listing' && (F.epsMin == null || x.episodes >= F.epsMin) && (F.epsMax == null || x.episodes <= F.epsMax));
    }
    if (on('kind') && F.kind) p.push((x) => (F.kind === 'movie_listing') === (x.kind === 'movie_listing'));
    if (on('rating') && F.ratingMin) p.push((x) => x.rating != null && x.rating >= F.ratingMin && x.votes >= 25);
    if (on('al') && F.alMin) p.push((x) => { const s = CRP.ext.score(x.id); return s != null && s >= F.alMin; });
    if (on('year') && (F.yearMin || F.yearMax)) p.push((x) => !!x.year && (!F.yearMin || x.year >= F.yearMin) && (!F.yearMax || x.year <= F.yearMax));
    if (on('status') && F.status) p.push((x) => isAiring(x) === (F.status === 'airing'));
    if (on('season') && F.season) p.push((x) => x.tags.includes(F.season));
    if (on('genres') && F.genresIn && F.genresIn.length) p.push((x) => F.genresIn.every((g) => x.genres.includes(g)));
    if (on('genres') && F.genresOut && F.genresOut.length) p.push((x) => !F.genresOut.some((g) => x.genres.includes(g)));
    if (on('tags') && F.tagsIn && F.tagsIn.length) p.push((x) => { const t = CRP.ext.themes(x.id); return !!t && F.tagsIn.every((n) => t.has(n)); });
    if (on('tags') && F.tagsOut && F.tagsOut.length) p.push((x) => { const t = CRP.ext.themes(x.id); return !t || !F.tagsOut.some((n) => t.has(n)); });
    if (on('studio') && F.studio) p.push((x) => CRP.ext.studios(x.id).includes(F.studio));
    if (on('source') && F.source) p.push((x) => CRP.ext.source(x.id) === F.source);
    if (on('mine') && F.mine && ctx) p.push((x) => mine(F.mine, x, ctx));
    if (on('mature') && F.noMature) p.push((x) => !x.mature && !/MA|18/.test(x.maturity || ''));
    if (on('text') && F.text) {
      const words = norm(F.text).split(/\s+/).filter((w) => w.length > 1);
      if (words.length) p.push((x) => words.every((w) => x._t.includes(w) || x._d.includes(w)));
    }
    if (on('like') && F.likeIds) p.push((x) => F.likeIds.has(x.id));
    return p;
  }

  function mine(kind, x, ctx) {
    switch (kind) {
      case 'unseen': return !ctx.hasWatched(x.id);
      case 'watchlist': return ctx.inWatchlist(x.id);
      case 'seen': return ctx.hasWatched(x.id);
      case 'progress': {
        const st = ctx.seriesStats().get(x.id);
        return !!st && (!x.episodes || st.eps < x.episodes * 0.9);
      }
      default: return true;
    }
  }

  const textScore = (x, F) => {
    if (!F.text) return 0;
    const q = norm(F.text).trim();
    if (x._t === q) return 10;
    if (x._t.startsWith(q)) return 6;
    if (x._t.includes(' ' + q) || x._t.includes(q)) return 4;
    return 1;
  };
  // Blended quality (Crunchyroll stars + AniList score), 0..1, -1 when unknown.
  const q = (x) => { const v = CRP.ext.quality(x); return v == null ? -1 : v; };
  // Well rated *and* not mainstream; needs some votes to be credible.
  const gemScore = (x, N) => {
    const e = CRP.ext.get(x.id);
    if (q(x) < 0 || (x.votes < 150 && !(e && e.u >= 2000))) return -9;
    return (q(x) - 0.6) * 3 + x.pop / N;
  };

  const SORTS = {
    relevance: (F) => (a, b) => (F.likeOrder ? (F.likeOrder.get(a.id) - F.likeOrder.get(b.id)) : 0) || textScore(b, F) - textScore(a, F) || a.pop - b.pop,
    rating: () => (a, b) => q(b) - q(a) || a.pop - b.pop,
    anilist: () => (a, b) => (CRP.ext.score(b.id) ?? -1) - (CRP.ext.score(a.id) ?? -1) || a.pop - b.pop,
    popular: () => (a, b) => a.pop - b.pop,
    recent: () => (a, b) => (Date.parse(b.lastPublic) || 0) - (Date.parse(a.lastPublic) || 0),
    year: () => (a, b) => (b.year || 0) - (a.year || 0) || a.pop - b.pop,
    short: () => (a, b) => (a.episodes || 999) - (b.episodes || 999) || a.pop - b.pop,
    gems: () => (a, b) => gemScore(b, index.N) - gemScore(a, index.N),
    alpha: () => (a, b) => a.title.localeCompare(b.title),
  };

  function query(F, ctx, sort = 'relevance') {
    if (!index) return [];
    const preds = predicates(F, ctx);
    const list = index.items.filter((x) => preds.every((f) => f(x)));
    return list.sort((SORTS[sort] || SORTS.relevance)(F));
  }

  // Items matching every filter except one group (for facets built from the data).
  function base(F, ctx, group) {
    if (!index) return [];
    const preds = predicates(F, ctx, [group]);
    return index.items.filter((x) => preds.every((f) => f(x)));
  }

  // Counts for each option of one facet group, with every *other* filter applied.
  function counts(F, ctx, group, options) {
    if (!index) return {};
    const preds = predicates(F, ctx, [group]);
    const base = index.items.filter((x) => preds.every((f) => f(x)));
    const out = {};
    for (const o of options) {
      const p = predicates(o.patch, ctx);
      out[o.id] = p.length ? base.filter((x) => p.every((f) => f(x))).length : base.length;
    }
    return out;
  }

  // Best title match for "como Frieren" style references.
  function findTitle(q) {
    if (!index || !q) return null;
    const n = norm(q).trim();
    if (n.length < 2) return null;
    let best = null;
    let bestScore = 0;
    for (const x of index.items) {
      let s = 0;
      if (x._t === n) s = 100;
      else if (x._t.startsWith(n)) s = 60;
      else if (x._t.includes(n)) s = 40;
      else {
        // every word must appear: callers try shorter prefixes ("frieren corta" → "frieren")
        const words = n.split(/\s+/).filter((w) => w.length > 1);
        if (words.length && words.every((w) => x._t.includes(w))) s = 20;
      }
      if (s) s -= x.pop / index.N * 10; // prefer the popular one on ties
      if (s > bestScore) { bestScore = s; best = x; }
    }
    return bestScore >= 10 ? best : null;
  }

  return { load, refresh, onProgress, onUpdate, get, query, base, counts, findTitle, isAiring, LEN, current: () => index };
})();
