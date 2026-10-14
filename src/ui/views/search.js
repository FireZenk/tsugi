// "Buscar": the whole catalog, filtered instantly. Two inputs drive one filter state:
//   · the header query (natural language, parsed by CRP.query into chips), and
//   · the facet sidebar (with live counts per option).
// A facet click replaces whatever the text said for that field, so there's always one
// source of truth per field. Any search can be saved as a shelf on Hoy.
var CRP = globalThis.CRP || (globalThis.CRP = {});
CRP.views = CRP.views || {};

CRP.views.search = (ctx) => {
  const { h, fill, langName, debounce, fmtNum } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;
  const cat = CRP.catalog;
  const T = CRP.tags;
  const year = new Date().getFullYear();

  let text = '';
  let facets = {};          // explicit sidebar choices; null = "cualquiera" (overrides the text)
  let sort = null;          // explicit sort; null = automatic
  let last = null;          // last run, for chip removal
  let showAllThemes = false;

  const side = h('aside.facets');
  const head = h('div.reshead');
  const results = h('div.results');
  const el = h('div.view.search', side, h('div.resmain', head, results));

  const state = () => ({ text, facets, sort });

  // Remove text chips that set any of `fields`, then apply the facet value.
  function setFacet(field, value) {
    const p = last ? last.p : CRP.finder.parse(text, ctx);
    const doomed = p.chips.filter((c) => (c.fields || []).includes(field)).sort((a, b) => b.start - a.start);
    for (const c of doomed) text = CRP.query.removeSpan(text, c);
    if (doomed.length) ctx.setQueryText(text);
    facets = { ...facets, [field]: value };
    if (value === undefined) delete facets[field];
    render();
  }

  // Tri-state chip cycle (none → include → exclude → none) for genres and themes.
  function cycle(kindIn, kindOut, chipKey, id, st, F) {
    const p = last ? last.p : CRP.finder.parse(text, ctx);
    p.chips.filter((c) => c[chipKey] === id).sort((a, b) => b.start - a.start).forEach((c) => { text = CRP.query.removeSpan(text, c); });
    ctx.setQueryText(text);
    const inc = (facets[kindIn] || F[kindIn]).filter((x) => x !== id);
    const exc = (facets[kindOut] || F[kindOut]).filter((x) => x !== id);
    if (st === '') inc.push(id); else if (st === 'in') exc.push(id);
    facets = { ...facets, [kindIn]: inc, [kindOut]: exc };
    render();
  }

  // ---------------------------------------------------------------- facets
  function radioGroup(title, field, options, F, group = field) {
    const counts = cat.counts(F, ctx, group, options.filter((o) => o.patch).map((o) => ({ id: o.id, patch: o.patch })));
    const current = options.find((o) => o.active && o.active(F));
    const items = options.map((o) => {
      const on = o.patch ? current === o : !current;
      return h('button.fopt' + (on ? '.on' : '') + (o.patch && counts[o.id] === 0 && !on ? '.dim' : ''), {
        onclick: () => setFacet(field, on && o.patch ? null : (o.value === undefined ? null : o.value)),
      }, h('span', o.title), o.patch ? h('small', counts[o.id]) : null);
    });
    return h('div.fgroup', h('h4', title), h('div.fopts', items));
  }

  // Themes / studios / sources present in the results the other filters leave.
  function vocabularyOf(F, group) {
    const base = cat.base(F, ctx, group);
    const themes = new Map();
    const studios = new Map();
    const sources = new Map();
    for (const x of base) {
      const th = CRP.ext.themes(x.id);
      if (th) for (const n of th) themes.set(n, (themes.get(n) || 0) + 1);
      for (const st of CRP.ext.studios(x.id)) studios.set(st, (studios.get(st) || 0) + 1);
      const src = CRP.ext.source(x.id);
      if (src) sources.set(src, (sources.get(src) || 0) + 1);
    }
    return { themes, studios, sources };
  }

  function renderFacets(F) {
    const dub = ctx.dub();
    const index = cat.current();
    const audios = [...new Set([dub, 'es-ES', 'es-419', 'ja-JP', 'en-US'].filter(Boolean))];
    const audioCounts = cat.counts(F, ctx, 'audio', audios.map((a) => ({ id: a, patch: { audio: [a] } })));
    const genres = M.allGenres().sort((a, b) => a.title.localeCompare(b.title));
    const gCounts = cat.counts(F, ctx, 'genres', genres.map((g) => ({ id: g.id, patch: { genresIn: [...F.genresIn.filter((x) => x !== g.id), g.id], genresOut: F.genresOut.filter((x) => x !== g.id) } })));

    const groups = [];
    if (ctx.loggedIn || CRP.profile.active()) {
      groups.push(radioGroup(t('Para mí'), 'mine', [
        { id: 'any', title: t('Todo') },
        { id: 'unseen', title: t('Sin ver'), value: 'unseen', patch: { mine: 'unseen' }, active: (f) => f.mine === 'unseen' },
        { id: 'watchlist', title: t('En mi lista'), value: 'watchlist', patch: { mine: 'watchlist' }, active: (f) => f.mine === 'watchlist' },
        { id: 'progress', title: t('Empezadas'), value: 'progress', patch: { mine: 'progress' }, active: (f) => f.mine === 'progress' },
        { id: 'seen', title: t('Ya vistas'), value: 'seen', patch: { mine: 'seen' }, active: (f) => f.mine === 'seen' },
      ], F));
    }
    groups.push(h('div.fgroup', h('h4', t('Audio')), h('div.fopts', audios.map((a) => {
      const on = F.audio.includes(a);
      return h('button.fopt.check' + (on ? '.on' : '') + (!on && audioCounts[a] === 0 ? '.dim' : ''), {
        onclick: () => setFacet('audio', on ? F.audio.filter((x) => x !== a) : [...F.audio, a]),
      }, h('span', langName(a) + (a === dub ? ' ★' : '')), h('small', audioCounts[a]));
    }))));
    groups.push(radioGroup(t('Duración'), 'len', [
      { id: 'any', title: t('Cualquiera') },
      { id: 'movie', title: t('Película'), value: 'movie', patch: { len: 'movie' }, active: (f) => f.len === 'movie' },
      { id: 'short', title: t('Corta · ≤ 13 ep'), value: 'short', patch: { len: 'short' }, active: (f) => f.len === 'short' },
      { id: 'mid', title: t('Media · 14–26 ep'), value: 'mid', patch: { len: 'mid' }, active: (f) => f.len === 'mid' },
      { id: 'long', title: t('Larga · 27–75 ep'), value: 'long', patch: { len: 'long' }, active: (f) => f.len === 'long' },
      { id: 'huge', title: t('Muy larga · 75+'), value: 'huge', patch: { len: 'huge' }, active: (f) => f.len === 'huge' },
    ].concat(F.epsMin != null || F.epsMax != null ? [{ id: 'custom', title: `${F.epsMin || 1}–${F.epsMax || '∞'} ep (${t('texto')})`, patch: { epsMin: F.epsMin, epsMax: F.epsMax }, active: () => true }] : []), F));

    // Themes (AniList tags) — the most frequent in the current results, plus selected ones.
    const voc = vocabularyOf(F, 'tags');
    if (voc.themes.size || F.tagsIn.length || F.tagsOut.length) {
      const selected = [...F.tagsIn, ...F.tagsOut];
      const top = [...voc.themes].sort((a, b) => b[1] - a[1]).map(([n]) => n);
      const shown = [...new Set([...selected, ...top.slice(0, showAllThemes ? 80 : 24)])];
      groups.push(h('div.fgroup',
        h('h4', t('Temas') + ' ', h('small.hint', t('de AniList · clic: incluir · otro: excluir'))),
        h('div.gchips', shown.map((n) => {
          const st = F.tagsIn.includes(n) ? 'in' : F.tagsOut.includes(n) ? 'out' : '';
          return h('button.gchip' + (st ? '.' + st : ''), { title: n, onclick: () => cycle('tagsIn', 'tagsOut', 'tag', n, st, F) },
            st === 'out' ? '− ' : st === 'in' ? '+ ' : '', T.label(n), st === 'out' ? null : h('small', voc.themes.get(n) || 0));
        })),
        top.length > 24 ? h('button.linkbtn', { onclick: () => { showAllThemes = !showAllThemes; render(); } }, showAllThemes ? t('Ver menos') : t('Ver más ({n})', { n: Math.min(top.length, 80) - 24 })) : null));
    }

    const orMore = (v) => t('{v} o más', { v });
    groups.push(radioGroup(t('Nota mínima'), 'ratingMin', [
      { id: 'any', title: t('Cualquiera') },
      { id: '40', title: orMore('★ 4.0'), value: 4, patch: { ratingMin: 4 }, active: (f) => f.ratingMin === 4 },
      { id: '45', title: orMore('★ 4.5'), value: 4.5, patch: { ratingMin: 4.5 }, active: (f) => f.ratingMin === 4.5 },
      { id: '47', title: orMore('★ 4.7'), value: 4.7, patch: { ratingMin: 4.7 }, active: (f) => f.ratingMin === 4.7 },
    ].concat(F.ratingMin && ![4, 4.5, 4.7].includes(F.ratingMin) ? [{ id: 'custom', title: orMore(`★ ${F.ratingMin}`), patch: { ratingMin: F.ratingMin }, active: () => true }] : []), F, 'rating'));
    groups.push(radioGroup(t('Nota AniList'), 'alMin', [
      { id: 'any', title: t('Cualquiera') },
      { id: '70', title: orMore(70), value: 70, patch: { alMin: 70 }, active: (f) => f.alMin === 70 },
      { id: '80', title: orMore(80), value: 80, patch: { alMin: 80 }, active: (f) => f.alMin === 80 },
      { id: '85', title: orMore(85), value: 85, patch: { alMin: 85 }, active: (f) => f.alMin === 85 },
    ].concat(F.alMin && ![70, 80, 85].includes(F.alMin) ? [{ id: 'custom', title: orMore(F.alMin), patch: { alMin: F.alMin }, active: () => true }] : []), F, 'al'));

    const vs = vocabularyOf(F, 'source');
    if (vs.sources.size || F.source) {
      const srcOpts = [...vs.sources].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([src]) => (
        { id: src, title: T.sourceLabel(src), value: src, patch: { source: src }, active: (f) => f.source === src }));
      if (F.source && !srcOpts.some((o) => o.id === F.source)) srcOpts.push({ id: F.source, title: T.sourceLabel(F.source), value: F.source, patch: { source: F.source }, active: () => true });
      groups.push(radioGroup(t('Origen'), 'source', [{ id: 'any', title: t('Cualquiera') }, ...srcOpts], F));
    }
    const vst = vocabularyOf(F, 'studio');
    if (vst.studios.size || F.studio) {
      const studios = [...vst.studios].sort((a, b) => b[1] - a[1]).slice(0, 40);
      if (F.studio && !studios.some(([n]) => n === F.studio)) studios.unshift([F.studio, 0]);
      groups.push(h('div.fgroup', h('h4', t('Estudio')),
        ui.select([{ id: '', title: t('Cualquiera') }, ...studios.map(([n, c]) => ({ id: n, title: `${n} (${c})` }))], F.studio || '',
          (v) => setFacet('studio', v || null), t('Estudio'))));
    }

    const yr = (a, b) => (f) => (f.yearMin || null) === a && (f.yearMax || null) === b;
    const yearOpts = [
      { id: 'any', title: t('Cualquiera') },
      { id: 'new', title: `${year - 2}–${year}`, value: { yearMin: year - 2, yearMax: null }, patch: { yearMin: year - 2 }, active: yr(year - 2, null) },
      { id: '2020', title: `2020–${year - 3}`, value: { yearMin: 2020, yearMax: year - 3 }, patch: { yearMin: 2020, yearMax: year - 3 }, active: yr(2020, year - 3) },
      { id: '2010', title: '2010–2019', value: { yearMin: 2010, yearMax: 2019 }, patch: { yearMin: 2010, yearMax: 2019 }, active: yr(2010, 2019) },
      { id: 'old', title: t('Antes de 2010'), value: { yearMin: null, yearMax: 2009 }, patch: { yearMax: 2009 }, active: yr(null, 2009) },
    ];
    if ((F.yearMin || F.yearMax) && !yearOpts.some((o) => o.active && o.active(F))) {
      yearOpts.push({ id: 'custom', title: `${F.yearMin || '…'}–${F.yearMax || '…'} (${t('texto')})`, patch: { yearMin: F.yearMin, yearMax: F.yearMax }, active: () => true });
    }
    groups.push(radioGroup(t('Año'), 'year', yearOpts, F));
    groups.push(radioGroup(t('Estado'), 'status', [
      { id: 'any', title: t('Cualquiera') },
      { id: 'airing', title: t('En emisión'), value: 'airing', patch: { status: 'airing' }, active: (f) => f.status === 'airing' },
      { id: 'finished', title: t('Terminada'), value: 'finished', patch: { status: 'finished' }, active: (f) => f.status === 'finished' },
    ], F));
    if (index && index.tags && index.tags.length) {
      groups.push(radioGroup(t('Temporada'), 'season', [{ id: 'any', title: t('Cualquiera') }].concat(index.tags.map((tag) => (
        { id: tag.id, title: tag.title, value: tag.id, patch: { season: tag.id }, active: (f) => f.season === tag.id }))), F));
    }
    groups.push(h('div.fgroup',
      h('h4', t('Géneros') + ' ', h('small.hint', t('clic: incluir · otro clic: excluir'))),
      h('div.gchips', genres.map((g) => {
        const st = F.genresIn.includes(g.id) ? 'in' : F.genresOut.includes(g.id) ? 'out' : '';
        return h('button.gchip' + (st ? '.' + st : '') + (!st && gCounts[g.id] === 0 ? '.dim' : ''), {
          title: st === 'in' ? t('Incluido (clic para excluir)') : st === 'out' ? t('Excluido (clic para quitar)') : t('Clic para incluir'),
          onclick: () => cycle('genresIn', 'genresOut', 'genre', g.id, st, F),
        }, st === 'out' ? '− ' : st === 'in' ? '+ ' : '', g.title, h('small', st === 'out' ? '' : gCounts[g.id]));
      }))));
    groups.push(h('div.fgroup', ui.toggle(t('Sin contenido +18'), !!F.noMature, (v) => setFacet('noMature', v || null))));
    groups.push(h('button.btn.ghost.small.reset', { onclick: () => { facets = {}; sort = null; text = ''; ctx.setQueryText(''); render(); } }, t('Limpiar todo')));
    fill(side, groups);
  }

  // --------------------------------------------------------------- results
  const SORTS = [
    { id: 'relevance', title: t('Relevancia') },
    { id: 'rating', title: t('Mejor valoradas (CR + AniList)') },
    { id: 'anilist', title: t('Nota AniList') },
    { id: 'gems', title: t('Joyas ocultas') },
    { id: 'popular', title: t('Más populares') },
    { id: 'recent', title: t('Último episodio') },
    { id: 'year', title: t('Más nuevas') },
    { id: 'short', title: t('Más cortas') },
    { id: 'alpha', title: 'A–Z' },
  ];

  // "Guardar como estantería": inline name field, saved to settings (synced).
  function saveShelfUI() {
    const name = h('input.shelfname', { type: 'text', value: CRP.finder.describe(state(), ctx), maxlength: '60', 'aria-label': t('Nombre de la estantería') });
    const box = h('div.shelfsave', name,
      h('button.btn.small', {
        onclick: async () => {
          const shelves = [...(CRP.store.get().shelves || [])];
          shelves.push({ id: 's' + Date.now().toString(36), name: name.value.trim() || t('Mi estantería'), text, facets, sort });
          await CRP.store.set({ shelves });
          ui.toast(t('Estantería «{name}» añadida a Hoy', { name: name.value.trim() }));
          box.replaceWith(saveBtn());
          ctx.emit('shelves');
        },
      }, t('Guardar')),
      h('button.btn.ghost.small', { onclick: () => box.replaceWith(saveBtn()) }, t('Cancelar')));
    setTimeout(() => { name.focus(); name.select(); });
    return box;
  }
  const saveBtn = () => {
    const b = h('button.btn.ghost.small', { title: t('Guarda esta búsqueda como una fila fija en Hoy'), onclick: () => b.replaceWith(saveShelfUI()) }, ui.icon('plus', 14), t('Guardar como estantería'));
    return b;
  };

  function render() {
    if (!cat.current()) return;
    const r = CRP.finder.run(state(), ctx, render);
    last = r;
    renderFacets(r.F);

    const chips = r.p.chips.map((c) => h('span.qchip' + (c.kind === 'neg' ? '.neg' : c.kind === 'like' ? '.like' : ''), c.label,
      h('button', { title: t('Quitar'), onclick: () => { text = CRP.query.removeSpan(text, c); ctx.setQueryText(text); render(); } }, '×')));
    if (r.p.rest && !r.ignored) chips.push(h('span.qchip.text', `“${r.p.rest}”`));
    if (r.ignored) chips.push(h('span.qchip.ignored', { title: t('No hay resultados que lo contengan, así que se ha ignorado') }, t('“{x}” ignorado', { x: r.ignored })));
    const filtered = !!(text.trim() || Object.keys(facets).length);

    fill(head,
      h('div.qline',
        chips.length ? h('div.qchips', h('span.lbl', t('Entendido:')), chips) : h('div.qhelp', t('Escribe como hablas:') + ' ', h('i', `“${t('isekai corto en castellano, sin harén, de mappa')}”`)),
        h('div.rescount', r.likePending ? t('Buscando parecidas…') : r.list.length === 1 ? t('1 título') : t('{n} títulos', { n: fmtNum(r.list.length) })),
        filtered ? saveBtn() : null,
        ui.select(SORTS, r.sortId, (v) => { sort = v; render(); }, t('Ordenar')),
      ),
    );

    if (!r.list.length) {
      fill(results, ui.empty(r.likePending ? t('Buscando parecidas…') : t('Nada encaja con todo eso. Quita algún filtro o prueba otra frase.')));
      return;
    }
    fill(results, ui.lazyGrid(r.list, (s) => ui.posterCard(s, { ctx, badge: ctx.badge(s), actions: ['list', 'like', 'dislike'] })));
  }

  const rerender = debounce(render, 120);

  // -------------------------------------------------------------- lifecycle
  async function start() {
    fill(results, h('div.indexing',
      h('p', t('Preparando el catálogo completo para filtrar al instante…')),
      ui.progressBar(0.02, t('Primera vez: ~10–20 s. Después es inmediato.'))));
    const bar = results.querySelector('.pbar');
    const off = cat.onProgress((p) => bar && bar.set(p, `${Math.round(p * 100)}%`));
    try {
      await Promise.all([cat.load(), ctx.data.categories().catch(() => {})]);
      if (ctx.loggedIn) await Promise.all([ctx.data.history(), ctx.data.watchlist()]).catch(() => {});
    } catch (e) {
      fill(results, ui.errorBox(e, start));
      return;
    } finally { off(); }
    render();
  }
  cat.onUpdate(() => el.isConnected && render());
  ctx.on('watchlist', 'search', () => cat.current() && render());
  ctx.on('taste', 'search', () => cat.current() && render());
  ctx.on('ext', 'search', () => cat.current() && el.isConnected && render());
  start();

  return {
    el,
    title: t('Buscar'),
    setText(s) {
      text = s;
      // What you just typed wins over an older sidebar choice for the same field.
      if (cat.current()) {
        for (const c of CRP.finder.parse(text, ctx).chips) {
          for (const f of c.fields || []) {
            if ((f === 'genres' && c.genre) || (f === 'tags' && c.tag)) {
              const [a, b] = f === 'genres' ? ['genresIn', 'genresOut'] : ['tagsIn', 'tagsOut'];
              const id = c.genre || c.tag;
              if (facets[a]) facets[a] = facets[a].filter((g) => g !== id);
              if (facets[b]) facets[b] = facets[b].filter((g) => g !== id);
            } else if (f === 'sort') sort = null;
            else delete facets[f];
          }
        }
        rerender();
      }
    },
    // From other views: a full state { text, facets, sort } (shelves) or a facet patch.
    apply(patch) {
      const st = 'facets' in patch ? patch : { text: patch.text, facets: (({ text: _, ...rest }) => rest)(patch), sort: null };
      text = st.text || '';
      ctx.setQueryText(text);
      facets = { ...(st.facets || {}) };
      sort = st.sort || null;
      if (cat.current()) render();
    },
  };
};
