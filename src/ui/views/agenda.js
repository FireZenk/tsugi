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
      h('button.btn.ghost.small.icononly', { title: t('Marcar {ep} como visto', { ep: M.epLabel(s.next) }), onclick: () => ctx.markWatched({ ...s.next, seriesId: s.id, seriesTitle: s.title }) }, ui.icon('check', 14)),
    ]
    : null);
  const schedule = (s) => {
    if (!s.nextRelease) return null;
    const d = new Date(s.nextRelease);
    const vars = { day: DAYS_LONG[d.getDay()], date: d.getDate(), time: fmtTime(d) };
    return s.predicted ? t('Sale los {day} a las {time}', vars) : t('Próximo: {day} {date} a las {time}', vars);
  };

  function weekView(ag) {
    const today = new Date();
    return h('div.week', ag.week.map((day) => h('div.day' + (sameDay(day.date, today) ? '.today' : ''),
      h('div.dhead', h('b', DAYS[day.date.getDay()]), h('span', day.date.getDate())),
      day.items.length ? day.items.map((it) => {
        const future = it.t > Date.now();
        const state = it.watched ? 'watched' : future ? (it.predicted ? 'predicted' : 'upcoming') : 'available';
        const label = it.ep && it.ep.number != null ? t('E{n}', { n: it.ep.number }) : '';
        const inner = [
          h('span.dot'),
          h('div.wt', h('div.wn', it.series.title), h('div.wm', [label, fmtTime(new Date(it.t)), it.predicted ? t('estimado') : null, it.watched ? t('vista') : null].filter(Boolean).join(' · '))),
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
      h('button.sposter', { onclick: () => openSeries(s), title: t('Ver ficha') }, poster(s.id)),
      h('div.sinfo',
        h('button.stitle', { onclick: () => openSeries(s) }, s.title),
        h('div.smeta', [
          s.pendingCount ? (s.pendingCount === 1 ? t('1 ep pendiente') : t('{n} ep pendientes', { n: s.pendingCount })) + ' · ' + fmtMinutes(s.pendingMin) : t('Al día'),
          s.audio && s.audio !== 'ja-JP' ? langName(s.audio) : null,
          s.lastWatched ? t('visto {ago}', { ago: timeAgo(new Date(s.lastWatched).toISOString()) }) : null,
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
    const tot = ag.totals;

    const summary = h('div.agsum',
      h('div.kpi', h('b', tot.pending), h('span', t('episodios pendientes'))),
      h('div.kpi', h('b', fmtMinutes(tot.minutes)), h('span', t('para ponerte al día'))),
      h('div.kpi', h('b', tot.upToDate), h('span', t('series al día'))),
      h('div.kpi' + (tot.abandoned ? '.warn' : ''), h('b', tot.abandoned), h('span', t('abandonadas'))),
    );

    const weekBlock = ui.block({ title: t('Esta semana'), subtitle: t('Estrenos de lo que sigues · ● disponible · ✓ visto · ○ próximo') });
    weekBlock.setBody(weekView(ag));

    const activeBlock = ui.block({ title: t('Pendientes'), subtitle: active.length ? t('Primero lo que se está emitiendo') : '' });
    activeBlock.setBody(active.length ? h('div.slist', active.map((s) => seriesRow(s))) : ui.empty(t('Nada pendiente. Estás al día con todo lo que sigues.')));

    const blocks = [summary, weekBlock.el, activeBlock.el];

    if (abandoned.length) {
      const b = ui.block({ title: t('Abandonadas'), subtitle: t('Más de 60 días sin verlas y con episodios pendientes') });
      b.setBody(h('div.slist', abandoned.map((s) => seriesRow(s, s.inList
        ? h('button.btn.ghost.small', { onclick: async () => { await ctx.toggleWatchlist({ id: s.id, title: s.title }); refresh(); } }, t('Quitar de mi lista'))
        : null))));
      blocks.push(b.el);
    }
    if (upToDate.length) {
      const b = ui.block({ title: t('Al día'), subtitle: t('{n} series', { n: upToDate.length }) });
      b.setBody(h('div.tags', upToDate.map((s) => h('button.tag', { onclick: () => openSeries(s) }, s.title, s.airing && s.nextRelease ? h('small', ` · ${DAYS[new Date(s.nextRelease).getDay()]}`) : null))));
      blocks.push(b.el);
    }
    // Your queue: unstarted watchlist series in your order (Hoy proposes from the top).
    const queue = ctx.queue(ag);
    if (queue.length) {
      const ids = queue.map((s) => s.id);
      const move = (i, to) => { const next = ids.filter((_, j) => j !== i); next.splice(to, 0, ids[i]); ctx.setQueueOrder(next); };
      const b = ui.block({
        title: t('Tu cola'),
        subtitle: t('{n} series de tu lista sin empezar · ordénalas y «¿Qué veo?» empezará por arriba', { n: queue.length }),
        controls: [h('button.btn.ghost.small', { onclick: () => ctx.search({ text: t('en mi lista sin ver') }) }, t('Filtrar en Buscar'))],
      });
      b.setBody(h('div.slist.queue', queue.map((s, i) => {
        const rec = CRP.catalog.get && CRP.catalog.get(s.id);
        const al = CRP.ext.score(s.id);
        const meta = [rec && rec.kind === 'movie_listing' ? t('Película') : s.totalEps ? t('{n} ep', { n: s.totalEps }) : null, al != null ? `AniList ${al}` : null, s.airing ? t('en emisión') : null].filter(Boolean).join(' · ');
        return h('div.srow',
          h('button.sposter', { onclick: () => openSeries(s), title: t('Ver ficha') }, poster(s.id)),
          h('div.sinfo', h('button.stitle', { onclick: () => openSeries(s) }, h('span.qpos', i + 1), s.title), h('div.smeta', meta)),
          h('div.sacts',
            i > 0 ? h('button.icon', { title: t('Poner la primera'), onclick: () => move(i, 0) }, '⤒') : null,
            i > 0 ? h('button.icon', { title: t('Subir'), onclick: () => move(i, i - 1) }, ui.icon('up', 16)) : null,
            i < queue.length - 1 ? h('button.icon', { title: t('Bajar'), onclick: () => move(i, i + 1) }, ui.icon('down', 16)) : null));
      })));
      blocks.push(b.el);
    }

    // Clean-up: finished and abandoned series still sitting in the watchlist.
    const finished = upToDate.filter((s) => s.inList && !s.airing);
    const dropped = abandoned.filter((s) => s.inList);
    if (finished.length || dropped.length) {
      const b = ui.block({ title: t('Limpiar Mi lista'), subtitle: t('Series que ya no hace falta tener en la lista') });
      const action = (label, list) => {
        const box = h('div.cleanrow',
          h('div', h('b', label), h('div.smeta', list.slice(0, 6).map((x) => x.title).join(' · ') + (list.length > 6 ? ' ' + t('y {n} más', { n: list.length - 6 }) : ''))));
        const btn = h('button.btn.ghost.small', {
          onclick: () => {
            const confirm = h('span.confirm', t('¿Quitar {n} de tu lista de Crunchyroll?', { n: list.length }) + ' ',
              h('button.btn.small', {
                onclick: async () => {
                  confirm.textContent = t('Quitando…');
                  await ctx.removeManyFromWatchlist(list.map((x) => ({ id: x.id, title: x.title })), (d, n) => { confirm.textContent = t('Quitando {d}/{n}…', { d, n }); });
                },
              }, t('Quitar')),
              h('button.btn.ghost.small', { onclick: () => confirm.replaceWith(btn) }, t('Cancelar')));
            btn.replaceWith(confirm);
          },
        }, t('Quitar {n}', { n: list.length }));
        box.append(btn);
        return box;
      };
      b.setBody(
        finished.length ? action(t('{n} terminadas (vistas enteras y sin episodios nuevos)', { n: finished.length }), finished) : null,
        dropped.length ? action(t('{n} abandonadas (más de 60 días sin verlas)', { n: dropped.length }), dropped) : null,
      );
      blocks.push(b.el);
    }
    fill(el, blocks);
  }

  async function start() {
    if (!ctx.loggedIn) {
      fill(el, ui.empty(t('Inicia sesión para ver tu agenda y lo que tienes pendiente.'), h('button.btn', { onclick: () => ctx.openOriginal() }, t('Iniciar sesión'))));
      return;
    }
    const bar = ui.progressBar(0.03, t('Revisando tus series…'));
    fill(el, h('div.indexing', h('p', t('Calculando qué tienes pendiente y qué se estrena esta semana…')), bar));
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
  return { el, title: t('Agenda'), refresh };
};
