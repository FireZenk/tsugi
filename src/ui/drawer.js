// Quick view: a side panel with everything needed to decide about a series without
// leaving the page — rating breakdown, audio/subtitle languages (per season), your
// progress, seasons, and similar titles you can keep hopping through.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.drawer = (() => {
  const { h, fill, langName, timeAgo, fmtMinutes, fmtDateTime } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;
  const api = CRP.api;

  function create(ctx) {
    const panel = h('aside.qv', { hidden: true, role: 'dialog', 'aria-label': t('Ficha de la serie'), tabindex: '-1' });
    const scrim = h('div.scrim', { hidden: true });
    let stack = [];
    let seq = 0;

    const close = () => { panel.hidden = true; scrim.hidden = true; stack = []; };
    scrim.addEventListener('click', close);
    ctx.root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); close(); } });

    function open(s, { push = false, reason } = {}) {
      const rec = (CRP.catalog.get && CRP.catalog.get(s.id)) || s;
      if (!push) stack = [];
      stack.push({ rec, reason });
      render();
      panel.hidden = false;
      scrim.hidden = false;
      panel.scrollTop = 0;
      panel.focus({ preventScroll: true });
    }
    const back = () => { stack.pop(); render(); panel.scrollTop = 0; };

    function langChips(codes, highlight) {
      const sorted = [...codes].sort((a, b) => (b === highlight) - (a === highlight) || (b === 'ja-JP') - (a === 'ja-JP'));
      return h('div.langs', sorted.map((c) => h('span.lang' + (c === highlight ? '.hi' : ''), langName(c))));
    }

    function distBars(x) {
      if (!x.dist) return null;
      return h('div.dist', [5, 4, 3, 2, 1].map((star) => {
        const p = x.dist[star - 1] || 0;
        return h('div.drow', h('span', `${star}★`), h('div.dbar', h('i', { style: { width: p + '%' } })), h('small', p + '%'));
      }));
    }

    function render() {
      const my = ++seq;
      const top = stack[stack.length - 1];
      if (!top) return close();
      const x = top.rec;
      const dub = ctx.dub();
      const stats = ctx.seriesStats().get(x.id);
      const ag = ctx.agendaFor(x.id);

      const play = h('a.btn.play', { href: M.seriesUrl(x) }, ui.icon('play', 16), h('span', '…'));
      const setPlay = (label, url) => { play.href = url; play.lastChild.textContent = label; };
      if (ag && ag.next) setPlay(t('Continuar {ep}', { ep: M.epLabel(ag.next) }), M.episodeUrl(ag.next));
      else {
        setPlay(stats ? t('Continuar') : t('Empezar'), M.seriesUrl(x));
        api.upNext(x.id).then((u) => {
          if (my !== seq || !u || !u.panel) return;
          const e = M.episode(u.panel);
          const ep = M.epLabel(e);
          const label = u.never_watched ? t('Empezar {ep}', { ep }) : u.fully_watched ? t('Volver a ver {ep}', { ep }) : t('Continuar {ep}', { ep });
          setPlay(label, M.episodeUrl(e));
        }).catch(() => {});
      }

      const inList = ctx.inWatchlist(x.id);
      const liked = CRP.store.isLiked(x.id);
      const actions = h('div.qvacts',
        play,
        ctx.loggedIn ? h('button.btn.ghost' + (inList ? '.on' : ''), { onclick: async () => { await ctx.toggleWatchlist(x); render(); } }, ui.icon(inList ? 'check' : 'plus', 16), inList ? t('En mi lista') : t('Mi lista')) : null,
        h('button.btn.ghost.icononly' + (liked ? '.on' : ''), { title: t('Me gusta: recomiéndame más así'), onclick: async () => { await ctx.like(x); render(); } }, ui.icon('thumbUp', 16)),
        h('button.btn.ghost.icononly', { title: t('No me interesa'), onclick: async () => { await ctx.dislike(x); close(); } }, ui.icon('thumbDown', 16)),
        h('a.btn.ghost.icononly', { href: M.seriesUrl(x), title: t('Abrir la página de la serie en Crunchyroll') }, ui.icon('external', 16)),
      );

      // Your stars (click your current rating again to clear it).
      const starsBox = h('div.mystars');
      const renderStars = (value, note) => fill(starsBox,
        h('span.lbl', t('Tu valoración')),
        [1, 2, 3, 4, 5].map((n) => h('button.star' + (n <= value ? '.on' : ''), {
          title: n <= value && n === value ? t('Quitar valoración') : n > 1 ? t('{n} estrellas', { n }) : t('1 estrella'),
          onclick: async () => { const v = await ctx.rate(x, n); renderStars(v); },
        }, ui.icon('star', 18))),
        note ? h('small', note) : null);
      const mine = CRP.store.getRating(x.id);
      renderStars(mine ? mine.stars : 0);
      if (!mine && ctx.loggedIn) {
        api.myRating(x.id).then((r) => {
          const raw = r && (r.rating || (r.data && r.data.rating) || r.user_rating);
          const m = String(raw || '').match(/^([1-5])s$/);
          if (my === seq && m) { CRP.store.setRating(x.id, +m[1], x.title); renderStars(+m[1], t('de Crunchyroll')); }
        }).catch(() => {});
      }

      const facts = [
        x.kind === 'movie_listing' ? t('Película') : null,
        x.year,
        x.seasons > 1 ? t('{n} temporadas', { n: x.seasons }) : null,
        x.episodes && x.kind !== 'movie_listing' ? t('{n} episodios', { n: x.episodes }) : null,
        x.maturity || null,
        CRP.catalog.isAiring && CRP.catalog.isAiring(x) ? t('En emisión') : null,
      ].filter(Boolean);

      let progress = null;
      if (stats || ag) {
        const lines = [];
        const ago = timeAgo(new Date(stats ? stats.last : 0).toISOString());
        if (stats) lines.push(stats.eps === 1 ? t('Has visto 1 episodio · último {ago}', { ago }) : t('Has visto {n} episodios · último {ago}', { n: stats.eps, ago }));
        if (ag && ag.pendingCount) lines.push(t('Te quedan {n} ep ({time})', { n: ag.pendingCount, time: fmtMinutes(ag.pendingMin) }));
        else if (ag && ag.started) lines.push(t('Estás al día'));
        if (ag && ag.nextRelease) lines.push(t('Próximo episodio: {when}', { when: fmtDateTime(ag.nextRelease, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }) + (ag.predicted ? ' ' + t('(estimado)') : ''));
        progress = h('div.qvprog', lines.map((l) => h('div', l)));
      }

      // External ratings: AniList (from the local map, or fetched now) and MyAnimeList.
      const extBox = h('div.qvext', h('div.mini', t('Buscando valoraciones externas…')));
      const extRow = (name, value, scale, sub, url) => h('a.extrow', { href: url, target: '_blank', rel: 'noopener', title: t('Abrir en {name}', { name }) },
        h('span.src', name), h('b', value), h('small', scale), h('span.sub', sub || ''), ui.icon('external', 13));
      const renderExt = (e, mal) => {
        const rows = [];
        if (e && e.s != null) {
          rows.push(extRow('AniList', e.s, '/100', t('{n} usuarios', { n: ui.fmtVotes(e.u) }) + (e.n > 1 ? ' · ' + t('media de {n} entradas', { n: e.n }) : ''), `https://anilist.co/anime/${e.al}`));
        } else if (e) rows.push(extRow('AniList', '—', '', t('aún sin nota'), `https://anilist.co/anime/${e.al}`));
        if (mal && mal.score) rows.push(extRow('MyAnimeList', mal.score.toFixed(2), '/10', `${mal.rank ? `#${mal.rank} · ` : ''}${t('{n} votos', { n: ui.fmtVotes(mal.users || 0) })}`, mal.url || `https://myanimelist.net/anime/${e.mal}`));
        if (!rows.length) return fill(extBox, h('div.mini', t('Sin datos externos para esta serie.')));
        fill(extBox, rows, e && e.c === 'title' ? h('div.mini', t('Emparejado por título y año (AniList no enlaza esta serie de Crunchyroll).')) : null);
      };
      // AniList details: trailer, themes, studio, source, next airing; your imported score.
      const infoBox = h('div.qvinfo');
      const IMPORT_ST = { watching: t('viéndola'), completed: t('completada'), paused: t('en pausa'), dropped: t('abandonada'), planning: t('pendiente') };
      const renderInfo = (e) => {
        const parts = [];
        const imp = CRP.profile.get(x.id);
        if (imp) parts.push(h('div.qvmine', ui.icon('star', 14), t('En tu lista importada: {st}', { st: IMPORT_ST[imp.st] || imp.st }) + (imp.s != null ? ' · ' + t('tu nota {n}', { n: Math.round(imp.s) / 10 }) : '')));
        if (e && e.tr) {
          const thumb = h('button.trailer', { title: t('Ver tráiler'), style: { backgroundImage: `url("https://i.ytimg.com/vi/${e.tr}/hqdefault.jpg")` } }, h('span.playbtn.on', ui.icon('play', 34)), h('span.tlabel', t('Tráiler')));
          thumb.addEventListener('click', () => {
            thumb.replaceWith(h('iframe.trailer', {
              src: `https://www.youtube-nocookie.com/embed/${e.tr}?autoplay=1&rel=0`,
              allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, title: t('Tráiler'),
            }));
          });
          parts.push(thumb);
        }
        const facts = [];
        if (e && e.st && e.st.length) facts.push(h('span', t('Estudio') + ': ', e.st.map((n, i) => [i ? ', ' : '', h('button.linkbtn', { onclick: () => { close(); ctx.search({ studio: n }); } }, n)])));
        if (e && e.src) facts.push(h('span', t('Origen') + ': ', h('button.linkbtn', { onclick: () => { close(); ctx.search({ source: e.src }); } }, CRP.tags.sourceLabel(e.src))));
        const nx = CRP.ext.nextAiring(x.id);
        if (nx) facts.push(h('span', t('Próximo en Japón: {ep} · {when}', { ep: t('E{n}', { n: nx.ep }), when: fmtDateTime(nx.at, { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })));
        if (facts.length) parts.push(h('div.qvfacts2', facts));
        const themes = [...((e && e.ge) || []), ...((e && e.tg) || []).map((tg) => tg[0])].filter((n, i, a) => a.indexOf(n) === i);
        if (themes.length) {
          parts.push(h('div.qvthemes', themes.slice(0, 16).map((n) => h('button.chip.small.theme', { title: n, onclick: () => { close(); ctx.search({ tagsIn: [n] }); } }, CRP.tags.label(n)))));
        }
        fill(infoBox, parts);
      };
      renderInfo(CRP.ext.get(x.id));
      // Watch order across the franchise (AniList relations), when there's more than one entry.
      const orderBox = h('div.qvorder');
      const FORMAT = { TV: t('Serie'), TV_SHORT: t('Serie corta'), MOVIE: t('Película'), OVA: 'OVA', ONA: 'ONA', SPECIAL: t('Especial'), MUSIC: t('Música') };
      const renderOrder = (list, all = false) => {
        if (!list || list.length < 2) return fill(orderBox);
        let n = 0;
        const rows = list.map((o) => {
          const num = o.kind === 'main' ? ++n : null;
          const target = o.cr && o.cr !== x.id ? (CRP.catalog.get(o.cr) || { id: o.cr, title: o.title, genres: [], audio: [], subs: [] }) : null;
          const tag = o.cr === x.id ? h('span.otag.here', t('esta serie')) : o.cr ? h('span.otag.cr', t('en Crunchyroll')) : h('span.otag.no', t('no está en Crunchyroll'));
          const meta = [o.year, FORMAT[o.format] || o.format, o.episodes && o.format !== 'MOVIE' ? t('{n} ep', { n: o.episodes }) : null, o.status === 'NOT_YET_RELEASED' ? t('próximamente') : null].filter(Boolean).join(' · ');
          return h(target ? 'button.orow.link' : 'div.orow', { onclick: target ? () => open(target, { push: true }) : null },
            h('span.onum' + (o.kind === 'extra' ? '.extra' : ''), num || '+'),
            h('span.otitle', o.title, h('small', meta)),
            tag);
        });
        fill(orderBox,
          h('h3', t('Orden de visionado')),
          h('p.mini', t('Numeradas: la historia principal. «+»: extras (películas, OVAs) colocados por fecha.')),
          rows.slice(0, all ? rows.length : 10),
          rows.length > 10 && !all ? h('button.linkbtn', { onclick: () => renderOrder(list, true) }, t('Ver las {n}', { n: rows.length })) : null);
      };
      const desc = h('p.qvdesc', x.description || '');
      const seasonsBox = h('div.qvseasons', h('div.mini', t('Cargando temporadas…')));
      const similarBox = h('div.qvsim', ui.skeleton('poster', 4, { layout: 'grid' }));

      fill(panel,
        h('div.qvbar',
          stack.length > 1 ? h('button.icon', { title: t('Volver'), onclick: back }, ui.icon('back', 20)) : h('span'),
          h('button.icon', { title: t('Cerrar (Esc)'), onclick: close }, ui.icon('x', 20))),
        h('div.qvhero', { style: x.wide ? { backgroundImage: `url("${x.wide}")` } : null },
          h('div.qvhead',
            ui.img(x.poster, x.title, 'qvposter'),
            h('div',
              h('h2', x.title),
              h('div.qvfacts', facts.join(' · ')),
              h('div.qvgenres', x.genres.map((g) => h('button.chip.small', { onclick: () => { close(); ctx.search({ genresIn: [g] }); } }, M.genreTitle(g))))),
          )),
        top.reason ? h('div.qvwhy', ui.icon('sparkle', 14), top.reason) : null,
        actions,
        starsBox,
        progress,
        h('div.qvgrid',
          h('div.qvrating',
            x.rating != null ? h('div.big', ui.icon('star', 20), x.rating.toFixed(1), h('small', t('{n} votos', { n: ui.fmtVotes(x.votes) }))) : h('div.mini', t('Sin valoraciones')),
            distBars(x)),
          h('div.qvlang',
            h('h4', t('Audio')), x.audio && x.audio.length ? langChips(x.audio, dub) : h('div.mini', '—'),
            h('h4', t('Subtítulos')), x.subs && x.subs.length ? langChips(x.subs, CRP.util.contentLocale()) : h('div.mini', '—'))),
        extBox,
        infoBox,
        desc,
        orderBox,
        h('h3', t('Temporadas')), seasonsBox,
        h('h3', t('Parecidas')), similarBox,
      );

      if (CRP.store.get().ext !== false) {
        CRP.ext.ensure(x).then(async (e) => {
          if (my !== seq) return;
          renderExt(e, null);
          renderInfo(e);
          CRP.ext.watchOrder(x).then((list) => { if (my === seq) renderOrder(list); }).catch(() => {});
          const mal = e && e.mal ? await CRP.ext.malScore(e.mal).catch(() => null) : null;
          if (my === seq && mal) renderExt(e, mal);
        }).catch(() => { if (my === seq) fill(extBox, h('div.mini', t('No se pudo consultar AniList.'))); });
      } else fill(extBox);

      // full description (browse truncates it)
      api.seriesInfo(x.id).then((info) => { if (my === seq && info && info.description) desc.textContent = info.description; }).catch(() => {});

      // seasons, with the dub languages each one actually has
      api.seasons(x.id).then((list) => {
        if (my !== seq) return;
        const rows = list.filter((s) => !s.is_clip).map((s) => {
          const audios = [...new Set([s.audio_locale, ...(s.versions || []).map((v) => v.audio_locale)].filter(Boolean))];
          return h('div.season',
            h('div.st', h('b', t('T{n}', { n: s.season_display_number || s.season_number || '?' })), ' ', s.title),
            h('div.sm', t('{n} ep', { n: s.number_of_episodes || '?' }), audios.length ? h('span', ' · ', audios.map(langName).join(', ')) : null,
              dub && audios.includes(dub) ? h('span.ok', ` ✓ ${langName(dub)}`) : null));
        });
        fill(seasonsBox, rows.length ? rows : h('div.mini', t('Sin temporadas disponibles')));
      }).catch(() => fill(seasonsBox, h('div.mini', t('No se pudieron cargar las temporadas'))));

      api.similar(x.id, 18).then((list) => {
        if (my !== seq) return;
        const items = list.map((it) => (CRP.catalog.get && CRP.catalog.get(it.id)) || M.series(it)).filter(Boolean);
        fill(similarBox, items.length
          ? ui.grid(items.map((s) => {
            const card = ui.posterCard(s, { ctx, actions: ['list'], badge: ctx.inWatchlist(s.id) ? t('EN TU LISTA') : ctx.hasWatched(s.id) ? t('VISTA') : null });
            card.addEventListener('click', (e) => {
              if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); open(s, { push: true }); }
            }, true);
            return card;
          }), { kind: 'poster small' })
          : h('div.mini', t('Sin sugerencias')));
      }).catch(() => fill(similarBox, h('div.mini', t('No se pudieron cargar'))));
    }

    return { panel, scrim, open, close, isOpen: () => !panel.hidden, current: () => stack.length && stack[stack.length - 1].rec };
  }

  return { create };
})();
