// "Hoy": answers "what do I watch now?" for the time you have, then what's in progress,
// this week's releases and one-click searches that are hard to do on Crunchyroll.
var CRP = globalThis.CRP || (globalThis.CRP = {});
CRP.views = CRP.views || {};

CRP.views.today = (ctx) => {
  const { h, fill, uniqBy, timeAgo, fmtMinutes, fmtTime, DAYS, sameDay, langName } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;
  const cat = CRP.catalog;

  const el = h('div.view.today');
  const pickBlock = ui.block({ title: '¿Qué veo ahora?', cls: 'pick' });
  const contBlock = ui.block({ title: 'Sigue viendo' });
  const weekBlock = ui.block({ title: 'Esta semana', controls: [h('button.btn.ghost.small', { onclick: () => ctx.go('agenda') }, 'Abrir agenda')] });
  const quickBlock = ui.block({ title: 'Búsquedas rápidas', subtitle: 'Cosas que en Crunchyroll no se pueden filtrar' });
  const shelvesHost = h('div.shelves');
  fill(el, pickBlock.el, contBlock.el, shelvesHost, weekBlock.el, quickBlock.el);

  // ------------------------------------------------------------ shelves
  // The user's saved searches, each a live row (same engine as Buscar).
  async function saveShelves(shelves) {
    await CRP.store.set({ shelves });
    renderShelves();
  }
  function renderShelves() {
    if (!cat.current()) return;
    const shelves = CRP.store.get().shelves || [];
    if (!shelves.length) {
      fill(shelvesHost, h('div.shelfhint', ui.icon('sparkle', 16),
        h('span', 'Crea tus propias filas: busca algo en ', h('b', 'Buscar'), ' (p. ej. «isekai corto en castellano, sin harén») y pulsa «Guardar como estantería».'),
        h('button.btn.ghost.small', { onclick: () => saveShelves([{ id: 's' + Date.now().toString(36), name: 'Lo mejor según AniList que no has visto', text: 'anilist 85 sin ver', facets: {}, sort: null }]) }, 'Añadir un ejemplo')));
      return;
    }
    fill(shelvesHost, shelves.map((sh, i) => {
      const r = CRP.finder.run(sh, ctx, renderShelves);
      const title = h('h2', sh.name);
      const rename = () => {
        const input = h('input.shelfname', { type: 'text', value: sh.name, maxlength: '60' });
        const done = async () => { const all = [...shelves]; all[i] = { ...sh, name: input.value.trim() || sh.name }; await saveShelves(all); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') renderShelves(); });
        input.addEventListener('blur', done);
        title.replaceWith(input);
        input.focus();
        input.select();
      };
      const b = ui.block({
        title: sh.name,
        subtitle: r.likePending ? 'Buscando…' : `${r.list.length} título${r.list.length === 1 ? '' : 's'}`,
        controls: [
          h('button.btn.ghost.small', { onclick: () => ctx.search({ text: sh.text, facets: sh.facets || {}, sort: sh.sort || null }) }, 'Ver todo'),
          h('button.icon', { title: 'Renombrar', onclick: rename }, '✎'),
          i > 0 ? h('button.icon', { title: 'Subir', onclick: () => { const all = [...shelves]; [all[i - 1], all[i]] = [all[i], all[i - 1]]; saveShelves(all); } }, ui.icon('up', 16)) : null,
          h('button.icon', {
            title: 'Quitar estantería',
            onclick: () => {
              saveShelves(shelves.filter((x) => x.id !== sh.id));
              ui.toast(`Estantería «${sh.name}» quitada`, { action: { label: 'Deshacer', run: () => saveShelves(shelves) } });
            },
          }, ui.icon('x', 16)),
        ],
        cls: 'shelf',
      });
      b.el.querySelector('h2').replaceWith(title);
      b.setBody(r.list.length
        ? ui.row(r.list.slice(0, 24).map((x) => ui.posterCard(x, { ctx, badge: ctx.badge(x), actions: ['list', 'like', 'dislike'] })))
        : ui.empty('Ahora mismo nada encaja con esta estantería.'));
      return b.el;
    }));
  }

  let mode = null;
  let modeChosen = false;   // until the user picks, re-choose the default as data arrives
  let offset = 0;

  // ------------------------------------------------------------- the pick
  // Each mode returns candidates: { kind: 'ep', e, label } | { kind: 'series', s, why, traits }
  function candidates(m, ag, recs) {
    const now = Date.now();
    if (m === 'short') {
      const eps = (ag ? ag.series : []).filter((s) => s.state === 'active' && s.next)
        .sort((a, b) => {
          const fresh = (s) => (s.next.airDate && now - Date.parse(s.next.airDate) < 3 * 86400000 ? 1 : 0);
          return fresh(b) - fresh(a) || b.lastWatched - a.lastWatched;
        })
        .map((s) => ({
          kind: 'ep', e: s.next, series: s,
          label: s.next.airDate && now - Date.parse(s.next.airDate) < 3 * 86400000
            ? `Nuevo · salió ${timeAgo(s.next.airDate)}`
            : `Te quedan ${s.pendingCount} ep de ${s.title}`,
        }));
      return eps;
    }
    if (m === 'evening') {
      const finish = (ag ? ag.series : []).filter((s) => s.state === 'active' && s.next && s.pendingCount <= 4 && s.pendingMin <= 130)
        .map((s) => ({ kind: 'ep', e: s.next, series: s, label: `Termínala esta noche: ${s.pendingCount} ep · ${fmtMinutes(s.pendingMin)}` }));
      const movies = (recs || []).filter((r) => r.series.kind === 'movie_listing')
        .map((r) => ({ kind: 'series', s: r.series, why: CRP.recs.why(r), traits: r.traits }));
      return finish.concat(movies);
    }
    // binge: finished series, 10–40 episodes, best ranked
    return (recs || []).filter((r) => r.series.kind !== 'movie_listing' && !cat.isAiring(r.series) && r.series.episodes >= 10 && r.series.episodes <= 40)
      .map((r) => ({ kind: 'series', s: r.series, why: CRP.recs.why(r), traits: r.traits }));
  }

  function bigCard(c) {
    if (c.kind === 'ep') {
      const e = c.e;
      return h('div.bigpick',
        h('a.bpart', { href: M.episodeUrl(e), style: e.thumb ? { backgroundImage: `url("${e.thumb}")` } : null }, h('span.playbtn.on', ui.icon('play', 40))),
        h('div.bptext',
          h('div.bplabel', c.label),
          h('h3', e.seriesTitle || c.series.title),
          h('div.bpsub', `${M.epLabel(e)} — ${e.title}`),
          h('div.bpacts',
            h('a.btn', { href: M.episodeUrl(e) }, ui.icon('play', 16), 'Ver ahora'),
            h('button.btn.ghost', { onclick: () => ctx.openSeries(cat.get(c.series.id) || { id: c.series.id, title: c.series.title, genres: [], audio: [], subs: [] }) }, 'Ficha'),
            h('button.btn.ghost', { onclick: () => { offset++; renderPick(); } }, ui.icon('refresh', 14), 'Otra'))));
    }
    const s = c.s;
    return h('div.bigpick',
      h('button.bpart', { onclick: () => ctx.openSeries(s, { reason: c.why }), style: s.wide ? { backgroundImage: `url("${s.wide}")` } : null }),
      h('div.bptext',
        h('div.bplabel', c.why || 'Recomendada para ti'),
        h('h3', s.title),
        h('div.bpsub', ui.ratingEl(s, { votes: true }), ui.alEl(s), ' ', (c.traits || []).join(' · ')),
        s.description ? h('p.bpdesc', s.description) : null,
        h('div.bpacts',
          h('button.btn', { onclick: () => ctx.openSeries(s, { reason: c.why }) }, ui.icon('play', 16), 'Empezar'),
          h('button.btn.ghost.icononly', { title: 'Me gusta', onclick: () => ctx.like(s) }, ui.icon('thumbUp', 16)),
          h('button.btn.ghost.icononly', { title: 'No me interesa', onclick: async () => { await ctx.dislike(s); renderPick(); } }, ui.icon('thumbDown', 16)),
          h('button.btn.ghost', { onclick: () => { offset++; renderPick(); } }, ui.icon('refresh', 14), 'Otra'))));
  }

  function miniCard(c) {
    if (c.kind === 'ep') {
      return h('a.altpick', { href: M.episodeUrl(c.e) }, ui.img(c.e.thumb, c.e.title, 'altimg'),
        h('div', h('b', c.e.seriesTitle || c.series.title), h('small', `${M.epLabel(c.e)} · ${c.label}`)));
    }
    return h('button.altpick', { onclick: () => ctx.openSeries(c.s, { reason: c.why }) }, ui.img(c.s.wide || c.s.poster, c.s.title, 'altimg'),
      h('div', h('b', c.s.title), h('small', [c.s.rating ? `★ ${c.s.rating.toFixed(1)}` : null, ...(c.traits || []).slice(0, 2)].filter(Boolean).join(' · '))));
  }

  let ag = null;
  let ranked = null;
  function renderPick() {
    const modes = [
      { id: 'short', title: 'Un rato', sub: '~25 min', icon: 'clock' },
      { id: 'evening', title: 'Una tarde', sub: '1–2 h', icon: 'calendar' },
      { id: 'binge', title: 'Maratón', sub: 'serie entera', icon: 'sparkle' },
    ];
    if (!modeChosen) mode = !ag || ag.series.some((s) => s.state === 'active' && s.next) ? 'short' : 'binge';
    const list = candidates(mode, ag, ranked && ranked.items).filter((c) => !(c.kind === 'series' && CRP.store.isHidden(c.s.id)));
    pickBlock.setControls(ui.segmented(modes, mode, (m) => { mode = m; modeChosen = true; offset = 0; renderPick(); }));
    if (!list.length) {
      const waiting = !ag || !ranked;
      pickBlock.setBody(waiting ? ui.skeleton('ep', 1) : ui.empty(mode === 'short'
        ? 'No tienes episodios pendientes de lo que sigues. Prueba «Maratón».'
        : 'No hay propuestas para este plan. Prueba otro o ajusta «Para ti».'));
      return;
    }
    const i = offset % list.length;
    const main = list[i];
    const alts = list.filter((_, j) => j !== i).slice(0, 3);
    pickBlock.setBody(bigCard(main), alts.length ? h('div.alts', h('span.lbl', 'O también:'), alts.map(miniCard)) : null);
  }

  // ---------------------------------------------------------- continue
  async function renderContinue() {
    if (!ctx.loggedIn) { contBlock.el.hidden = true; return; }
    contBlock.setBody(ui.skeleton('ep', 5));
    try {
      const items = await ctx.data.continue();
      const list = uniqBy(items.filter((it) => !it.fully_watched).map((it) => ({ it, e: M.episode(it.panel) })).filter((x) => x.e), (x) => x.e.seriesId || x.e.id);
      if (!list.length) { contBlock.el.hidden = true; return; }
      contBlock.setBody(ui.row(list.map(({ it, e }) => {
        const p = it.playhead && e.durationMs ? (it.playhead * 1000) / e.durationMs : 0;
        return ui.episodeCard(e, { progress: p > 0.02 ? p : 0, badge: it.new ? 'NUEVO' : null, sub: p > 0.02 ? null : 'Siguiente episodio' });
      }), { kind: 'ep' }));
    } catch (e) {
      contBlock.setBody(ui.errorBox(e, renderContinue));
    }
  }

  // -------------------------------------------------------------- week
  function renderWeek() {
    if (!ag) return;
    const today = new Date();
    const any = ag.week.some((d) => d.items.length);
    if (!any) { weekBlock.setBody(ui.empty('Nada de lo que sigues se estrena esta semana.')); return; }
    weekBlock.setSubtitle(`${ag.totals.pending} ep pendientes · ${fmtMinutes(ag.totals.minutes)}`);
    weekBlock.setBody(h('div.weekmini', ag.week.map((d) => h('div.wd' + (sameDay(d.date, today) ? '.today' : ''),
      h('b', `${DAYS[d.date.getDay()]} ${d.date.getDate()}`),
      d.items.slice(0, 4).map((it) => h('div.wdi.' + (it.watched ? 'watched' : it.t > Date.now() ? 'upcoming' : 'available'),
        { title: `${it.series.title} · ${fmtTime(new Date(it.t))}` }, it.series.title)),
      d.items.length > 4 ? h('small', `+${d.items.length - 4}`) : null))));
  }

  // ------------------------------------------------------------- quick
  function renderQuick() {
    const dub = ctx.dub();
    const dubWord = dub ? langName(dub).toLowerCase() : null;
    const top = ranked && ranked.seeds.find((s) => s.kind === 'history');
    const index = cat.current();
    const season = index && index.tags && index.tags[0];
    const presets = [
      dubWord && { label: `Cortas en ${dubWord}, bien valoradas`, q: `cortas en ${dubWord} buenas sin ver` },
      { label: 'Joyas ocultas que no has visto', q: 'joyas ocultas sin ver' },
      { label: 'Lo mejor según AniList que no has visto', q: 'anilist 85 sin ver' },
      { label: 'Terminadas para hacer maratón', q: 'terminadas buenas sin ver' },
      top && { label: `Como ${top.title}`, q: `como ${top.title} sin ver` },
      season && { label: `${season.title}, mejor valoradas`, q: 'esta temporada buenas' },
      { label: 'Películas ★ 4.5+', q: 'peliculas nota 4.5' },
      { label: 'Clásicas imprescindibles', q: 'clasicas muy buenas' },
      dubWord && { label: `En emisión con doblaje en ${dubWord}`, q: `en emision en ${dubWord}` },
      { label: 'Sin romance ni comedia', q: 'sin romance ni comedia buenas' },
    ].filter(Boolean);
    quickBlock.setBody(h('div.quick', presets.map((p) => h('button.qbtn', { onclick: () => ctx.search({ text: p.q }) },
      ui.icon('search', 14), h('span', p.label), h('small', `“${p.q}”`)))));
  }

  async function start() {
    renderPick();
    renderContinue();
    renderQuick();
    if (!ctx.loggedIn) {
      weekBlock.el.hidden = true;
      pickBlock.setBody(ui.empty('Inicia sesión y aquí tendrás una propuesta concreta según el tiempo que tengas.', h('button.btn', { onclick: () => ctx.openOriginal() }, 'Iniciar sesión')));
      return;
    }
    weekBlock.setBody(ui.skeleton('ep', 1));
    ctx.data.agenda().then((a) => { ag = a; renderPick(); renderWeek(); }).catch((e) => weekBlock.setBody(ui.errorBox(e, start)));
    ctx.data.graph().then(() => { ranked = ctx.rank(80); renderPick(); renderQuick(); }).catch(() => { ranked = { items: [], seeds: [] }; renderPick(); });
  }

  ctx.on('taste', 'today', () => { if (ctx.data.graphNow()) { ranked = ctx.rank(80); renderPick(); } renderShelves(); });
  ctx.on('shelves', 'today', renderShelves);
  ctx.on('watchlist', 'today', renderShelves);
  ctx.on('ext', 'today', renderShelves);
  CRP.catalog.load().then(renderShelves).catch(() => {});
  start();
  return { el, title: 'Hoy' };
};
