// One search engine for every place that shows filtered results: the Buscar view and
// the user's own shelves on Hoy. A search state is { text, facets, sort }:
//   · text   — natural-language query (parsed by CRP.query)
//   · facets — explicit sidebar choices; a key set to null means "cualquiera" and
//              overrides whatever the text said for that field
//   · sort   — explicit sort id, or null for automatic
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.finder = (() => {
  const cat = CRP.catalog;
  const likeCache = new Map();   // seriesId -> ordered similar ids | null while loading

  function parse(text, ctx) {
    const index = cat.current();
    return CRP.query.parse(text || '', {
      dub: ctx.dub() || 'es-ES',
      findTitle: cat.findTitle,
      currentSeason: index && index.tags && index.tags[0],
    });
  }

  const ARRAYS = ['audio', 'genresIn', 'genresOut', 'tagsIn', 'tagsOut'];

  function effective(p, facets, onLikeReady) {
    const F = { ...p.F };
    for (const k of ARRAYS) F[k] = [...(p.F[k] || [])];
    for (const [k, v] of Object.entries(facets || {})) {
      if (k === 'len') { delete F.epsMin; delete F.epsMax; }
      if (k === 'year') { delete F.yearMin; delete F.yearMax; }
      if (v === null) { delete F[k]; continue; }
      if (k === 'year') Object.assign(F, v);
      else F[k] = Array.isArray(v) ? [...v] : v;
    }
    for (const k of ARRAYS) F[k] = F[k] || [];
    if (p.rest) F.text = p.rest;
    let likePending = false;
    if (p.like && !(facets && 'like' in facets)) {
      const ids = likeCache.get(p.like.id);
      F.likeIds = new Set(ids || []);
      F.likeOrder = new Map((ids || []).map((id, i) => [id, i]));
      likePending = !ids;
      if (ids === undefined) {
        likeCache.set(p.like.id, null);
        CRP.api.similar(p.like.id, 60)
          .then((list) => { likeCache.set(p.like.id, list.map((x) => x.id)); onLikeReady && onLikeReady(); })
          .catch(() => { likeCache.set(p.like.id, []); onLikeReady && onLikeReady(); });
      }
    }
    return { F, likePending };
  }

  const hasFilters = (F) => !!(F.audio.length || F.len || F.epsMin || F.epsMax || F.ratingMin || F.alMin || F.yearMin || F.yearMax ||
    F.status || F.season || F.genresIn.length || F.genresOut.length || F.tagsIn.length || F.tagsOut.length ||
    F.studio || F.source || F.mine || F.noMature || F.likeIds);

  /**
   * @returns {{ p, F, list, sortId, ignored, likePending }}
   */
  function run(state, ctx, onLikeReady) {
    const p = parse(state.text, ctx);
    const { F, likePending } = effective(p, state.facets, onLikeReady);
    const sortId = state.sort || p.sort || (F.text || F.likeIds ? 'relevance' : 'popular');
    let list = cat.query(F, ctx, sortId);
    let ignored = null;
    // Free text that matches nothing, alongside real filters, is probably noise.
    if (!list.length && F.text && hasFilters(F)) {
      ignored = F.text;
      delete F.text;
      list = cat.query(F, ctx, sortId);
    }
    return { p, F, list, sortId, ignored, likePending };
  }

  // Readable name for a search state ("Corta · Audio castellano · Isekai").
  function describe(state, ctx) {
    const p = parse(state.text, ctx);
    const parts = p.chips.map((c) => c.label);
    if (p.rest) parts.push(`“${p.rest}”`);
    const f = state.facets || {};
    if (f.genresIn) parts.push(...f.genresIn.map(CRP.model.genreTitle));
    if (f.tagsIn) parts.push(...f.tagsIn.map(CRP.tags.label));
    if (f.studio) parts.push(f.studio);
    return parts.slice(0, 4).join(' · ') || t('Mi estantería');
  }

  return { parse, run, effective, hasFilters, describe };
})();
