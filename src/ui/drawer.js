// Quick view: a side panel with everything needed to decide about a series without
// leaving the page — rating breakdown, audio/subtitle languages (per season), your
// progress, seasons, and similar titles you can keep hopping through.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.drawer = (() => {
  const { h, fill, langName, timeAgo, fmtMinutes } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;
  const api = CRP.api;

  function create(ctx) {
    const panel = h('aside.qv', { hidden: true, role: 'dialog', 'aria-label': 'Ficha de la serie', tabindex: '-1' });
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
      if (ag && ag.next) setPlay(`Continuar ${M.epLabel(ag.next)}`, M.episodeUrl(ag.next));
      else {
        setPlay(stats ? 'Continuar' : 'Empezar', M.seriesUrl(x));
        api.upNext(x.id).then((u) => {
          if (my !== seq || !u || !u.panel) return;
          const e = M.episode(u.panel);
          const label = u.never_watched ? `Empezar ${M.epLabel(e)}` : u.fully_watched ? `Volver a ver ${M.epLabel(e)}` : `Continuar ${M.epLabel(e)}`;
          setPlay(label, M.episodeUrl(e));
        }).catch(() => {});
      }

      const inList = ctx.inWatchlist(x.id);
      const liked = CRP.store.isLiked(x.id);
      const actions = h('div.qvacts',
        play,
        ctx.loggedIn ? h('button.btn.ghost' + (inList ? '.on' : ''), { onclick: async () => { await ctx.toggleWatchlist(x); render(); } }, ui.icon(inList ? 'check' : 'plus', 16), inList ? 'En mi lista' : 'Mi lista') : null,
        h('button.btn.ghost.icononly' + (liked ? '.on' : ''), { title: 'Me gusta: recomiéndame más así', onclick: async () => { await ctx.like(x); render(); } }, ui.icon('thumbUp', 16)),
        h('button.btn.ghost.icononly', { title: 'No me interesa', onclick: async () => { await ctx.dislike(x); close(); } }, ui.icon('thumbDown', 16)),
        h('a.btn.ghost.icononly', { href: M.seriesUrl(x), title: 'Abrir la página de la serie en Crunchyroll' }, ui.icon('external', 16)),
      );

      // Your stars (click your current rating again to clear it).
      const starsBox = h('div.mystars');
      const renderStars = (value, note) => fill(starsBox,
        h('span.lbl', 'Tu valoración'),
        [1, 2, 3, 4, 5].map((n) => h('button.star' + (n <= value ? '.on' : ''), {
          title: n <= value && n === value ? 'Quitar valoración' : `${n} estrella${n > 1 ? 's' : ''}`,
          onclick: async () => { const v = await ctx.rate(x, n); renderStars(v); },
        }, ui.icon('star', 18))),
        note ? h('small', note) : null);
      const mine = CRP.store.getRating(x.id);
      renderStars(mine ? mine.stars : 0);
      if (!mine && ctx.loggedIn) {
        api.myRating(x.id).then((r) => {
          const raw = r && (r.rating || (r.data && r.data.rating) || r.user_rating);
          const m = String(raw || '').match(/^([1-5])s$/);
          if (my === seq && m) { CRP.store.setRating(x.id, +m[1], x.title); renderStars(+m[1], 'de Crunchyroll'); }
        }).catch(() => {});
      }

      const facts = [
        x.kind === 'movie_listing' ? 'Película' : null,
        x.year,
        x.seasons > 1 ? `${x.seasons} temporadas` : null,
        x.episodes && x.kind !== 'movie_listing' ? `${x.episodes} episodios` : null,
        x.maturity || null,
        CRP.catalog.isAiring && CRP.catalog.isAiring(x) ? 'En emisión' : null,
      ].filter(Boolean);

      let progress = null;
      if (stats || ag) {
        const lines = [];
        if (stats) lines.push(`Has visto ${stats.eps} episodio${stats.eps === 1 ? '' : 's'} · último ${timeAgo(new Date(stats.last).toISOString())}`);
        if (ag && ag.pendingCount) lines.push(`Te quedan ${ag.pendingCount} ep (${fmtMinutes(ag.pendingMin)})`);
        else if (ag && ag.started) lines.push('Estás al día');
        if (ag && ag.nextRelease) lines.push(`Próximo episodio: ${new Date(ag.nextRelease).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}${ag.predicted ? ' (estimado)' : ''}`);
        progress = h('div.qvprog', lines.map((l) => h('div', l)));
      }

      // External ratings: AniList (from the local map, or fetched now) and MyAnimeList.
      const extBox = h('div.qvext', h('div.mini', 'Buscando valoraciones externas…'));
      const extRow = (name, value, scale, sub, url) => h('a.extrow', { href: url, target: '_blank', rel: 'noopener', title: `Abrir en ${name}` },
        h('span.src', name), h('b', value), h('small', scale), h('span.sub', sub || ''), ui.icon('external', 13));
      const renderExt = (e, mal) => {
        const rows = [];
        if (e && e.s != null) {
          rows.push(extRow('AniList', e.s, '/100', `${ui.fmtVotes(e.u)} usuarios${e.n > 1 ? ` · media de ${e.n} entradas` : ''}`, `https://anilist.co/anime/${e.al}`));
        } else if (e) rows.push(extRow('AniList', '—', '', 'aún sin nota', `https://anilist.co/anime/${e.al}`));
        if (mal && mal.score) rows.push(extRow('MyAnimeList', mal.score.toFixed(2), '/10', `${mal.rank ? `#${mal.rank} · ` : ''}${ui.fmtVotes(mal.users || 0)} votos`, mal.url || `https://myanimelist.net/anime/${e.mal}`));
        if (!rows.length) return fill(extBox, h('div.mini', 'Sin datos externos para esta serie.'));
        fill(extBox, rows, e && e.c === 'title' ? h('div.mini', 'Emparejado por título y año (AniList no enlaza esta serie de Crunchyroll).') : null);
      };
      // AniList details: trailer, themes, studio, source, next airing; your imported score.
      const infoBox = h('div.qvinfo');
      const IMPORT_ST = { watching: 'viéndola', completed: 'completada', paused: 'en pausa', dropped: 'abandonada', planning: 'pendiente' };
      const renderInfo = (e) => {
        const parts = [];
        const imp = CRP.profile.get(x.id);
        if (imp) parts.push(h('div.qvmine', ui.icon('star', 14), `En tu lista importada: ${IMPORT_ST[imp.st] || imp.st}${imp.s != null ? ` · tu nota ${Math.round(imp.s) / 10}` : ''}`));
        if (e && e.tr) {
          const thumb = h('button.trailer', { title: 'Ver tráiler', style: { backgroundImage: `url("https://i.ytimg.com/vi/${e.tr}/hqdefault.jpg")` } }, h('span.playbtn.on', ui.icon('play', 34)), h('span.tlabel', 'Tráiler'));
          thumb.addEventListener('click', () => {
            thumb.replaceWith(h('iframe.trailer', {
              src: `https://www.youtube-nocookie.com/embed/${e.tr}?autoplay=1&rel=0`,
              allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, title: 'Tráiler',
            }));
          });
          parts.push(thumb);
        }
        // Your stars (click your current rating again to clear it).
      const starsBox = h('div.mystars');
      const renderStars = (value, note) => fill(starsBox,
        h('span.lbl', 'Tu valoración'),
        [1, 2, 3, 4, 5].map((n) => h('button.star' + (n <= value ? '.on' : ''), {
          title: n <= value && n === value ? 'Quitar valoración' : `${n} estrella${n > 1 ? 's' : ''}`,
          onclick: async () => { const v = await ctx.rate(x, n); renderStars(v); },
        }, ui.icon('star', 18))),
        note ? h('small', note) : null);
      const mine = CRP.store.getRating(x.id);
      renderStars(mine ? mine.stars : 0);
      if (!mine && ctx.loggedIn) {
        api.myRating(x.id).then((r) => {
          const raw = r && (r.rating || (r.data && r.data.rating) || r.user_rating);
          const m = String(raw || '').match(/^([1-5])s$/);
          if (my === seq && m) { CRP.store.setRating(x.id, +m[1], x.title); renderStars(+m[1], 'de Crunchyroll'); }
        }).catch(() => {});
      }

      const facts = [];
        if (e && e.st && e.st.length) facts.push(h('span', 'Estudio: ', e.st.map((n, i) => [i ? ', ' : '', h('button.linkbtn', { onclick: () => { close(); ctx.search({ studio: n }); } }, n)])));
        if (e && e.src) facts.push(h('span', 'Origen: ', h('button.linkbtn', { onclick: () => { close(); ctx.search({ source: e.src }); } }, CRP.tags.sourceLabel(e.src))));
        const nx = CRP.ext.nextAiring(x.id);
        if (nx) facts.push(h('span', `Próximo en Japón: E${nx.ep} · ${new Date(nx.at).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`));
        if (facts.length) parts.push(h('div.qvfacts2', facts));
        const themes = [...((e && e.ge) || []), ...((e && e.tg) || []).map((t) => t[0])].filter((n, i, a) => a.indexOf(n) === i);
        if (themes.length) {
          parts.push(h('div.qvthemes', themes.slice(0, 16).map((n) => h('button.chip.small.theme', { title: n, onclick: () => { close(); ctx.search({ tagsIn: [n] }); } }, CRP.tags.label(n)))));
        }
        fill(infoBox, parts);
      };
      renderInfo(CRP.ext.get(x.id));
      // Watch order across the franchise (AniList relations), when there's more than one entry.
      const orderBox = h('div.qvorder');
      const FORMAT = { TV: 'Serie', TV_SHORT: 'Serie corta', MOVIE: 'Película', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Especial', MUSIC: 'Música' };
      const renderOrder = (list, all = false) => {
        if (!list || list.length < 2) return fill(orderBox);
        let n = 0;
        const rows = list.map((o) => {
          const num = o.kind === 'main' ? ++n : null;
          const target = o.cr && o.cr !== x.id ? (CRP.catalog.get(o.cr) || { id: o.cr, title: o.title, genres: [], audio: [], subs: [] }) : null;
          const tag = o.cr === x.id ? h('span.otag.here', 'esta serie') : o.cr ? h('span.otag.cr', 'en Crunchyroll') : h('span.otag.no', 'no está en Crunchyroll');
          const meta = [o.year, FORMAT[o.format] || o.format, o.episodes && o.format !== 'MOVIE' ? `${o.episodes} ep` : null, o.status === 'NOT_YET_RELEASED' ? 'próximamente' : null].filter(Boolean).join(' · ');
          return h(target ? 'button.orow.link' : 'div.orow', { onclick: target ? () => open(target, { push: true }) : null },
            h('span.onum' + (o.kind === 'extra' ? '.extra' : ''), num || '+'),
            h('span.otitle', o.title, h('small', meta)),
            tag);
        });
        fill(orderBox,
          h('h3', 'Orden de visionado'),
          h('p.mini', 'Numeradas: la historia principal. «+»: extras (películas, OVAs) colocados por fecha.'),
          rows.slice(0, all ? rows.length : 10),
          rows.length > 10 && !all ? h('button.linkbtn', { onclick: () => renderOrder(list, true) }, `Ver las ${rows.length}`) : null);
      };
      const desc = h('p.qvdesc', x.description || '');
      const seasonsBox = h('div.qvseasons', h('div.mini', 'Cargando temporadas…'));
      const similarBox = h('div.qvsim', ui.skeleton('poster', 4, { layout: 'grid' }));

      fill(panel,
        h('div.qvbar',
          stack.length > 1 ? h('button.icon', { title: 'Volver', onclick: back }, ui.icon('back', 20)) : h('span'),
          h('button.icon', { title: 'Cerrar (Esc)', onclick: close }, ui.icon('x', 20))),
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
            x.rating != null ? h('div.big', ui.icon('star', 20), x.rating.toFixed(1), h('small', `${ui.fmtVotes(x.votes)} votos`)) : h('div.mini', 'Sin valoraciones'),
            distBars(x)),
          h('div.qvlang',
            h('h4', 'Audio'), x.audio && x.audio.length ? langChips(x.audio, dub) : h('div.mini', '—'),
            h('h4', 'Subtítulos'), x.subs && x.subs.length ? langChips(x.subs, CRP.util.contentLocale()) : h('div.mini', '—'))),
        extBox,
        infoBox,
        desc,
        orderBox,
        h('h3', 'Temporadas'), seasonsBox,
        h('h3', 'Parecidas'), similarBox,
      );

      if (CRP.store.get().ext !== false) {
        CRP.ext.ensure(x).then(async (e) => {
          if (my !== seq) return;
          renderExt(e, null);
          renderInfo(e);
          CRP.ext.watchOrder(x).then((list) => { if (my === seq) renderOrder(list); }).catch(() => {});
          const mal = e && e.mal ? await CRP.ext.malScore(e.mal).catch(() => null) : null;
          if (my === seq && mal) renderExt(e, mal);
        }).catch(() => { if (my === seq) fill(extBox, h('div.mini', 'No se pudo consultar AniList.')); });
      } else fill(extBox);

      // full description (browse truncates it)
      api.seriesInfo(x.id).then((info) => { if (my === seq && info && info.description) desc.textContent = info.description; }).catch(() => {});

      // seasons, with the dub languages each one actually has
      api.seasons(x.id).then((list) => {
        if (my !== seq) return;
        const rows = list.filter((s) => !s.is_clip).map((s) => {
          const audios = [...new Set([s.audio_locale, ...(s.versions || []).map((v) => v.audio_locale)].filter(Boolean))];
          return h('div.season',
            h('div.st', h('b', s.season_display_number ? `T${s.season_display_number}` : `T${s.season_number || '?'}`), ' ', s.title),
            h('div.sm', `${s.number_of_episodes || '?'} ep`, audios.length ? h('span', ' · ', audios.map(langName).join(', ')) : null,
              dub && audios.includes(dub) ? h('span.ok', ` ✓ ${langName(dub)}`) : null));
        });
        fill(seasonsBox, rows.length ? rows : h('div.mini', 'Sin temporadas disponibles'));
      }).catch(() => fill(seasonsBox, h('div.mini', 'No se pudieron cargar las temporadas')));

      api.similar(x.id, 18).then((list) => {
        if (my !== seq) return;
        const items = list.map((it) => (CRP.catalog.get && CRP.catalog.get(it.id)) || M.series(it)).filter(Boolean);
        fill(similarBox, items.length
          ? ui.grid(items.map((s) => {
            const card = ui.posterCard(s, { ctx, actions: ['list'], badge: ctx.inWatchlist(s.id) ? 'EN TU LISTA' : ctx.hasWatched(s.id) ? 'VISTA' : null });
            card.addEventListener('click', (e) => {
              if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); open(s, { push: true }); }
            }, true);
            return card;
          }), { kind: 'poster small' })
          : h('div.mini', 'Sin sugerencias'));
      }).catch(() => fill(similarBox, h('div.mini', 'No se pudieron cargar')));
    }

    return { panel, scrim, open, close, isOpen: () => !panel.hidden, current: () => stack.length && stack[stack.length - 1].rec };
  }

  return { create };
})();
