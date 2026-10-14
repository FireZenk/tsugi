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
  const pickBlock = ui.block({ title: t('¿Qué veo ahora?'), cls: 'pick' });
  const contBlock = ui.block({ title: t('Sigue viendo') });
  const weekBlock = ui.block({ title: t('Esta semana'), controls: [h('button.btn.ghost.small', { onclick: () => ctx.go('agenda') }, t('Abrir agenda'))] });
  const quickBlock = ui.block({ title: t('Búsquedas rápidas'), subtitle: t('Cosas que en Crunchyroll no se pueden filtrar') });
  const shelvesHost = h('div.shelves');
  const moodBlock = ui.block({ title: t('¿Qué te apetece?'), subtitle: t('Elige un plan y te enseño lo mejor que no has visto') });
  fill(el, pickBlock.el, contBlock.el, moodBlock.el, shelvesHost, weekBlock.el, quickBlock.el);

  // ---------------------------------------------------------------- moods
  // Each mood is just a search (same parser and engine as Buscar), best rated first.
  // Queries are written in the UI language (the parser understands it).
  const MOODS = [
    { id: 'light', title: t('Algo ligero'), q: t('comedia sin tragedia ni gore sin ver') },
    { id: 'epic', title: t('Épico'), q: t('accion aventura buenas sin ver') },
    { id: 'cry', title: t('Para llorar'), q: t('drama tragedia sin ver') },
    { id: 'think', title: t('Para pensar'), q: t('psicologico sin ver') },
    { id: 'mystery', title: t('Misterio'), q: t('misterio sin ver') },
    { id: 'love', title: t('Romántico'), q: t('romance sin tragedia sin ver') },
    { id: 'chill', title: t('Relajante'), q: t('relajante sin ver') },
    { id: 'tense', title: t('Tensión'), q: t('supervivencia sin ver') },
    { id: 'fantasy', title: t('Otros mundos'), q: t('isekai sin ver') },
  ];
  let mood = null;
  function renderMood() {
    if (!cat.current()) return;
    const runs = MOODS.map((m) => ({ m, r: CRP.finder.run({ text: m.q, facets: {}, sort: 'rating' }, ctx, renderMood) }));
    const chipsEl = ui.chips(runs.map(({ m, r }) => ({ id: m.id, title: m.title, count: r.list.length })), {
      value: mood, onChange: (v) => { mood = v === mood ? null : v; renderMood(); },
    });
    const cur = runs.find((x) => x.m.id === mood);
    moodBlock.setBody(chipsEl, cur
      ? h('div.moodrow',
        cur.r.list.length
          ? ui.row(cur.r.list.slice(0, 18).map((x) => ui.posterCard(x, { ctx, badge: ctx.badge(x), actions: ['list', 'like', 'dislike'] })))
          : ui.empty(t('Nada sin ver con este plan. Prueba otro.')),
        h('button.btn.ghost.small', { onclick: () => ctx.search({ text: cur.m.q, facets: {}, sort: 'rating' }) }, t('Ver las {n} en Buscar', { n: cur.r.list.length })))
      : null);
  }

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
        h('span', t('Crea tus propias filas: busca algo en «Buscar» (p. ej. «{example}») y pulsa «Guardar como estantería».', { example: t('isekai corto en castellano, sin harén') })),
        h('button.btn.ghost.small', { onclick: () => saveShelves([{ id: 's' + Date.now().toString(36), name: t('Lo mejor según AniList que no has visto'), text: t('anilist 85 sin ver'), facets: {}, sort: null }]) }, t('Añadir un ejemplo'))));
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
        subtitle: r.likePending ? t('Buscando…') : r.list.length === 1 ? t('1 título') : t('{n} títulos', { n: r.list.length }),
        controls: [
          h('button.btn.ghost.small', { onclick: () => ctx.search({ text: sh.text, facets: sh.facets || {}, sort: sh.sort || null }) }, t('Ver todo')),
          h('button.icon', { title: t('Renombrar'), onclick: rename }, '✎'),
          i > 0 ? h('button.icon', { title: t('Subir'), onclick: () => { const all = [...shelves]; [all[i - 1], all[i]] = [all[i], all[i - 1]]; saveShelves(all); } }, ui.icon('up', 16)) : null,
          h('button.icon', {
            title: t('Quitar estantería'),
            onclick: () => {
              saveShelves(shelves.filter((x) => x.id !== sh.id));
              ui.toast(t('Estantería «{name}» quitada', { name: sh.name }), { action: { label: t('Deshacer'), run: () => saveShelves(shelves) } });
            },
          }, ui.icon('x', 16)),
        ],
        cls: 'shelf',
      });
      b.el.querySelector('h2').replaceWith(title);
      b.setBody(r.list.length
        ? ui.row(r.list.slice(0, 24).map((x) => ui.posterCard(x, { ctx, badge: ctx.badge(x), actions: ['list', 'like', 'dislike'] })))
        : ui.empty(t('Ahora mismo nada encaja con esta estantería.')));
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
            ? t('Nuevo · salió {ago}', { ago: timeAgo(s.next.airDate) })
            : t('Te quedan {n} ep de {title}', { n: s.pendingCount, title: s.title }),
        }));
      return eps;
    }
    const queue = ctx.queue(ag).map((q) => cat.get(q.id)).filter(Boolean);
    const fromRecs = (r) => ({ kind: 'series', s: r.series, why: CRP.recs.why(r), traits: r.traits });
    if (m === 'evening') {
      // finish something tonight, then a movie or an OVA/special (1–4 episodes): from
      // your queue, then your recommendations, then the best rated you haven't seen
      const finish = (ag ? ag.series : []).filter((s) => s.state === 'active' && s.next && s.pendingCount <= 4 && s.pendingMin <= 130)
        .map((s) => ({ kind: 'ep', e: s.next, series: s, label: t('Termínala esta noche: {n} ep · {time}', { n: s.pendingCount, time: fmtMinutes(s.pendingMin) }) }));
      const queued = queue.filter(fitsEvening).map((x) => ({ kind: 'series', s: x, why: t('Siguiente en tu cola'), traits: eveningTraits(x) }));
      const recShort = (recs || []).filter((r) => fitsEvening(r.series)).map(fromRecs);
      return uniqPicks([...finish, ...queued, ...recShort, ...eveningBest()]);
    }
    // binge: your queue (whole series only), then finished series of 10–40 episodes, best ranked
    const queued = queue.filter((x) => x.kind !== 'movie_listing' && x.episodes >= 8)
      .map((x) => ({ kind: 'series', s: x, why: t('Siguiente en tu cola'), traits: [t('{n} ep', { n: x.episodes })] }));
    return uniqPicks(queued.concat((recs || []).filter((r) => r.series.kind !== 'movie_listing' && !cat.isAiring(r.series) && r.series.episodes >= 10 && r.series.episodes <= 40)
      .map(fromRecs)));
  }

  // An evening: a movie, or an OVA / special / mini-series of 1–4 episodes.
  const fitsEvening = (x) => !!x && (x.kind === 'movie_listing' || (x.episodes >= 1 && x.episodes <= 4));
  const eveningTraits = (x) => [
    x.kind === 'movie_listing' ? t('Película') : t('Corta · {n} ep', { n: x.episodes }),
    ctx.dub() && x.audio.includes(ctx.dub()) ? t('En {lang}', { lang: CRP.util.langLower(ctx.dub()) }) : null,
  ].filter(Boolean);
  const uniqPicks = (list) => {
    const ids = new Set();
    return list.filter((c) => { const id = c.kind === 'ep' ? c.series.id : c.s.id; if (ids.has(id)) return false; ids.add(id); return true; });
  };
  // Unseen movies and short specials, by blended rating + how well they fit your genres
  // (+ your dub). The "similar to" graph behind recommendations rarely yields movies.
  function eveningBest() {
    if (!cat.current()) return [];
    const prof = new Map(((ranked && ranked.profile) || []).map((g) => [g.id, g.w]));
    const dub = ctx.dub();
    const run = (text) => CRP.finder.run({ text, facets: {}, sort: 'rating' }, ctx).list;
    const pool = [...run('peliculas sin ver'), ...run('hasta 4 ep sin ver')].filter(fitsEvening);
    return pool.map((x) => {
      const match = x.genres.filter((g) => prof.has(g)).sort((a, b) => prof.get(b) - prof.get(a));
      const aff = Math.min(1, match.reduce((sum, g) => sum + prof.get(g), 0));
      const q = CRP.ext.quality(x);
      return { x, match, score: (q == null ? 0.4 : q) + 0.35 * aff + (dub && x.audio.includes(dub) ? 0.1 : 0) };
    }).sort((a, b) => b.score - a.score).slice(0, 30).map(({ x, match }) => ({
      kind: 'series', s: x, traits: eveningTraits(x),
      why: match.length ? t('Encaja con tu gusto por {genres}', { genres: CRP.model.genreTitle(match[0]).toLowerCase() }) : t('De lo mejor valorado que no has visto'),
    }));
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
            h('a.btn', { href: M.episodeUrl(e) }, ui.icon('play', 16), t('Ver ahora')),
            h('button.btn.ghost', { title: t('Marcar este episodio como visto'), onclick: () => ctx.markWatched(e) }, ui.icon('check', 14), t('Ya lo vi')),
            h('button.btn.ghost', { onclick: () => ctx.openSeries(cat.get(c.series.id) || { id: c.series.id, title: c.series.title, genres: [], audio: [], subs: [] }) }, t('Ficha')),
            h('button.btn.ghost', { onclick: () => { offset++; renderPick(); } }, ui.icon('refresh', 14), t('Otra')))));
    }
    const s = c.s;
    return h('div.bigpick',
      h('button.bpart', { onclick: () => ctx.openSeries(s, { reason: c.why }), style: s.wide ? { backgroundImage: `url("${s.wide}")` } : null }),
      h('div.bptext',
        h('div.bplabel', c.why || t('Recomendada para ti')),
        h('h3', s.title),
        h('div.bpsub', ui.ratingEl(s, { votes: true }), ui.alEl(s), ' ', (c.traits || []).join(' · ')),
        s.description ? h('p.bpdesc', s.description) : null,
        h('div.bpacts',
          h('button.btn', { onclick: () => ctx.openSeries(s, { reason: c.why }) }, ui.icon('play', 16), t('Empezar')),
          h('button.btn.ghost.icononly', { title: t('Me gusta'), onclick: () => ctx.like(s) }, ui.icon('thumbUp', 16)),
          h('button.btn.ghost.icononly', { title: t('No me interesa'), onclick: async () => { await ctx.dislike(s); renderPick(); } }, ui.icon('thumbDown', 16)),
          h('button.btn.ghost', { onclick: () => { offset++; renderPick(); } }, ui.icon('refresh', 14), t('Otra')))));
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
      { id: 'short', title: t('Un rato'), sub: '~25 min', icon: 'clock' },
      { id: 'evening', title: t('Una tarde'), sub: '1–2 h', icon: 'calendar' },
      { id: 'binge', title: t('Maratón'), sub: t('serie entera'), icon: 'sparkle' },
    ];
    if (!modeChosen) mode = !ag || ag.series.some((s) => s.state === 'active' && s.next) ? 'short' : 'binge';
    const list = candidates(mode, ag, ranked && ranked.items).filter((c) => !(c.kind === 'series' && CRP.store.isHidden(c.s.id)));
    pickBlock.setControls(ui.segmented(modes, mode, (m) => { mode = m; modeChosen = true; offset = 0; renderPick(); }));
    if (!list.length) {
      const waiting = !ag || !ranked;
      pickBlock.setBody(waiting ? ui.skeleton('ep', 1) : ui.empty(mode === 'short'
        ? t('No tienes episodios pendientes de lo que sigues. Prueba «Maratón».')
        : t('No hay propuestas para este plan. Prueba otro o ajusta «Para ti».')));
      return;
    }
    const i = offset % list.length;
    const main = list[i];
    const alts = list.filter((_, j) => j !== i).slice(0, 3);
    pickBlock.setBody(bigCard(main), alts.length ? h('div.alts', h('span.lbl', t('O también:')), alts.map(miniCard)) : null);
  }

  // ---------------------------------------------------------- continue
  async function renderContinue() {
    if (!ctx.loggedIn) { contBlock.el.hidden = true; return; }
    contBlock.setBody(ui.skeleton('ep', 5));
    try {
      const items = await ctx.data.continue();
      const list = uniqBy(items.filter((it) => !it.fully_watched).map((it) => ({ it, e: M.episode(it.panel) }))
        .filter((x) => x.e && !CRP.store.isContHidden(x.e.seriesId, x.e.id)), (x) => x.e.seriesId || x.e.id);
      if (!list.length) { contBlock.el.hidden = true; return; }
      contBlock.el.hidden = false;
      contBlock.setBody(ui.row(list.map(({ it, e }) => {
        const p = it.playhead && e.durationMs ? (it.playhead * 1000) / e.durationMs : 0;
        return ui.episodeCard(e, {
          progress: p > 0.02 ? p : 0, badge: it.new ? t('NUEVO') : null, sub: p > 0.02 ? null : t('Siguiente episodio'),
          acts: [
            { icon: 'check', title: t('Marcar como visto'), run: () => ctx.markWatched(e) },
            { icon: 'x', title: t('Quitar de Sigue viendo'), cls: 'hide', run: () => ctx.hideContinue(e) },
          ],
        });
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
    if (!any) { weekBlock.setBody(ui.empty(t('Nada de lo que sigues se estrena esta semana.'))); return; }
    weekBlock.setSubtitle(t('{n} ep pendientes · {time}', { n: ag.totals.pending, time: fmtMinutes(ag.totals.minutes) }));
    weekBlock.setBody(h('div.weekmini', ag.week.map((d) => h('div.wd' + (sameDay(d.date, today) ? '.today' : ''),
      h('b', `${DAYS[d.date.getDay()]} ${d.date.getDate()}`),
      d.items.slice(0, 4).map((it) => h('div.wdi.' + (it.watched ? 'watched' : it.t > Date.now() ? 'upcoming' : 'available'),
        { title: `${it.series.title} · ${fmtTime(new Date(it.t))}` }, it.series.title)),
      d.items.length > 4 ? h('small', `+${d.items.length - 4}`) : null))));
  }

  // ------------------------------------------------------------- quick
  function renderQuick() {
    const dub = ctx.dub();
    const lang = dub ? CRP.util.langLower(dub) : null;
    const audio = dub ? CRP.query.audioWords(dub) : null;   // words the parser understands
    const top = ranked && ranked.seeds.find((s) => s.kind === 'history');
    const index = cat.current();
    const season = index && index.tags && index.tags[0];
    const presets = [
      dub && { label: t('Cortas en {lang}, bien valoradas', { lang }), q: t('cortas {audio} buenas sin ver', { audio }) },
      { label: t('Joyas ocultas que no has visto'), q: t('joyas ocultas sin ver') },
      { label: t('Lo mejor según AniList que no has visto'), q: t('anilist 85 sin ver') },
      { label: t('Terminadas para hacer maratón'), q: t('terminadas buenas sin ver') },
      top && { label: t('Como {title}', { title: top.title }), q: t('como {title} sin ver', { title: top.title }) },
      season && { label: t('{season}, mejor valoradas', { season: season.title }), q: t('esta temporada buenas') },
      { label: t('Películas ★ 4.5+'), q: t('peliculas nota 4.5') },
      { label: t('Clásicas imprescindibles'), q: t('clasicas muy buenas') },
      dub && { label: t('En emisión con doblaje en {lang}', { lang }), q: t('en emision {audio}', { audio }) },
      { label: t('Sin romance ni comedia'), q: t('sin romance ni comedia buenas') },
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
      pickBlock.setBody(ui.empty(t('Inicia sesión y aquí tendrás una propuesta concreta según el tiempo que tengas.'), h('button.btn', { onclick: () => ctx.openOriginal() }, t('Iniciar sesión'))));
      return;
    }
    weekBlock.setBody(ui.skeleton('ep', 1));
    ctx.data.agenda().then((a) => { ag = a; renderPick(); renderWeek(); }).catch((e) => weekBlock.setBody(ui.errorBox(e, start)));
    ctx.data.graph().then(() => { ranked = ctx.rank(400); renderPick(); renderQuick(); }).catch(() => { ranked = { items: [], seeds: [] }; renderPick(); });
  }

  ctx.on('taste', 'today', () => { if (ctx.data.graphNow()) { ranked = ctx.rank(400); renderPick(); } renderShelves(); });
  ctx.on('shelves', 'today', renderShelves);
  // something was marked watched / hidden: reload progress-dependent blocks
  ctx.on('progress', 'today', () => {
    renderContinue();
    if (ctx.loggedIn) ctx.data.agenda().then((a) => { ag = a; renderPick(); renderWeek(); }).catch(() => {});
  });
  ctx.on('watchlist', 'today', renderShelves);
  ctx.on('ext', 'today', renderShelves);
  CRP.catalog.load().then(() => { renderShelves(); renderMood(); }).catch(() => {});
  ctx.on('ext', 'today-mood', renderMood);
  start();
  return { el, title: t('Hoy') };
};
