// App shell: header (tabs + natural-language search), four views (Hoy, Buscar, Para ti,
// Agenda), the quick-view drawer and settings. Also builds the shared ctx: memoized data
// loaders + user actions every view uses.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.app = (() => {
  const { h, fill, debounce } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;
  const api = CRP.api;
  const store = CRP.store;
  const BYPASS_KEY = 'crp-bypass';

  // memoized async loader; failures are not cached so "Reintentar" works
  function lazy(fn) {
    let p = null;
    let value;
    const get = () => (p || (p = fn().then((v) => { value = v; return v; }, (e) => { p = null; throw e; })));
    get.reset = () => { p = null; value = undefined; };
    get.now = () => value;
    return get;
  }

  function emitter() {
    const fns = new Set();
    return { on: (fn) => { fns.add(fn); return () => fns.delete(fn); }, emit: (v) => fns.forEach((fn) => fn(v)) };
  }

  function createCtx(root, auth) {
    const loggedIn = !auth.anonymous;
    const listeners = { watchlist: new Map(), taste: new Map(), ext: new Map(), shelves: new Map(), progress: new Map() };
    const emit = (ev) => (listeners[ev] || new Map()).forEach((fn) => { try { fn(); } catch (e) { console.warn('[CR+]', e); } });
    let watchlistIds = new Set();
    let stats = new Map();
    let agendaById = new Map();
    const graphProgress = emitter();
    const agendaProgress = emitter();

    const data = {};
    // Official "continue watching"; if it fails, the latest unfinished episode per series.
    data.continue = lazy(() => api.continueWatching(30).catch(async (err) => {
      console.warn('[CR+] continue-watching endpoint failed, using history', err);
      const hist = await data.history();
      const seen = new Set();
      return hist.filter((e) => {
        const sid = e.panel && e.panel.episode_metadata && e.panel.episode_metadata.series_id;
        if (!sid || seen.has(sid)) return false;
        seen.add(sid);
        return !e.fully_watched;
      });
    }));
    data.history = lazy(async () => {
      const list = loggedIn ? await api.watchHistory(3) : [];
      stats = CRP.recs.seriesStats(list);
      return list;
    });
    data.watchlist = lazy(async () => {
      const raw = loggedIn ? await api.watchlist() : [];
      const list = raw.map((item) => {
        const p = item.panel || {};
        const isEp = p.type === 'episode' || p.type === 'movie' || p.episode_metadata;
        const next = isEp ? M.episode(p) : null;
        const series = isEp ? null : M.series(p);
        return {
          seriesId: next ? next.seriesId : series && series.id,
          title: next ? next.seriesTitle : series && series.title,
          series, next,
          isNew: !!item.new, newContent: !!item.new_content,
          neverWatched: !!item.never_watched, fullyWatched: !!item.fully_watched,
          favorite: !!item.is_favorite, playhead: item.playhead || 0,
        };
      }).filter((w) => w.seriesId);
      watchlistIds = new Set(list.map((w) => w.seriesId));
      return list;
    });
    // Watchlist with full series objects (episode panels lack posters/genres).
    data.watchlistSeries = lazy(async () => {
      const [list] = await Promise.all([data.watchlist(), CRP.catalog.load().catch(() => null)]);
      const missing = [];
      for (const w of list) {
        if (!w.series) w.series = CRP.catalog.get(w.seriesId) || null;
        if (!w.series) missing.push(w.seriesId);
      }
      if (missing.length) {
        const objs = new Map((await api.objects(missing).catch(() => [])).map(M.series).filter(Boolean).map((s) => [s.id, s]));
        list.forEach((w) => { if (!w.series) w.series = objs.get(w.seriesId) || null; });
      }
      return list;
    });
    data.categories = lazy(async () => {
      const key = 'cats:' + CRP.util.contentLocale();
      const slim = (list) => list.map((c) => ({ tenant_category: c.tenant_category, localization: { title: c.localization && c.localization.title } }));
      const fresh = () => api.categories().then((c) => { const s = slim(c); M.setCategories(s); store.cacheSet(key, s); return s; });
      const cached = await store.cacheGet(key, 7 * 86400000);
      if (cached) { M.setCategories(cached); fresh().catch(() => {}); return cached; }
      return fresh();
    });
    data.graph = lazy(async () => {
      await CRP.catalog.load();
      const [, watchlist] = await Promise.all([data.history(), data.watchlistSeries()]);
      return CRP.recs.prepare({ stats, watchlist, imported: ctx.tasteEntries(), onProgress: graphProgress.emit });
    });
    data.graphNow = () => data.graph.now();
    data.agenda = lazy(async () => {
      const [history, watchlist] = await Promise.all([data.history(), data.watchlist()]);
      const watchedIds = new Set();
      for (const e of history) {
        if (!e.panel) continue;
        watchedIds.add(e.panel.id);
        ((e.panel.episode_metadata && e.panel.episode_metadata.versions) || []).forEach((v) => watchedIds.add(v.guid));
      }
      const ag = await CRP.agenda.build({ stats, watchlist, watchedIds, onProgress: agendaProgress.emit });
      agendaById = new Map(ag.series.map((s) => [s.id, s]));
      writeFollowList(ag, watchlist).catch(() => {});
      return ag;
    });

    const ctx = {
      root, auth, loggedIn, data,
      settings: () => store.get(),
      seriesStats: () => stats,
      hasWatched: (id) => stats.has(id) || CRP.profile.seen(id) || !!store.getRating(id),
      // seen outside the Crunchyroll history: imported list or rated here
      seenElsewhere: (id) => CRP.profile.seen(id) || !!store.getRating(id),
      // card badge: in your list / seen here / seen per your imported list (with your score)
      badge(x) {
        const mine = store.getRating(x.id);
        if (mine) return `TU NOTA ${'★'.repeat(mine.stars)}`;
        if (watchlistIds.has(x.id)) return 'EN TU LISTA';
        if (stats.has(x.id)) return 'VISTA';
        const imp = CRP.profile.get(x.id);
        if (imp && imp.st !== 'planning') return imp.s != null ? `TU NOTA ${Math.round(imp.s / 10)}` : 'VISTA';
        return null;
      },
      inWatchlist: (id) => watchlistIds.has(id),
      agendaFor: (id) => agendaById.get(id),
      dub: () => store.dubLocale(),
      on(ev, key, fn) { listeners[ev].set(key, fn); },
      emit,
      onGraphProgress: graphProgress.on,
      onAgendaProgress: agendaProgress.on,
      resetGraph() { data.graph.reset(); },

      rank(limit = 60) {
        const graph = data.graph.now();
        const catalog = CRP.catalog.current();
        if (!graph || !catalog) return { items: [], seeds: [], profile: [] };
        return CRP.recs.rank(graph, { catalog, stats, inWatchlist: ctx.inWatchlist, isSeen: ctx.seenElsewhere, tune: store.get().tune, dub: store.dubLocale(), limit });
      },

      openOriginal() {
        try { sessionStorage.setItem(BYPASS_KEY, '1'); } catch (e) { /* ignore */ }
        location.reload();
      },

      async toggleWatchlist(series) {
        const had = watchlistIds.has(series.id);
        const apply = (on) => {
          on ? watchlistIds.add(series.id) : watchlistIds.delete(series.id);
          root.querySelectorAll(`button.act.list[data-sid="${CSS.escape(series.id)}"]`).forEach((b) => {
            b.classList.toggle('on', on);
            b.title = on ? 'Quitar de Mi lista' : 'Añadir a Mi lista';
            b.replaceChildren(ui.icon(on ? 'check' : 'plus', 16));
          });
        };
        apply(!had);
        try {
          if (had) await api.removeFromWatchlist(series.id);
          else await api.addToWatchlist(series.id);
          const list = data.watchlist.now();
          if (list && !had && !list.some((w) => w.seriesId === series.id)) {
            list.unshift({ seriesId: series.id, title: series.title, series: CRP.catalog.get(series.id) || null, next: null, neverWatched: true });
          }
          ui.toast(had ? `«${series.title}» quitada de Mi lista` : `«${series.title}» añadida a Mi lista`);
          emit('watchlist');
        } catch (e) {
          apply(had);
          ui.toast('No se pudo actualizar Mi lista. Inténtalo en la página de la serie.');
        }
      },

      // Taste entries for the recommender: imported list + stars given here (these win).
      tasteEntries() {
        const map = new Map(CRP.profile.entries().map((e) => [e.id, e]));
        for (const r of store.ratingList()) map.set(r.id, { id: r.id, s: r.stars * 20, stars: r.stars, st: 'completed' });
        return [...map.values()];
      },

      // Your stars: saved here, sent to Crunchyroll (optional), and fed to the recommender.
      async rate(series, stars) {
        const prev = store.getRating(series.id);
        const value = prev && prev.stars === stars ? 0 : stars; // clicking your current rating clears it
        await store.setRating(series.id, value, series.title);
        if (value && loggedIn && store.get().rateToCR !== false) {
          api.rateSeries(series.id, value).catch((e) => {
            CRP.diag.error('valorar en Crunchyroll', e);
            ui.toast('Guardada en CR+, pero Crunchyroll no aceptó la valoración.');
          });
        }
        const g = data.graph.now();
        if (g && value) {
          const s = value * 20;
          g.seeds = g.seeds.filter((x) => x.id !== series.id);
          g.importNeg = (g.importNeg || []).filter((id) => id !== series.id);
          if (s >= 80) g.seeds.push({ id: series.id, title: series.title, w: 0, s, stars: value, kind: 'import' });
          if (s <= 40) g.importNeg.push(series.id);
          await CRP.recs.extend(g, series.id);
        }
        emit('taste');
        return value;
      },

      // Unstarted watchlist series in the user's order (then AniList score) — "Tu cola".
      queue(ag) {
        const q = store.getQueue();
        const pos = (id) => { const i = q.indexOf(id); return i < 0 ? Infinity : i; };
        const score = (id) => { const al = CRP.ext.score(id); if (al != null) return al; const x = CRP.catalog.get(id); return x && x.quality ? x.quality * 18 : 0; };
        return (ag ? ag.series : []).filter((s) => s.state === 'unstarted' && s.inList)
          .sort((a, b) => pos(a.id) - pos(b.id) || score(b.id) - score(a.id));
      },
      async setQueueOrder(ids) { await store.setQueue(ids); emit('progress'); },

      // Remove several series from the Crunchyroll watchlist (with undo).
      async removeManyFromWatchlist(list, onStep) {
        const done = [];
        for (const x of list) {
          try { await api.removeFromWatchlist(x.id); done.push(x); watchlistIds.delete(x.id); } catch (e) { CRP.diag.error('quitar de lista', e); }
          onStep && onStep(done.length, list.length);
        }
        emit('watchlist');
        data.agenda.reset();
        emit('progress');
        ui.toast(`${done.length} series quitadas de Mi lista`, {
          action: {
            label: 'Deshacer',
            run: async () => {
              for (const x of done) { try { await api.addToWatchlist(x.id); watchlistIds.add(x.id); } catch (e) { /* keep going */ } }
              emit('watchlist'); data.agenda.reset(); emit('progress');
            },
          },
          ms: 8000,
        });
        return done.length;
      },

      // Mark an episode watched on Crunchyroll (with undo), then refresh what depends on it.
      async markWatched(ep) {
        try {
          await api.markWatched(ep.id);
        } catch (e) {
          ui.toast('Crunchyroll no aceptó marcarlo como visto.');
          return false;
        }
        const refresh = () => { data.continue.reset(); data.history.reset(); data.agenda.reset(); store.cacheClear('ag:' + ep.seriesId); emit('progress'); };
        refresh();
        ui.toast(`Visto: ${ep.seriesTitle || ''} ${M.epLabel(ep)}`, {
          action: { label: 'Deshacer', run: async () => { await api.unmarkWatched(ep.id).catch(() => {}); refresh(); } },
        });
        return true;
      },
      // Hide a "Sigue viendo" entry locally (Crunchyroll keeps it); it comes back with a newer episode.
      async hideContinue(ep) {
        await store.setContHidden(ep.seriesId, ep.id);
        emit('progress');
        ui.toast(`«${ep.seriesTitle || ep.title}» quitada de Sigue viendo`, {
          action: { label: 'Deshacer', run: async () => { await store.setContHidden(ep.seriesId, null); emit('progress'); } },
        });
      },

      async like(series) {
        if (store.isLiked(series.id)) {
          await store.unlike(series.id);
          ui.toast(`Quitado el me gusta de «${series.title}»`);
        } else {
          await store.like(series.id, series.title);
          ui.toast(`Anotado: más como «${series.title}»`);
        }
        root.querySelectorAll(`button.act.like[data-sid="${CSS.escape(series.id)}"]`).forEach((b) => b.classList.toggle('on', store.isLiked(series.id)));
        const g = data.graph.now();
        if (g) await CRP.recs.extend(g, series.id);
        emit('taste');
      },

      async dislike(series) {
        await store.hide(series.id, series.title);
        const g = data.graph.now();
        if (g) await CRP.recs.extend(g, series.id);
        emit('taste');
        ui.toast(`Vale, nada de «${series.title}» ni parecidas`, {
          action: { label: 'Deshacer', run: async () => { await store.unhide(series.id); emit('taste'); } },
        });
      },
    };
    return ctx;
  }

  // What the background worker should notify about: series you follow (not abandoned)
  // in the audio you watch them in, plus your watchlist; AniList airing time as fallback.
  async function writeFollowList(ag, watchlist) {
    const dub = store.dubLocale();
    const items = new Map();
    for (const s of ag.series) {
      if (s.state === 'abandoned' || (s.state === 'unstarted' && !s.inList)) continue;
      items.set(s.id, { id: s.id, title: s.title, audios: s.started ? [s.audio] : ['ja-JP', dub].filter(Boolean), nx: CRP.ext.nextAiring(s.id) });
    }
    for (const w of watchlist) {
      if (!items.has(w.seriesId)) items.set(w.seriesId, { id: w.seriesId, title: w.title, audios: ['ja-JP', dub].filter(Boolean), nx: CRP.ext.nextAiring(w.seriesId) });
    }
    await store.localSet('notify:watch', { ts: Date.now(), locale: CRP.util.contentLocale(), prefix: CRP.util.localePrefix(), items: [...items.values()] });
  }

  // Parser vocabulary from AniList data (English tag names, studios).
  function refreshVocabulary() {
    const v = CRP.ext.vocabulary();
    CRP.tags.addNames([...v.themes.keys()]);
    CRP.tags.setStudios([...v.studios.keys()]);
  }

  // ---------------------------------------------------------------- settings
  function settingsDrawer(ctx, { onChange }) {
    const drawer = h('aside.drawer', { hidden: true, tabindex: '-1', 'aria-label': 'Ajustes de Crunchyroll+' });
    const close = () => { drawer.hidden = true; };
    ctx.root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) close(); });
    const render = () => {
      const s = store.get();
      const hidden = store.hiddenList();
      const liked = store.likedList();
      fill(drawer,
        h('header', h('h3', 'Ajustes'), h('button.icon', { title: 'Cerrar', onclick: close }, ui.icon('x', 20))),
        h('h4', 'Idioma de doblaje que te interesa'),
        h('p.hint', 'Se usa en filtros, recomendaciones y fichas.'),
        ui.select([
          { id: 'auto', title: `Automático (${CRP.util.langName(CRP.util.defaultDub())})` },
          ...['es-ES', 'es-419', 'en-US', 'pt-BR', 'fr-FR', 'de-DE', 'it-IT', 'ar-SA', 'ru-RU', 'hi-IN', 'pl-PL', 'ko-KR', 'th-TH', 'id-ID', 'zh-TW']
            .map((id) => ({ id, title: CRP.util.langName(id) })),
          { id: 'none', title: 'Ninguno (veo en V.O.)' },
        ], s.dub, (v) => store.set({ dub: v }).then(onChange), 'Doblaje'),
        h('h4', `No me interesa (${hidden.length})`),
        hidden.length
          ? h('ul.hiddenlist', hidden.slice(0, 60).map((x) => h('li', h('span', x.title || x.id),
            h('button.btn.ghost.small', { onclick: async () => { await store.unhide(x.id); ctx.emit('taste'); render(); } }, 'Restaurar'))))
          : h('p.hint', 'Usa 👎 en cualquier serie para que no vuelva a aparecer (ni sus parecidas).'),
        h('h4', `Me gusta (${liked.length})`),
        liked.length
          ? h('ul.hiddenlist', liked.slice(0, 60).map((x) => h('li', h('span', x.title || x.id),
            h('button.btn.ghost.small', { onclick: async () => { await store.unlike(x.id); ctx.emit('taste'); render(); } }, 'Quitar'))))
          : h('p.hint', 'Usa 👍 para que una serie cuente como referencia de tu gusto.'),
        h('h4', 'Valoraciones externas'),
        h('p.hint', 'Añade la nota de AniList (y la de MyAnimeList en la ficha). Solo se envían títulos de series, nada de tu cuenta.'),
        ui.toggle('Usar AniList / MyAnimeList', s.ext !== false, (v) => store.set({ ext: v }).then(() => { if (v) startEnrichment(ctx); onChange(); })),
        (() => {
          const st = CRP.ext.stats();
          const line = h('p.hint', st.progress
            ? `Consultando AniList: ${st.progress.done} de ${st.progress.total}…`
            : `${st.matched} series con nota de AniList${st.missed ? ` · ${st.missed} sin coincidencia` : ''}.`);
          return h('div', line, h('button.btn.ghost.small', {
            onclick: async () => { await CRP.ext.reset(); startEnrichment(ctx); ui.toast('Consultando AniList de nuevo en segundo plano…'); render(); },
          }, 'Volver a consultar AniList'));
        })(),
        profileSection(ctx, render, onChange),
        notifySection(ctx),
        diagSection(),
        h('h4', 'Datos'),
        h('div.btns',
          h('button.btn', { onclick: async () => { close(); ui.toast('Reindexando el catálogo…'); await CRP.catalog.refresh(); ui.toast('Catálogo actualizado'); } }, ui.icon('refresh', 16), 'Reindexar catálogo'),
          h('button.btn.ghost', { onclick: async () => { await store.cacheClear('sim:'); await store.cacheClear('ag:'); close(); onChange(); } }, 'Recalcular recomendaciones y agenda'),
          h('button.btn.ghost', { onclick: () => ctx.openOriginal() }, 'Ver inicio original (esta pestaña)'),
          h('button.btn.ghost', { onclick: async () => { await store.set({ enabled: false }); } }, 'Desactivar Crunchyroll+'),
        ),
      );
    };
    return { el: drawer, open: () => { render(); drawer.hidden = false; drawer.focus(); }, close };
  }

  // Import taste from a public AniList / MyAnimeList list.
  function profileSection(ctx, render, onChange) {
    const sum = CRP.profile.summary();
    const s = store.get();
    const wrap = h('div.setsec');
    const status = h('p.hint');
    const head = [h('h4', 'Tu perfil de AniList / MyAnimeList'),
      h('p.hint', 'Importa tu lista pública: lo que ya viste (aunque no fuera en Crunchyroll) y tus notas, que pesan mucho en las recomendaciones.'),
      ctx.loggedIn ? ui.toggle('Enviar mis estrellas (de la ficha) también a Crunchyroll', s.rateToCR !== false, (v) => store.set({ rateToCR: v })) : null];
    if (sum) {
      const src = sum.source === 'mal' ? 'MyAnimeList' : 'AniList';
      fill(wrap, head,
        h('p.ok', `${src} · ${sum.user}: ${sum.mapped} series emparejadas con Crunchyroll (de ${sum.total} en tu lista), ${sum.scored} con nota.`),
        ui.toggle('Usar mi lista importada', s.useImport !== false, (v) => store.set({ useImport: v }).then(onChange)),
        h('div.btns.row',
          h('button.btn.ghost.small', { onclick: () => run(sum.source, sum.user) }, ui.icon('refresh', 14), 'Actualizar'),
          h('button.btn.ghost.small', { onclick: async () => { await CRP.profile.clear(); onChange(); render(); } }, 'Quitar importación')),
        status);
    } else {
      const user = h('input.txt', { type: 'text', placeholder: 'Tu nombre de usuario', autocomplete: 'off', spellcheck: 'false' });
      const src = ui.select([{ id: 'anilist', title: 'AniList' }, { id: 'mal', title: 'MyAnimeList' }], 'anilist', () => {}, 'Origen');
      fill(wrap, head,
        h('div.btns.row', src, user, h('button.btn.small', { onclick: () => run(src.value, user.value.trim()) }, 'Importar')),
        status);
    }
    async function run(source, user) {
      if (!user) { status.textContent = 'Escribe tu nombre de usuario.'; return; }
      try {
        const step = (t) => { status.textContent = t; };
        const r = source === 'mal' ? await CRP.profile.importMal(user, step) : await CRP.profile.importAniList(user, step);
        ui.toast(`Importadas ${r.mapped} series de ${source === 'mal' ? 'MyAnimeList' : 'AniList'}`);
        onChange();
        render();
      } catch (e) {
        status.textContent = e.message;
        CRP.diag.error('importar perfil', e);
      }
    }
    return wrap;
  }

  // Release notifications (run by the background worker).
  function notifySection() {
    const s = store.get();
    const status = h('p.hint', '…');
    const showStatus = async () => {
      const { 'notify:status': st, 'notify:watch': w } = await chrome.storage.local.get(['notify:status', 'notify:watch']);
      const n = w && w.items ? w.items.length : 0;
      if (!st) { status.textContent = `Siguiendo ${n} series. Primera comprobación en unos minutos.`; return; }
      const when = CRP.util.timeAgo(new Date(st.ts).toISOString());
      status.textContent = st.skipped ? `No se comprueba: ${st.reason}.`
        : st.ok ? `Siguiendo ${n} series · última comprobación ${when}${st.found ? ` · ${st.found} avisos` : ''}.`
          : `Crunchyroll no respondió desde segundo plano (${st.error}); uso los horarios de AniList · ${when}.`;
    };
    showStatus();
    return h('div.setsec',
      h('h4', 'Avisos de estreno'),
      h('p.hint', 'Un aviso de Chrome cuando sale un episodio de lo que sigues, en el idioma en que lo ves. Funciona aunque no tengas Crunchyroll abierto.'),
      ui.toggle('Avisarme de estrenos', s.notify !== false, (v) => store.set({ notify: v }).then(showStatus)),
      status,
      h('div.btns.row',
        h('button.btn.ghost.small', { onclick: () => chrome.runtime.sendMessage({ type: 'notify-test' }) }, 'Probar aviso'),
        h('button.btn.ghost.small', { onclick: async () => { status.textContent = 'Comprobando…'; await chrome.runtime.sendMessage({ type: 'notify-poll' }); showStatus(); } }, 'Comprobar ahora')));
  }

  // Diagnostics: probe endpoints, copy a report.
  function diagSection() {
    const out = h('div.diag');
    let probes = null;
    const a = CRP.diag.state;
    const errs = CRP.diag.errors();
    return h('div.setsec',
      h('h4', 'Diagnóstico'),
      h('p.hint', `Sesión: ${a.anonymous == null ? '—' : a.anonymous ? 'sin cuenta' : 'con cuenta'} · token ${a.tokenSource || '—'} · cuenta ${a.accountId || '—'} · perfil ${a.profileId || '—'}`),
      h('p.hint', errs.length ? `${errs.length} errores recientes (el último: ${errs[0].where} → ${errs[0].msg})` : 'Sin errores recientes.'),
      h('div.btns.row',
        h('button.btn.ghost.small', {
          onclick: async () => {
            fill(out, h('p.hint', 'Probando…'));
            probes = await CRP.diag.probe();
            fill(out, h('table.diagt', probes.map((p) => h('tr', h('td', p.ok ? '✅' : '❌'), h('td', p.name), h('td', p.note), h('td', `${p.ms} ms`)))));
          },
        }, 'Probar conexión'),
        h('button.btn.ghost.small', {
          onclick: async (e) => {
            const report = await CRP.diag.report(probes);
            await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
            e.target.textContent = 'Informe copiado ✓';
          },
        }, 'Copiar informe')),
      out);
  }

  // ------------------------------------------------------------------- mount
  // Constructable stylesheets aren't subject to the page's CSP style-src, unlike
  // <link>/<style> elements we'd add to its DOM.
  let cssText = null;
  async function loadStyles(shadow) {
    try {
      if (cssText == null) cssText = await (await fetch(chrome.runtime.getURL('src/ui/app.css'))).text();
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      console.warn('[CR+] adoptedStyleSheets failed, falling back to <link>', e);
      shadow.prepend(h('link', { rel: 'stylesheet', href: chrome.runtime.getURL('src/ui/app.css') }));
    }
  }

  // AniList scores for the whole catalog, filled in the background (one tab at a time).
  let enrichOff = null;
  function startEnrichment(ctx) {
    if (store.get().ext === false) return;
    const run = (index) => CRP.ext.enrich(index.items).then(() => {
      const st = CRP.ext.stats();
      refreshVocabulary();
      if (st.matched) ctx.emit('ext');
    }).catch((e) => console.warn('[CR+] AniList enrichment failed', e));
    CRP.catalog.load().then(run).catch(() => {});
    if (!enrichOff) enrichOff = CRP.catalog.onUpdate(run);
  }

  const TABS = [
    { id: 'today', title: 'Hoy', icon: 'home' },
    { id: 'search', title: 'Buscar', icon: 'search' },
    { id: 'foryou', title: 'Para ti', icon: 'sparkle' },
    { id: 'agenda', title: 'Agenda', icon: 'calendar' },
  ];

  function mount() {
    const host = h('div', { id: 'crp-host', tabindex: '-1' });
    const shadow = host.attachShadow({ mode: 'open' });
    const app = h('div.app', { style: { visibility: 'hidden' } });
    shadow.append(app);
    document.documentElement.append(host);
    loadStyles(shadow).finally(() => { app.style.visibility = ''; });

    // React may re-render <html> children; keep our host attached.
    const keep = new MutationObserver(() => { if (!host.isConnected) document.documentElement.append(host); });
    keep.observe(document.documentElement, { childList: true });

    const toasts = h('div.toasts');
    ui.setToastHost(toasts);
    let disposed = false;
    let ctx = null;
    let views = {};
    let current = null;
    let offKey = null;

    const prefix = CRP.util.localePrefix();
    const tabsNav = h('nav.tabs');
    const input = h('input.q', {
      type: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Buscar',
      placeholder: 'Busca o describe: “corta, en castellano, como Frieren”',
    });
    const searchWrap = h('div.qbox', ui.icon('search', 18), input, h('kbd', '/'));
    const headerRight = h('div.hright');
    const header = h('header.top',
      h('a.logo', { href: prefix + '/', title: 'Crunchyroll+' }, h('span', 'crunchyroll'), h('b', '+')),
      tabsNav, searchWrap, headerRight);
    const main = h('main');
    app.append(header, main, toasts);

    function go(tab, { focus = false } = {}) {
      if (!ctx) return;
      if (!views[tab]) {
        const v = CRP.views[tab](ctx);
        views[tab] = v;
        main.append(v.el);
      }
      Object.entries(views).forEach(([id, v]) => { v.el.hidden = id !== tab; });
      current = tab;
      tabsNav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      store.set({ tab });
      host.scrollTop = 0;
      if (focus) input.focus();
    }

    const onInput = debounce(() => {
      if (current !== 'search') go('search');
      views.search.setText(input.value);
    }, 60);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; onInput(); input.blur(); }
      if (e.key === 'Enter' && current !== 'search') { go('search'); views.search.setText(input.value); }
    });

    const start = async () => {
      fill(main, ui.skeleton('ep', 4), ui.skeleton('poster', 8));
      let auth;
      try {
        auth = await api.session();
      } catch (e) {
        fill(main, ui.errorBox(e, start));
        return;
      }
      if (disposed) return;
      main.replaceChildren();
      views = {};
      ctx = createCtx(shadow, auth);
      await Promise.race([Promise.all([ctx.data.categories().catch(() => {}), CRP.ext.load()]), new Promise((r) => setTimeout(r, 1500))]);
      await CRP.profile.load().catch(() => {});
      refreshVocabulary();
      startEnrichment(ctx);
      if (disposed) return;

      const drawerQV = CRP.drawer.create(ctx);
      ctx.openSeries = (s, opts) => drawerQV.open(s, opts);
      ctx.go = (tab) => go(tab);
      ctx.setQueryText = (t) => { input.value = t; };
      ctx.search = (patch) => {
        go('search');
        if (patch.text != null) input.value = patch.text;
        views.search.apply(patch);
      };

      const settings = settingsDrawer(ctx, { onChange: () => { if (ctx) { ctx.data.graph.reset(); ctx.data.agenda.reset(); start(); } } });
      app.querySelectorAll('aside.drawer, aside.qv, div.scrim').forEach((x) => x.remove());
      app.append(drawerQV.scrim, drawerQV.panel, settings.el);

      fill(tabsNav, TABS.map((t) => h('button', { dataset: { tab: t.id }, onclick: () => go(t.id) }, ui.icon(t.icon, 17), h('span', t.title))));
      fill(headerRight, h('button.icon.big', { title: 'Ajustes', onclick: () => settings.open() }, ui.icon('gear', 20)));
      if (!ctx.loggedIn) {
        main.append(h('div.signin',
          h('div', h('strong', 'No has iniciado sesión.'), ' Entra para tener agenda, pendientes y recomendaciones hechas con tu historial.'),
          h('button.btn', { onclick: () => ctx.openOriginal() }, 'Iniciar sesión')));
      }

      // Keyboard: / search · 1–4 tabs · J/K move between cards · Enter/F quick view ·
      // L add/remove from list · ? help. Ignored while typing.
      const onKey = (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.composedPath()[0];
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        const handled = () => { e.preventDefault(); e.stopPropagation(); };
        if (e.key === '/') { handled(); input.focus(); input.select(); return; }
        if (/^[1-4]$/.test(e.key)) { handled(); go(TABS[+e.key - 1].id); return; }
        if (e.key === '?') { handled(); toggleHelp(); return; }
        const scope = !app.querySelector('aside.qv').hidden ? app.querySelector('aside.qv') : main.querySelector('.view:not([hidden])');
        if (!scope) return;
        const cards = [...scope.querySelectorAll('a.card')].filter((c) => c.offsetParent);
        const cur = shadow.activeElement && shadow.activeElement.closest ? shadow.activeElement.closest('a.card') : null;
        const i = cur ? cards.indexOf(cur) : -1;
        const key = e.key.toLowerCase();
        if (key === 'j' || key === 'k') {
          handled();
          const next = cards[Math.max(0, Math.min(cards.length - 1, i + (key === 'j' ? 1 : -1)))] || cards[0];
          if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
        } else if (key === 'f' && cur) { handled(); cur.click(); }
        else if (key === 'l' && cur) { const b = cur.querySelector('button.act.list'); if (b) { handled(); b.click(); } }
      };
      if (offKey) offKey();
      window.addEventListener('keydown', onKey, true);
      offKey = () => window.removeEventListener('keydown', onKey, true);

      const saved = store.get().tab;
      go(TABS.some((t) => t.id === saved) ? saved : 'today');
      if (current === 'search' && input.value) views.search.setText(input.value);
      host.focus({ preventScroll: true });
    };

    let help = null;
    function toggleHelp() {
      if (help) { help.remove(); help = null; return; }
      const row = (k, d) => h('div.hrow', h('kbd', k), h('span', d));
      help = h('div.kbdhelp', { onclick: () => toggleHelp() },
        h('div.kbdbox',
          h('h3', 'Atajos de teclado'),
          row('/', 'Buscar'), row('1 – 4', 'Hoy · Buscar · Para ti · Agenda'), row('J / K', 'Siguiente / anterior serie'),
          row('Enter o F', 'Abrir la ficha'), row('L', 'Añadir o quitar de Mi lista'), row('Esc', 'Cerrar ficha / ajustes'), row('?', 'Esta ayuda')));
      app.append(help);
    }
    const cleanup = [() => offKey && offKey()];
    // Profile switched: rebuild everything for the new identity.
    cleanup.push(api.onIdentityChange(() => { if (!disposed) start(); }));
    start();

    return {
      host,
      refresh: start,
      unmount() {
        disposed = true;
        cleanup.forEach((fn) => fn());
        keep.disconnect();
        host.remove();
      },
    };
  }

  return { mount, BYPASS_KEY };
})();
