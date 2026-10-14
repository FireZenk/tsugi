// "Estadísticas": what you've watched, from your full Crunchyroll history — totals, a
// yearly summary ("your year"), a daily heatmap, when you watch, top series and genres.
// Computed locally (CRP.stats); "Copiar resumen" puts a shareable text on the clipboard.
var CRP = globalThis.CRP || (globalThis.CRP = {});
CRP.views = CRP.views || {};

CRP.views.stats = (ctx) => {
  const { h, fill, fmtNum, fmtMinutes, uiLocale, DAYS, DAYS_LONG } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;
  const S = CRP.stats;
  const cat = CRP.catalog;
  const DAY = 86400000;

  const el = h('div.view.stats');
  let list = null;
  let year = new Date().getFullYear();   // null = whole history

  const hours = (min) => (min >= 600 ? t('{n} h', { n: fmtNum(Math.round(min / 60)) }) : fmtMinutes(min));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const monthName = (key, style = 'long') => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(uiLocale(), { month: style, year: style === 'long' ? 'numeric' : undefined }); };
  const opts = {
    genresOf: (id) => (cat.get(id) || {}).genres || [],
    episodesOf: (id) => (cat.get(id) || {}).episodes || 0,
    airing: (id) => { const x = cat.get(id); return !!x && cat.isAiring(x); },
  };
  const DAYPART = (hr) => (hr < 6 ? t('De madrugada') : hr < 12 ? t('Por la mañana') : hr < 20 ? t('Por la tarde') : t('Por la noche'));

  // ------------------------------------------------------------- pieces
  function bars(values, labels, fmt, cls = '') {
    const max = Math.max(1, ...values);
    return h('div.bars' + cls, values.map((v, i) => h('div.bar', { title: `${labels[i].title || labels[i]} · ${fmt(v)}` },
      h('div.btrack', h('i', { style: { height: (v ? Math.max(3, Math.round((v / max) * 100)) : 0) + '%' } })),
      h('small', labels[i].short != null ? labels[i].short : labels[i]))));
  }

  function heatmap(st, range) {
    const now = new Date();
    const end = range ? new Date(Math.min(range.to - 1, now.getTime())) : now;
    const start = range ? new Date(range.from) : new Date(end.getTime() - 364 * DAY);
    const cells = [];
    // pad to Monday so rows are weekdays
    const lead = (start.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cells.push(h('i.hc.out'));
    for (const d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
      const m = st.byDay.get(S.dayKey(d)) || 0;
      const lv = !m ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4;
      cells.push(h('i.hc.l' + lv, { title: `${d.toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' })} · ${m ? hours(m) : '—'}` }));
    }
    const legend = h('div.hlegend', h('small', t('Menos')), [0, 1, 2, 3, 4].map((l) => h('i.hc.l' + l)), h('small', t('Más')));
    return h('div.heat', h('div.hgrid', cells), legend);
  }

  function highlight(title, value, sub, art) {
    return h('div.hl' + (art ? '.art' : ''), art || null, h('div.hlt', h('small', title), h('b', value), sub ? h('span', sub) : null));
  }

  function summaryText(st) {
    const top = st.topSeries[0];
    const period = year ? t('Mi {y} en Crunchyroll', { y: year }) : t('Mi historial de Crunchyroll');
    return [
      `${period}: ${t('{hours} de anime, {eps} episodios de {series} series.', { hours: hours(st.minutes), eps: fmtNum(st.episodes), series: fmtNum(st.seriesCount) })}`,
      top ? t('Lo más visto: {title} ({hours}).', { title: top.title, hours: hours(top.minutes) }) : null,
      st.topGenres[0] ? t('Género favorito: {g}.', { g: M.genreTitle(st.topGenres[0].id) }) : null,
      st.streak.days > 1 ? t('Racha: {n} días seguidos.', { n: st.streak.days }) : null,
      '— Crunchyroll+',
    ].filter(Boolean).join('\n');
  }

  // ------------------------------------------------------------- render
  function render() {
    const yrs = S.years(list);
    if (year && !yrs.includes(year)) year = yrs[0] || null;
    const range = year ? S.yearRange(year) : null;
    const st = S.compute(list, range, opts);

    const choose = ui.chips([{ id: 'all', title: t('Todo') }, ...yrs.map((y) => ({ id: String(y), title: String(y) }))],
      { value: year ? String(year) : 'all', onChange: (v) => { year = v === 'all' ? null : +v; render(); } });
    const head = ui.block({
      title: year ? t('Tu {y}', { y: year }) : t('Todo tu historial'),
      subtitle: t('Calculado con tu historial de Crunchyroll, en tu navegador.'),
      controls: [
        choose,
        h('button.btn.ghost.small', {
          onclick: async () => { await navigator.clipboard.writeText(summaryText(st)); ui.toast(t('Resumen copiado. Pégalo donde quieras.')); },
        }, t('Copiar resumen')),
        h('button.icon', { title: t('Volver a leer el historial'), onclick: () => start(true) }, ui.icon('refresh', 16)),
      ],
      cls: 'sthead',
    });

    if (!st.episodes) {
      head.setBody(ui.empty(year ? t('No viste nada en {y}.', { y: year }) : t('Aún no hay historial que analizar.')));
      return fill(el, head.el);
    }

    const kpis = h('div.stkpis',
      h('div.kpi', h('b', hours(st.minutes)), h('span', t('de anime'))),
      h('div.kpi', h('b', fmtNum(st.episodes)), h('span', t('episodios'))),
      h('div.kpi', h('b', fmtNum(st.seriesCount)), h('span', t('series'))),
      h('div.kpi', h('b', fmtNum(st.activeDays)), h('span', t('días con algo visto'))),
      h('div.kpi', h('b', st.streak.days), h('span', t('días seguidos (racha más larga)'))));
    head.setBody(kpis);

    // highlights ("your year")
    const top = st.topSeries[0];
    const topRec = top && cat.get(top.id);
    const orig = st.audio.filter((a) => a.id === 'ja-JP').reduce((s, a) => s + a.minutes, 0);
    const dub = st.audio.find((a) => a.id !== 'ja-JP');
    const hl = ui.block({ title: year ? t('Lo más destacado de {y}', { y: year }) : t('Lo más destacado') });
    hl.setBody(h('div.hls',
      top ? h('button.hlbtn', { onclick: () => ctx.openSeries(topRec || { id: top.id, title: top.title, genres: [], audio: [], subs: [] }) },
        highlight(t('Tu serie más vista'), top.title, t('{hours} · {n} episodios', { hours: hours(top.minutes), n: top.episodes }), topRec ? ui.img(topRec.poster, top.title, 'hlimg') : null)) : null,
      st.busiestMonth ? highlight(t('Tu mes más intenso'), monthName(st.busiestMonth[0]), hours(st.busiestMonth[1])) : null,
      st.favWeekday != null ? highlight(t('Tu día'), DAYS_LONG[st.favWeekday], st.favHour != null ? `${DAYPART(st.favHour)} · ${String(st.favHour).padStart(2, '0')}:00` : '') : null,
      st.topGenres[0] ? highlight(t('Tu género'), M.genreTitle(st.topGenres[0].id), st.topGenres[1] ? t('y después {g}', { g: M.genreTitle(st.topGenres[1].id).toLowerCase() }) : '') : null,
      highlight(t('Series nuevas'), fmtNum(st.started.length), st.started.slice(0, 3).map((s) => s.title).join(' · ')),
      highlight(t('Terminadas'), fmtNum(st.finished.length), st.finished.slice(0, 3).map((s) => s.title).join(' · ')),
      highlight(t('En versión original'), pct(orig, st.minutes) + ' %', dub ? t('Doblaje que más ves: {lang}', { lang: CRP.util.langName(dub.id) }) : t('Nada doblado')),
    ));

    // when
    const heat = ui.block({ title: t('Cada día'), subtitle: year ? String(year) : t('Últimos 12 meses') });
    heat.setBody(heatmap(st, range));

    const months = year
      ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
      : (() => { const now = new Date(); return Array.from({ length: 24 }, (_, i) => S.monthKey(new Date(now.getFullYear(), now.getMonth() - 23 + i, 1))); })();
    const when = ui.block({ title: t('Cuándo ves anime') });
    const wdOrder = [1, 2, 3, 4, 5, 6, 0];
    when.setBody(h('div.whens',
      h('div.wbox', h('h4', t('Por mes')), bars(months.map((k) => st.byMonth.get(k) || 0), months.map((k) => ({ title: monthName(k), short: monthName(k, 'narrow') })), hours, '.months')),
      h('div.wbox', h('h4', t('Por hora del día')), bars(st.byHour, st.byHour.map((_, i) => ({ title: `${String(i).padStart(2, '0')}:00`, short: i % 6 === 0 ? String(i) : '' })), hours, '.hours')),
      h('div.wbox', h('h4', t('Por día de la semana')), bars(wdOrder.map((d) => st.byWeekday[d]), wdOrder.map((d) => ({ title: DAYS_LONG[d], short: DAYS[d] })), hours, '.wdays'))));

    // what
    const maxS = st.topSeries[0] ? st.topSeries[0].minutes : 1;
    const topBlock = ui.block({ title: t('Tus series'), subtitle: t('Por tiempo visto') });
    topBlock.setBody(h('div.toplist', st.topSeries.slice(0, 10).map((s, i) => {
      const rec = cat.get(s.id);
      return h('button.trow', { onclick: () => ctx.openSeries(rec || { id: s.id, title: s.title, genres: [], audio: [], subs: [] }) },
        h('span.tpos', i + 1), ui.img(rec && rec.poster, s.title, 'mini'),
        h('span.tname', s.title, h('small', t('{n} episodios', { n: s.episodes }))),
        h('span.tbar', h('i', { style: { width: Math.max(3, Math.round((s.minutes / maxS) * 100)) + '%' } })),
        h('b.thours', hours(s.minutes)));
    })));
    const maxG = st.topGenres[0] ? st.topGenres[0].minutes : 1;
    const genres = ui.block({ title: t('Tus géneros') });
    genres.setBody(h('div.profile', st.topGenres.slice(0, 8).map((g) => h('div.prow', h('span', M.genreTitle(g.id)),
      h('div.dbar', h('i', { style: { width: Math.round((g.minutes / maxG) * 100) + '%' } }))))));

    fill(el, head.el, hl.el, heat.el, when.el, topBlock.el, genres.el);
  }

  async function start(force = false) {
    if (!ctx.loggedIn) {
      fill(el, ui.empty(t('Inicia sesión para ver tus estadísticas.'), h('button.btn', { onclick: () => ctx.openOriginal() }, t('Iniciar sesión'))));
      return;
    }
    const bar = ui.progressBar(0.05, t('Leyendo tu historial…'));
    fill(el, h('div.indexing', h('p', t('Leyendo tu historial completo de Crunchyroll…')), bar));
    try {
      await cat.load().catch(() => null);
      list = await S.history({ force, onProgress: (n) => bar.set(Math.min(0.95, 0.05 + n * 0.03), t('{n} páginas leídas', { n })) });
    } catch (e) {
      fill(el, ui.errorBox(e, () => start(force)));
      return;
    }
    render();
  }

  // marked watched / removed from history elsewhere: re-read when shown
  ctx.on('progress', 'stats', () => { CRP.store.cacheClear('stats:'); if (!el.hidden) start(); else list = null; });
  const obs = new MutationObserver(() => { if (!el.hidden && list === null && ctx.loggedIn) start(); });
  obs.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  start();
  return { el, title: t('Estadísticas') };
};
