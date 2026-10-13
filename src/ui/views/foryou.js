// "Para ti": recommendations the user can steer. Knobs re-rank instantly (no network);
// 👍/👎 and muting a seed change what the engine learns from.
var CRP = globalThis.CRP || (globalThis.CRP = {});
CRP.views = CRP.views || {};

CRP.views.foryou = (ctx) => {
  const { h, fill, debounce, langName } = CRP.util;
  const M = CRP.model;
  const ui = CRP.ui;
  const store = CRP.store;

  const panel = h('aside.tune');
  const head = h('div.reshead');
  const results = h('div.results');
  const el = h('div.view.foryou', panel, h('div.resmain', head, results));
  let tune = { ...store.get().tune };

  const persist = debounce(() => store.set({ tune: { ...tune } }), 400);

  function renderPanel(r) {
    const dub = ctx.dub();
    const seeds = r.seeds.filter((s) => s.kind !== 'like');
    const likes = store.likedList();
    const disliked = store.hiddenList().length;
    const knob = (key, left, right, min = -1, max = 1) => ui.slider({
      left, right, value: tune[key], min, max, step: 0.05,
      onInput: (v) => { tune[key] = v; persist(); rerank(); },
    });
    fill(panel,
      h('h3', ui.icon('sparkle', 16), 'Ajusta tus recomendaciones'),
      h('p.hint', 'Los cambios se aplican al momento. Doble clic en un deslizador lo centra.'),
      h('div.knobs',
        knob('pop', 'Joyas ocultas', 'Populares'),
        knob('len', 'Cortas', 'Largas'),
        knob('era', 'Clásicas', 'Recientes'),
        knob('explore', 'Lo de siempre', 'Descubrir', 0, 1)),
      dub ? ui.toggle(`Solo con audio en ${langName(dub).toLowerCase()}`, tune.dubOnly, (v) => { tune.dubOnly = v; persist(); rerank(); }) : null,

      h('h4', 'Aprende de'),
      h('p.hint', CRP.profile.active()
        ? 'Tu historial y tus mejores notas de tu lista importada (★). Desactiva lo que no represente tu gusto.'
        : 'Tu historial, ordenado por cuánto y cuándo lo viste. Desactiva lo que no represente tu gusto. (Importa tu lista de AniList/MAL en Ajustes para afinar mucho más.)'),
      h('div.seeds', seeds.map((s) => {
        const muted = store.isMuted(s.id);
        return h('button.seed' + (muted ? '.off' : ''), {
          title: muted ? 'No se usa (clic para usarla)' : 'Se usa para recomendarte (clic para ignorarla)',
          onclick: async () => { await store.setMuted(s.id, !muted); rerank(); },
        }, s.kind === 'list' ? '📌 ' : s.kind === 'import' ? `★${Math.round(s.s / 10)} ` : '', s.title);
      })),
      likes.length ? h('div',
        h('h4', 'Te gustan'),
        h('div.seeds', likes.map((l) => h('button.seed.liked', { title: 'Quitar el me gusta', onclick: async () => { await store.unlike(l.id); ctx.emit('taste'); } }, '👍 ', l.title)))) : null,
      disliked ? h('p.hint', `${disliked} descartada${disliked === 1 ? '' : 's'} con 👎 (se usan para evitar parecidas). Gestiónalas en Ajustes.`) : null,

      r.profile.length ? h('div',
        h('h4', 'Tu perfil de géneros'),
        h('div.profile', r.profile.map((g) => h('div.prow', h('span', M.genreTitle(g.id)), h('div.dbar', h('i', { style: { width: Math.round(g.w * 100) + '%' } })))))) : null,
      h('button.btn.ghost.small', { onclick: async () => { tune = { ...store.DEFAULTS.tune }; await store.set({ tune }); rerank(); } }, 'Restablecer mandos'),
    );
  }

  let graph = null;
  function rerank() {
    if (!graph) return;
    const index = CRP.catalog.current();
    const r = CRP.recs.rank(graph, {
      catalog: index, stats: ctx.seriesStats(), inWatchlist: ctx.inWatchlist, isSeen: ctx.seenElsewhere, tune, dub: ctx.dub(), limit: 72,
    });
    renderPanel(r);
    fill(head, h('div.qline',
      h('div.qhelp', 'Cada recomendación dice por qué está aquí. Usa 👍 y 👎 para afinar.'),
      h('button.btn.ghost.small', { title: 'Vuelve a leer tu historial', onclick: () => { ctx.resetGraph(); start(); } }, ui.icon('refresh', 14), 'Recalcular')));
    if (!r.items.length) {
      fill(results, ui.empty('Nada con estos mandos. Prueba a moverlos hacia el centro.'));
      return;
    }
    fill(results, ui.grid(r.items.map((it) => ui.posterCard(it.series, {
      ctx,
      actions: ['list', 'like', 'dislike'],
      why: CRP.recs.why(it),
      sub: it.traits.join(' · '),
    })), { kind: 'poster recs' }));
  }

  async function start() {
    if (!ctx.loggedIn) {
      fill(results, ui.empty('Inicia sesión para recomendaciones basadas en tu historial.', h('button.btn', { onclick: () => ctx.openOriginal() }, 'Iniciar sesión')));
      return;
    }
    const bar = ui.progressBar(0.03, 'Leyendo tu historial…');
    fill(results, h('div.indexing', h('p', 'Preparando recomendaciones a partir de lo que ves de verdad…'), bar));
    const offCat = CRP.catalog.onProgress((p) => bar.set(p * 0.5, 'Indexando catálogo…'));
    const offG = ctx.onGraphProgress((p) => bar.set(0.5 + p * 0.5, 'Buscando parecidas a tus series…'));
    try {
      graph = await ctx.data.graph();
    } catch (e) {
      fill(results, ui.errorBox(e, start));
      return;
    } finally { offCat(); offG(); }
    rerank();
  }

  ctx.on('taste', 'foryou', () => { graph = ctx.data.graphNow(); rerank(); });
  ctx.on('watchlist', 'foryou', rerank);
  ctx.on('ext', 'foryou', rerank);
  CRP.catalog.onUpdate(() => el.isConnected && rerank());
  start();

  return { el, title: 'Para ti' };
};
