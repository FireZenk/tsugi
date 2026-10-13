// "Agenda": this week's releases for what you follow, your backlog (episodes and hours
// to catch up) and the shows you dropped, with one-click resume / clean-up.
var CRP = globalThis.CRP || (globalThis.CRP = {});
CRP.views = CRP.views || {};

CRP.views.agenda = (ctx) => {
  const { h, fill, fmtMinutes, fmtTime, timeAgo, DAYS, DAYS_LONG, sameDay, langName } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;

  const el = h('div.view.agenda');

  const poster = (id) => {
    const rec = CRP.catalog.get && CRP.catalog.get(id);
    return ui.img(rec && rec.poster, rec ? rec.title : '', 'mini');
  };
  const openSeries = (s) => ctx.openSeries((CRP.catalog.get && CRP.catalog.get(s.id)) || { id: s.id, title: s.title, slug: s.slug, genres: [], audio: [], subs: [] });
  const playLink = (s) => (s.next
    ? [
      h('a.btn.small', { href: M.episodeUrl(s.next), title: s.next.title }, ui.icon('play', 14), M.epLabel(s.next)),
      h('button.btn.ghost.small.icononly', { title: `Marcar ${M.epLabel(s.next)} como visto`, onclick: () => ctx.markWatched({ ...s.next, seriesId: s.id, seriesTitle: s.title }) }, ui.icon('check', 14)),
    ]
    : null);
  const schedule = (s) => {
    if (!s.nextRelease) return null;
    const d = new Date(s.nextRelease);
    return `${s.predicted ? 'Sale los' : 'Próximo:'} ${DAYS_LONG[d.getDay()]}${s.predicted ? '' : ` ${d.getDate()}`} a las ${fmtTime(d)}`;
  };

  function weekView(ag) {
    const today = new Date();
    return h('div.week', ag.week.map((day) => h('div.day' + (sameDay(day.date, today) ? '.today' : ''),
      h('div.dhead', h('b', DAYS[day.date.getDay()]), h('span', day.date.getDate())),
      day.items.length ? day.items.map((it) => {
        const future = it.t > Date.now();
        const state = it.watched ? 'watched' : future ? (it.predicted ? 'predicted' : 'upcoming') : 'available';
        const label = it.ep && it.ep.number != null ? `E${it.ep.number}` : '';
        const inner = [
          h('span.dot'),
          h('div.wt', h('div.wn', it.series.title), h('div.wm', [label, fmtTime(new Date(it.t)), it.predicted ? 'estimado' : null, it.watched ? 'vista' : null].filter(Boolean).join(' · '))),
        ];
        return it.ep && it.ep.id && !future
          ? h('a.witem.' + state, { href: M.episodeUrl(it.ep), title: it.ep.title }, inner)
          : h('button.witem.' + state, { onclick: () => openSeries(it.series) }, inner);
      }) : h('div.wempty', '—'),
    )));
  }

  function seriesRow(s, extra) {
    const watched = ctx.seriesStats().get(s.id);
    const seen = watched ? watched.eps : 0;
    const ratio = s.pendingCount + seen ? seen / (s.pendingCount + seen) : 0;
    return h('div.srow',
      h('button.sposter', { onclick: () => openSeries(s), title: 'Ver ficha' }, poster(s.id)),
      h('div.sinfo',
        h('button.stitle', { onclick: () => openSeries(s) }, s.title),
        h('div.smeta', [
          s.pendingCount ? `${s.pendingCount} ep pendiente${s.pendingCount === 1 ? '' : 's'} · ${fmtMinutes(s.pendingMin)}` : 'Al día',
          s.audio && s.audio !== 'ja-JP' ? langName(s.audio) : null,
          s.lastWatched ? `visto ${timeAgo(new Date(s.lastWatched).toISOString())}` : null,
        ].filter(Boolean).join(' · ')),
        s.started ? h('div.sbar', h('i', { style: { width: Math.round(ratio * 100) + '%' } })) : null,
        schedule(s) ? h('div.ssched', ui.icon('calendar', 13), schedule(s)) : null,
      ),
      h('div.sacts', playLink(s), extra || null),
    );
  }

  function render(ag) {
    const by = (state) => ag.series.filter((s) => s.state === state);
    const active = by('active').sort((a, b) => (b.airing - a.airing) || b.lastWatched - a.lastWatched);
    const abandoned = by('abandoned').sort((a, b) => b.lastWatched - a.lastWatched);
    const upToDate = by('uptodate');
    const unstarted = by('unstarted');
    const t = ag.totals;

    const summary = h('div.agsum',
      h('div.kpi', h('b', t.pending), h('span', 'episodios pendientes')),
      h('div.kpi', h('b', fmtMinutes(t.minutes)), h('span', 'para ponerte al día')),
      h('div.kpi', h('b', t.upToDate), h('span', 'series al día')),
      h('div.kpi' + (t.abandoned ? '.warn' : ''), h('b', t.abandoned), h('span', 'abandonadas')),
    );

    const weekBlock = ui.block({ title: 'Esta semana', subtitle: 'Estrenos de lo que sigues · ● disponible · ✓ visto · ○ próximo' });
    weekBlock.setBody(weekView(ag));

    const activeBlock = ui.block({ title: 'Pendientes', subtitle: active.length ? 'Primero lo que se está emitiendo' : '' });
    activeBlock.setBody(active.length ? h('div.slist', active.map((s) => seriesRow(s))) : ui.empty('Nada pendiente. Estás al día con todo lo que sigues.'));

    const blocks = [summary, weekBlock.el, activeBlock.el];

    if (abandoned.length) {
      const b = ui.block({ title: 'Abandonadas', subtitle: 'Más de 60 días sin verlas y con episodios pendientes' });
      b.setBody(h('div.slist', abandoned.map((s) => seriesRow(s, s.inList
        ? h('button.btn.ghost.small', { onclick: async () => { await ctx.toggleWatchlist({ id: s.id, title: s.title }); refresh(); } }, 'Quitar de mi lista')
        : null))));
      blocks.push(b.el);
    }
    if (upToDate.length) {
      const b = ui.block({ title: 'Al día', subtitle: `${upToDate.length} series` });
      b.setBody(h('div.tags', upToDate.map((s) => h('button.tag', { onclick: () => openSeries(s) }, s.title, s.airing && s.nextRelease ? h('small', ` · ${DAYS[new Date(s.nextRelease).getDay()]}`) : null))));
      blocks.push(b.el);
    }
    // Your queue: unstarted watchlist series in your order (Hoy proposes from the top).
    const queue = ctx.queue(ag);
    if (queue.length) {
      const ids = queue.map((s) => s.id);
      const move = (i, to) => { const next = ids.filter((_, j) => j !== i); next.splice(to, 0, ids[i]); ctx.setQueueOrder(next); };
      const b = ui.block({
        title: 'Tu cola',
        subtitle: `${queue.length} series de tu lista sin empezar · ordénalas y «¿Qué veo?» empezará por arriba`,
        controls: [h('button.btn.ghost.small', { onclick: () => ctx.search({ text: 'en mi lista sin ver' }) }, 'Filtrar en Buscar')],
      });
      b.setBody(h('div.slist.queue', queue.map((s, i) => {
        const rec = CRP.catalog.get && CRP.catalog.get(s.id);
        const al = CRP.ext.score(s.id);
        const meta = [rec && rec.kind === 'movie_listing' ? 'Película' : s.totalEps ? `${s.totalEps} ep` : null, al != null ? `AniList ${al}` : null, s.airing ? 'en emisión' : null].filter(Boolean).join(' · ');
        return h('div.srow',
          h('button.sposter', { onclick: () => openSeries(s), title: 'Ver ficha' }, poster(s.id)),
          h('div.sinfo', h('button.stitle', { onclick: () => openSeries(s) }, h('span.qpos', i + 1), s.title), h('div.smeta', meta)),
          h('div.sacts',
            i > 0 ? h('button.icon', { title: 'Poner la primera', onclick: () => move(i, 0) }, '⤒') : null,
            i > 0 ? h('button.icon', { title: 'Subir', onclick: () => move(i, i - 1) }, ui.icon('up', 16)) : null,
            i < queue.length - 1 ? h('button.icon', { title: 'Bajar', onclick: () => move(i, i + 1) }, ui.icon('down', 16)) : null));
      })));
      blocks.push(b.el);
    }

    // Clean-up: finished and abandoned series still sitting in the watchlist.
    const finished = upToDate.filter((s) => s.inList && !s.airing);
    const dropped = abandoned.filter((s) => s.inList);
    if (finished.length || dropped.length) {
      const b = ui.block({ title: 'Limpiar Mi lista', subtitle: 'Series que ya no hace falta tener en la lista' });
      const action = (label, list) => {
        const box = h('div.cleanrow',
          h('div', h('b', label), h('div.smeta', list.slice(0, 6).map((x) => x.title).join(' · ') + (list.length > 6 ? ` y ${list.length - 6} más` : ''))));
        const btn = h('button.btn.ghost.small', {
          onclick: () => {
            const confirm = h('span.confirm', `¿Quitar ${list.length} de tu lista de Crunchyroll? `,
              h('button.btn.small', {
                onclick: async () => {
                  confirm.textContent = 'Quitando…';
                  await ctx.removeManyFromWatchlist(list.map((x) => ({ id: x.id, title: x.title })), (d, n) => { confirm.textContent = `Quitando ${d}/${n}…`; });
                },
              }, 'Quitar'),
              h('button.btn.ghost.small', { onclick: () => confirm.replaceWith(btn) }, 'Cancelar'));
            btn.replaceWith(confirm);
          },
        }, `Quitar ${list.length}`);
        box.append(btn);
        return box;
      };
      b.setBody(
        finished.length ? action(`${finished.length} terminadas (vistas enteras y sin episodios nuevos)`, finished) : null,
        dropped.length ? action(`${dropped.length} abandonadas (más de 60 días sin verlas)`, dropped) : null,
      );
      blocks.push(b.el);
    }
    fill(el, blocks);
  }

  async function start() {
    if (!ctx.loggedIn) {
      fill(el, ui.empty('Inicia sesión para ver tu agenda y lo que tienes pendiente.', h('button.btn', { onclick: () => ctx.openOriginal() }, 'Iniciar sesión')));
      return;
    }
    const bar = ui.progressBar(0.03, 'Revisando tus series…');
    fill(el, h('div.indexing', h('p', 'Calculando qué tienes pendiente y qué se estrena esta semana…'), bar));
    const off = ctx.onAgendaProgress((p) => bar.set(p, `${Math.round(p * 100)}%`));
    try {
      const [ag] = await Promise.all([ctx.data.agenda(), CRP.catalog.load().catch(() => null)]);
      render(ag);
    } catch (e) {
      fill(el, ui.errorBox(e, start));
    } finally { off(); }
  }
  function refresh() { ctx.data.agenda.reset(); start(); }

  ctx.on('progress', 'agenda', () => el.isConnected && start());
  start();
  return { el, title: 'Agenda', refresh };
};
