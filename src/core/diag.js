// Diagnostics: a small ring buffer of recent errors plus a report the user can copy
// from Settings, so problems with their real session can be reported without DevTools.
// Ids are masked; no tokens are ever recorded.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.diag = (() => {
  const MAX = 30;
  const errors = [];
  const state = { tokenSource: null, tokenAt: null, anonymous: null, accountId: null, profileId: null, idField: null };

  const mask = (id) => (id ? String(id).slice(0, 4) + '…' + String(id).slice(-2) : null);

  function error(where, err) {
    errors.unshift({
      t: new Date().toISOString(),
      where,
      status: err && err.status,
      msg: String((err && err.message) || err).slice(0, 200),
    });
    errors.length = Math.min(errors.length, MAX);
  }

  function setAuth({ source, anonymous, accountId, profileId }) {
    Object.assign(state, { tokenSource: source, tokenAt: new Date().toISOString(), anonymous, accountId: mask(accountId), profileId: mask(profileId) });
  }

  // Probes every endpoint CR+ depends on; returns [{ name, ok, status, ms, note }].
  async function probe() {
    const api = CRP.api;
    const out = [];
    const run = async (name, fn) => {
      const t0 = performance.now();
      try {
        const note = await fn();
        out.push({ name, ok: true, ms: Math.round(performance.now() - t0), note: note == null ? '' : String(note) });
      } catch (e) {
        out.push({ name, ok: false, status: e && e.status, ms: Math.round(performance.now() - t0), note: String((e && e.message) || e).slice(0, 120) });
      }
    };
    const s = await api.session().catch(() => null);
    await run('Sesión', async () => (s ? (s.anonymous ? 'anónima (sin cuenta)' : 'con cuenta') : 'sin token'));
    if (s && !s.anonymous) {
      await run('Historial', async () => `${(await api.watchHistory(1, 5)).length} entradas`);
      await run('Seguir viendo', async () => `${(await api.continueWatching(3)).length} entradas`);
      await run('Mi lista', async () => `${(await api.watchlist(5)).length} entradas`);
    }
    await run('Catálogo (browse)', async () => `${((await api.browse({ n: 1 })).total) || '?'} títulos`);
    await run('Temporadas / episodios', async () => {
      const b = (await api.browse({ n: 1, sort_by: 'popularity' })).data[0];
      const seasons = await api.seasons(b.id);
      const eps = seasons.length ? await api.episodes(seasons[0].id) : [];
      return `${seasons.length} temp. · ${eps.length} ep`;
    });
    await run('AniList', async () => {
      const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ Media(id: 21) { id } }' }) });
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
      return `quedan ${r.headers.get('x-ratelimit-remaining')} peticiones/min`;
    });
    return out;
  }

  async function report(probes) {
    const st = CRP.store;
    const local = await chrome.storage.local.get(['notify:status']).catch(() => ({}));
    const cat = CRP.catalog && CRP.catalog.current();
    return {
      version: chrome.runtime.getManifest().version,
      when: new Date().toISOString(),
      page: location.pathname,
      locale: CRP.util.contentLocale(),
      dub: st.dubLocale(),
      auth: { ...state },
      catalog: cat ? { items: cat.items.length, ts: new Date(cat.ts).toISOString() } : null,
      anilist: CRP.ext ? CRP.ext.stats() : null,
      profile: CRP.profile ? CRP.profile.summary() : null,
      notifications: local['notify:status'] || null,
      probes: probes || null,
      errors: errors.slice(0, 15),
      ua: navigator.userAgent,
    };
  }

  return { error, setAuth, probe, report, errors: () => errors.slice(), state };
})();
