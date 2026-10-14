// Recommender the user can steer. Two stages:
//   prepare(): async. Picks seed series (history + 👍) and fetches Crunchyroll's
//              similar_to list for each (cached a week per series), plus the lists for
//              👎 series (used as negative evidence).
//   rank():    sync, instant. Scores candidates with the knobs the user controls
//              (hidden gems ↔ popular, short ↔ long, classic ↔ recent, explore), muted
//              seeds, 👍/👎, genre affinity and a vote-smoothed rating. Every result
//              carries its reasons, so the UI can say *why*.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.recs = (() => {
  const M = CRP.model;
  const api = CRP.api;
  const store = CRP.store;
  const { pool, clamp } = CRP.util;
  const DAY = 86400000;
  const SIM_TTL = 7 * DAY;
  const SIM_N = 30;

  // raw watch-history entries -> Map(seriesId -> stats)
  function seriesStats(history) {
    const map = new Map();
    for (const entry of history) {
      const ep = M.episode(entry.panel);
      if (!ep || !ep.seriesId) continue;
      let s = map.get(ep.seriesId);
      if (!s) {
        s = { id: ep.seriesId, title: ep.seriesTitle, slug: ep.seriesSlug, eps: 0, done: 0, last: 0, lastEntry: null, genres: new Set() };
        map.set(ep.seriesId, s);
      }
      s.eps += 1;
      if (entry.fully_watched) s.done += 1;
      const t = Date.parse(entry.date_played) || 0;
      if (t > s.last) { s.last = t; s.lastEntry = entry; }
      ep.genres.forEach((g) => s.genres.add(g));
    }
    return map;
  }

  function seedWeight(s, now) {
    const ageDays = s.last ? (now - s.last) / DAY : 365;
    const recency = 0.35 + Math.exp(-ageDays / 90);
    const commitment = Math.log2(1 + s.eps) * (0.6 + 0.4 * (s.done / Math.max(1, s.eps)));
    return recency * commitment;
  }

  async function similarOf(id) {
    const cached = await store.cacheGet('sim:' + id, SIM_TTL);
    if (cached) return cached;
    const list = (await api.similar(id, SIM_N)).map((x) => x.id).filter(Boolean);
    await store.cacheSet('sim:' + id, list);
    return list;
  }

  /**
   * @returns {Promise<{ seeds: Array<{id,title,w,kind:'history'|'list'|'like'}>, sims: Map<string,string[]>, negatives: string[] }>}
   */
  async function prepare({ stats, watchlist, imported = [], onProgress }) {
    const now = Date.now();
    const auto = [...stats.values()].map((s) => ({ id: s.id, title: s.title, w: seedWeight(s, now), kind: 'history' }))
      .sort((a, b) => b.w - a.w).slice(0, 14);
    const listSeeds = watchlist.filter((w) => !stats.has(w.seriesId))
      .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
      .slice(0, auto.length ? 3 : 8)
      .map((w) => ({ id: w.seriesId, title: w.title, w: 0.5, kind: 'list' }));
    const likes = store.likedList().slice(0, 20).map((l) => ({ id: l.id, title: l.title, w: 0, kind: 'like' }));
    // Imported AniList/MAL list: your high scores are the strongest taste signal there is.
    const titleOf = (id) => { const x = CRP.catalog.get(id); return x ? x.title : id; };
    const importSeeds = imported.filter((e) => e.s != null && e.s >= 75 && (e.st === 'completed' || e.st === 'watching'))
      .sort((a, b) => b.s - a.s).slice(0, 16)
      .map((e) => ({ id: e.id, title: titleOf(e.id), w: 0, s: e.s, stars: e.stars || null, kind: 'import' }));
    // Completed/watching without a score still says something (most people rarely score):
    // a weaker seed, best-rated shows first.
    const strongIds = new Set(importSeeds.map((x) => x.id));
    const quality = (id) => { const x = CRP.catalog.get(id); const q = x && CRP.ext.quality(x); return q == null ? 0 : q; };
    const weakSeeds = imported.filter((e) => e.s == null && (e.st === 'completed' || e.st === 'watching') && !strongIds.has(e.id) && CRP.catalog.get(e.id))
      .sort((a, b) => quality(b.id) - quality(a.id)).slice(0, 10)
      .map((e) => ({ id: e.id, title: titleOf(e.id), w: 0, s: null, kind: 'import' }));
    importSeeds.push(...weakSeeds);
    const importNeg = imported.filter((e) => (e.s != null && e.s <= 50) || e.st === 'dropped').slice(0, 16).map((e) => e.id);
    const negatives = [...store.hiddenList().slice(0, 20).map((x) => x.id), ...importNeg];

    // a series you scored outranks the same one inferred from viewing history
    const scored = new Set(importSeeds.map((x) => x.id));
    const seeds = [...auto.filter((a) => !scored.has(a.id)), ...importSeeds, ...listSeeds,
      ...likes.filter((l) => !auto.some((a) => a.id === l.id) && !scored.has(l.id))];
    const ids = [...new Set([...seeds.map((s) => s.id), ...negatives])];
    const sims = new Map();
    let done = 0;
    await pool(ids, 4, async (id) => {
      try { sims.set(id, await similarOf(id)); } catch (e) { sims.set(id, []); }
      onProgress && onProgress(++done / ids.length);
    });
    return { seeds, sims, negatives, importNeg };
  }

  // Fetch similar lists for seeds added after prepare() (a new 👍 or 👎).
  async function extend(graph, id) {
    if (!graph.sims.has(id)) {
      try { graph.sims.set(id, await similarOf(id)); } catch (e) { graph.sims.set(id, []); }
    }
  }

  function genreProfile(seeds, catalog) {
    const acc = new Map();
    for (const s of seeds) {
      const rec = catalog.byId.get(s.id);
      const genres = rec ? rec.genres : [];
      for (const g of genres) acc.set(g, (acc.get(g) || 0) + s.w);
    }
    const max = Math.max(1e-6, ...acc.values());
    return new Map([...acc].map(([g, v]) => [g, v / max]).sort((a, b) => b[1] - a[1]));
  }

  function affinity(genres, profile) {
    if (!genres.length || !profile.size) return 0.4;
    let sum = 0;
    for (const g of genres) sum += profile.get(g) || 0;
    return Math.min(1, sum / Math.sqrt(genres.length));
  }

  const lenScore = (x) => (x.kind === 'movie_listing' ? -1 : clamp((Math.log2(Math.max(1, x.episodes)) - Math.log2(24)) / 1.6, -1, 1));
  const eraScore = (x) => (x.year ? clamp((x.year - 2015) / 10, -1, 1) : 0);

  /**
   * @param graph   result of prepare()
   * @param o       { catalog, stats, inWatchlist(id), tune, dub, limit }
   */
  function rank(graph, o) {
    const { catalog, stats, tune } = o;
    const N = catalog.N || 1;
    const autoMax = Math.max(1, ...graph.seeds.filter((s) => s.kind === 'history').map((s) => s.w));
    const seeds = graph.seeds
      .filter((s) => !store.isMuted(s.id) && !store.isHidden(s.id) && (s.kind !== 'like' || store.isLiked(s.id)))
      .concat(store.likedList().filter((l) => !graph.seeds.some((s) => s.id === l.id)).map((l) => ({ id: l.id, title: l.title, kind: 'like' })))
      .map((s) => (s.kind === 'like' ? { ...s, w: autoMax * 1.15 }
        : s.kind === 'import' ? { ...s, w: s.s == null ? autoMax * 0.5 : autoMax * (0.6 + 0.8 * (s.s - 75) / 25) } : s));
    const profile = genreProfile(seeds, catalog);
    const negatives = [...store.hiddenList().map((x) => x.id), ...(graph.importNeg || [])];

    const seen = (id) => stats.has(id) || (o.isSeen && o.isSeen(id)) || o.inWatchlist(id) || store.isHidden(id) || store.isLiked(id);
    const cands = new Map();
    const cand = (id) => {
      if (seen(id) || !catalog.byId.has(id)) return null;
      let c = cands.get(id);
      if (!c) { c = { x: catalog.byId.get(id), sim: 0, neg: 0, by: new Map() }; cands.set(id, c); }
      return c;
    };
    for (const s of seeds) {
      (graph.sims.get(s.id) || []).forEach((id, i) => {
        const c = cand(id);
        if (!c) return;
        const v = s.w * (1 - i / (SIM_N + 10));
        c.sim += v;
        c.by.set(s, (c.by.get(s) || 0) + v);
      });
    }
    // Taste-matching titles outside the similar graph, so the knobs can surface them.
    if (profile.size) {
      catalog.items
        .map((x) => [x, affinity(x.genres, profile) * (x.quality ? (x.quality - 3.5) : 0.3)])
        .sort((a, b) => b[1] - a[1]).slice(0, 300)
        .forEach(([x]) => cand(x.id));
    }

    // 👎 series: their neighbours are probably more of what the user doesn't want.
    for (const id of negatives) {
      (graph.sims.get(id) || []).forEach((cid, i) => { const c = cands.get(cid); if (c) c.neg += 1 - i / (SIM_N + 10); });
    }

    const maxSim = Math.max(1e-6, ...[...cands.values()].map((c) => c.sim));
    const maxNeg = Math.max(1, ...[...cands.values()].map((c) => c.neg));
    const topGenres = [...profile.keys()].slice(0, 5);
    const out = [];
    for (const c of cands.values()) {
      const x = c.x;
      if (tune.dubOnly && o.dub && !x.audio.includes(o.dub)) continue;
      const simN = c.sim / maxSim;
      const negN = c.neg / maxNeg;
      const aff = affinity(x.genres, profile);
      const qb = CRP.ext.quality(x);
      const q = qb == null ? 0.4 : qb;
      const popN = 1 - x.pop / N;
      const score =
        0.5 * simN +
        0.3 * aff * (1 - 0.75 * tune.explore) +
        0.1 * tune.explore * (1 - aff) +
        0.22 * q +
        0.05 * popN +
        0.2 * tune.pop * (2 * popN - 1) +
        0.18 * tune.len * lenScore(x) +
        0.15 * tune.era * eraScore(x) -
        0.45 * negN;

      const by = [...c.by].sort((a, b) => b[1] - a[1]).map(([s]) => s);
      const traits = [];
      if (x.kind === 'movie_listing') traits.push(t('Película'));
      else if (x.episodes) traits.push(x.episodes <= 13 ? t('Corta · {n} ep', { n: x.episodes }) : x.episodes > 75 ? t('Larga · {n} ep', { n: x.episodes }) : t('{n} ep', { n: x.episodes }));
      if (popN < 0.4 && q > 0.55) traits.push(t('Joya poco conocida'));
      if (o.dub && x.audio.includes(o.dub)) traits.push(t('En {lang}', { lang: CRP.util.langLower(o.dub) }));
      if (CRP.catalog.isAiring(x)) traits.push(t('En emisión'));
      out.push({
        series: x,
        score,
        main: by[0] ? by[0].id : null,
        because: by.slice(0, 2).map((s) => ({ title: s.title, liked: s.kind === 'like', score: s.kind === 'import' ? s.s : null, stars: s.stars || null })),
        moreSeeds: Math.max(0, by.length - 2),
        genres: x.genres.filter((g) => topGenres.includes(g)).slice(0, 2),
        traits,
        disliked: negN > 0.5,
      });
    }
    out.sort((a, b) => b.score - a.score);

    // Diversity: at most 4 picks driven by the same seed.
    const per = new Map();
    const picked = [];
    for (const r of out) {
      if (r.main) {
        const n = per.get(r.main) || 0;
        if (n >= 4) continue;
        per.set(r.main, n + 1);
      }
      picked.push(r);
      if (picked.length >= (o.limit || 60)) break;
    }
    return {
      items: picked,
      profile: [...profile].slice(0, 8).map(([id, w]) => ({ id, w })),
      seeds: graph.seeds,
    };
  }

  // One line explaining a pick.
  function why(r) {
    const parts = [];
    if (r.because.length) {
      const b0 = r.because[0];
      const and = (list) => (list.length > 1 ? t('{a} y {b}', { a: list[0], b: list[1] }) : list[0]);
      const names = and(r.because.map((b) => b.title));
      const line = b0.stars ? t('Porque le diste {stars}★ a {names}', { stars: b0.stars, names })
        : b0.score != null ? t('Porque le diste un {n} a {names}', { n: Math.round(b0.score / 10), names })
          : b0.liked ? t('Porque te gustó {names}', { names }) : t('Porque viste {names}', { names });
      parts.push(line + (r.moreSeeds ? ` (+${r.moreSeeds})` : ''));
    } else if (r.genres.length) {
      const g = r.genres.map(M.genreTitle);
      const genres = g.length > 1 ? t('{a} y {b}', { a: g[0], b: g[1] }) : g[0];
      parts.push(t('Encaja con tu gusto por {genres}', { genres: CRP.i18n.current() === 'de' ? genres : genres.toLowerCase() }));
    }
    return parts.join(' · ');
  }

  return { seriesStats, prepare, extend, rank, why };
})();
