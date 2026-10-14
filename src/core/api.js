// Crunchyroll web API client (same endpoints the official web app uses).
// Auth: we prefer the token the page itself obtains (forwarded by hook.js). If it
// doesn't arrive in time, or it expires, we refresh with the same etp_rt cookie flow
// the web app uses (grant_type=etp_rt_cookie), falling back to an anonymous token.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.api = (() => {
  const { contentLocale, cookie } = CRP.util;
  const BASE = 'https://www.crunchyroll.com';
  const ACCOUNT_CLIENT = 'noaihdevm_6iyg0a8l0q'; // fallback; real value captured from the page
  const ANON_CLIENT = 'cr_web';
  const HOOK_WAIT_MS = 2500;

  let auth = null;      // { token, exp, accountId, profileId, anonymous }
  let template = null;  // last etp_rt token request seen from the page { authorization, body }
  let pending = null;
  let idField = 'accountId'; // which id goes into /content/v2/{id}/... (falls back to profileId)
  const waiters = [];
  const listeners = new Set();

  class ApiError extends Error {
    constructor(status, path) { super(`HTTP ${status} ${path}`); this.status = status; }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__crp !== 'hook' || d.kind !== 'token' || !d.response) return;
    accept(d.response, d.request);
  });

  function accept(res, req, source = 'página') {
    const prev = auth;
    auth = {
      token: res.access_token,
      exp: Date.now() + (res.expires_in || 300) * 1000,
      accountId: res.account_id || null,
      profileId: res.profile_id || null,
      anonymous: !res.account_id,
    };
    if (req && req.body && req.body.includes('etp_rt_cookie')) {
      template = { authorization: req.authorization, body: req.body };
      CRP.store.localSet('tokenTemplate', template);
    }
    // What the data saver needs to know next time (see CRP.saver below).
    if (!auth.anonymous) CRP.saver.setAccount(true);
    else if (source === 'página') {
      // the site itself says nobody is signed in: an old refresh template is useless,
      // and a saver turned off for "anonymous" can come back
      CRP.saver.setAccount(false);
      template = null;
      CRP.store.localSet('tokenTemplate', null);
      if (CRP.saver.reason() === 'anon') CRP.saver.reset();
    }
    if (CRP.diag) CRP.diag.setAuth({ source, anonymous: auth.anonymous, accountId: auth.accountId, profileId: auth.profileId });
    waiters.splice(0).forEach((fn) => fn(auth));
    // Identity changes found while a session() call is resolving are returned by
    // that call; only announce ones that arrive later (e.g. profile switched).
    const changed = prev && (prev.accountId !== auth.accountId || prev.profileId !== auth.profileId);
    if (changed && !pending) listeners.forEach((fn) => fn(auth));
  }

  function onIdentityChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function waitForHook(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { const i = waiters.indexOf(done); if (i >= 0) waiters.splice(i, 1); resolve(null); }, ms);
      const done = (a) => { clearTimeout(t); resolve(a); };
      waiters.push(done);
    });
  }

  function deviceType() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : 'Browser';
    const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    return `${browser} on ${os}`;
  }

  async function postToken(authorization, params) {
    const res = await fetch(BASE + '/auth/v1/token', {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw new ApiError(res.status, '/auth/v1/token');
    return res.json();
  }

  async function refreshLoggedIn() {
    template = template || (await CRP.store.localGet('tokenTemplate')) || null;
    const t = template || {};
    const params = new URLSearchParams(t.body || '');
    params.set('grant_type', 'etp_rt_cookie');
    if (!params.get('device_id') && cookie('device_id')) params.set('device_id', cookie('device_id'));
    if (!params.get('device_type')) params.set('device_type', deviceType());
    if (auth && auth.profileId) params.set('profile_id', auth.profileId);
    const res = await postToken(t.authorization || 'Basic ' + btoa(ACCOUNT_CLIENT + ':'), params);
    accept(res, null, 'renovado por CR+ (etp_rt)');
    return auth;
  }

  async function refreshAnonymous() {
    const res = await postToken('Basic ' + btoa(ANON_CLIENT + ':'), new URLSearchParams({ grant_type: 'client_id' }));
    accept(res, null, 'anónimo');
    return auth;
  }

  // When the data saver stopped the original page there's no page token to wait for.
  let pageless = false;
  const setPageless = (v) => { pageless = !!v; };
  const isPageless = () => pageless;

  let triedLogin = false;
  async function obtain() {
    if (!auth && !pageless) {
      const fromPage = await waitForHook(HOOK_WAIT_MS);
      if (fromPage && !fromPage.anonymous && fromPage.exp - Date.now() > 60000) return fromPage;
    }
    // Logged-in refresh: always when we had a session; once per page otherwise, in case
    // the page only handed us an anonymous token.
    if (!auth || !auth.anonymous || !triedLogin) {
      triedLogin = true;
      try { return await refreshLoggedIn(); } catch (e) { if (CRP.diag) CRP.diag.error('token etp_rt', e); }
    }
    if (auth && auth.anonymous && auth.exp - Date.now() > 60000) return auth;
    return refreshAnonymous();
  }

  async function session() {
    if (auth && auth.exp - Date.now() > 60000) return auth;
    if (!pending) pending = obtain().finally(() => { pending = null; });
    return pending;
  }

  function buildUrl(path, params) {
    const url = new URL(path.startsWith('http') ? path : BASE + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null || v === '' || v === false) continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    if (!url.searchParams.has('locale')) url.searchParams.set('locale', contentLocale());
    return url;
  }

  async function request(method, path, { params, body, retry = true } = {}) {
    const a = await session();
    const url = buildUrl(path, params);
    const headers = { Authorization: 'Bearer ' + a.token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (res.status === 401 && retry) {
      auth = { ...a, exp: 0 };
      return request(method, path, { params, body, retry: false });
    }
    if (!res.ok) {
      const err = new ApiError(res.status, url.pathname);
      if (CRP.diag) CRP.diag.error(method + ' ' + url.pathname.replace(/\/[A-Za-z0-9]{9,}(?=\/|$)/g, '/…'), err);
      throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const get = (path, params) => request('GET', path, { params });

  // Calls that embed the account in the path. Tries account_id, then profile_id once.
  async function personal(method, tpl, opts) {
    const a = await session();
    if (a.anonymous) throw new ApiError(401, tpl);
    const run = (field) => request(method, tpl.replace('{id}', a[field]), opts);
    try {
      return await run(idField);
    } catch (e) {
      const other = idField === 'accountId' ? 'profileId' : 'accountId';
      if (!(e.status === 403 || e.status === 404) || !a[other] || a[other] === a[idField]) throw e;
      const r = await run(other);
      idField = other;
      return r;
    }
  }

  // ---- Endpoints -----------------------------------------------------------

  const continueWatching = (n = 24) =>
    personal('GET', '/content/v2/discover/{id}/history', { params: { n } }).then((r) => r.data || []);

  async function watchHistory(maxPages = 3, pageSize = 100) {
    const out = [];
    let r = await personal('GET', '/content/v2/{id}/watch-history', { params: { page_size: pageSize } });
    out.push(...(r.data || []));
    for (let p = 1; p < maxPages && r.meta && r.meta.next_page; p++) {
      r = await get(r.meta.next_page);
      out.push(...(r.data || []));
    }
    return out;
  }

  async function watchlist(max = 300) {
    const out = [];
    for (let start = 0; start < max; start += 100) {
      const r = await personal('GET', '/content/v2/discover/{id}/watchlist', { params: { order: 'desc', n: 100, start } });
      const items = r.data || [];
      out.push(...items);
      if (items.length < 100 || (r.total && out.length >= r.total)) break;
    }
    return out;
  }

  const addToWatchlist = (contentId) =>
    personal('POST', '/content/v2/{id}/watchlist', { body: { content_id: contentId } });
  const removeFromWatchlist = (contentId) =>
    personal('DELETE', '/content/v2/{id}/watchlist/' + encodeURIComponent(contentId), {});

  const browse = (params = {}) =>
    get('/content/v2/discover/browse', { ratings: true, ...params });

  const search = (q, n = 12) =>
    get('/content/v2/discover/search', { q, n, type: 'series,movie_listing' }).then((r) => r.data || []);

  async function similar(id, n = 24) {
    const a = await session();
    if (!a.anonymous) {
      try {
        return (await personal('GET', '/content/v2/discover/{id}/similar_to/' + id, { params: { n, ratings: true } })).data || [];
      } catch (e) { /* fall back to the public variant */ }
    }
    return (await get('/content/v2/discover/similar_to/' + id, { n, ratings: true })).data || [];
  }

  const seasonalTags = () => get('/content/v2/discover/seasonal_tags').then((r) => r.data || []);
  const categories = () => get('/content/v1/tenant_categories').then((r) => r.items || r.data || []);

  async function objects(ids, params = {}) {
    const out = [];
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const r = await get('/content/v2/cms/objects/' + chunk.join(','), { ratings: true, ...params });
      out.push(...(r.data || []));
    }
    return out;
  }

  // Same calls the site uses for "Marcar como visto" and for removing history items.
  const markWatched = (contentIds) =>
    personal('POST', '/content/v2/discover/{id}/mark_as_watched/' + [].concat(contentIds).map(encodeURIComponent).join(','), {});
  const unmarkWatched = (contentIds) =>
    personal('DELETE', '/content/v2/{id}/watch-history/' + [].concat(contentIds).map(encodeURIComponent).join(','), {});
  // Your star rating on Crunchyroll ("1s".."5s").
  const rateSeries = (seriesId, stars) =>
    personal('PUT', `/content-reviews/v2/user/{id}/rating/series/${encodeURIComponent(seriesId)}`, { body: { rating: `${stars}s` } });
  const myRating = (seriesId) =>
    personal('GET', `/content-reviews/v3/user/{id}/rating/series/${encodeURIComponent(seriesId)}`, {});

  const seriesInfo = (id) => get('/content/v2/cms/series/' + id).then((r) => (r.data || [])[0] || null);
  const seasons = (id) => get(`/content/v2/cms/series/${id}/seasons`).then((r) => r.data || []);
  const episodes = (seasonId) => get(`/content/v2/cms/seasons/${seasonId}/episodes`).then((r) => r.data || []);
  // { panel, playhead, fully_watched, never_watched } for the next thing to play
  const upNext = (seriesId) => get('/content/v2/discover/up_next/' + seriesId).then((r) => (r.data || [])[0] || null);

  // For the diagnostics report: which token request we replay (parameter names only).
  async function templateInfo() {
    const tp = template || (await CRP.store.localGet('tokenTemplate'));
    return tp ? { client: tp.authorization ? 'page' : 'default', params: [...new URLSearchParams(tp.body || '').keys()] } : null;
  }

  return {
    ApiError, session, onIdentityChange, setPageless, isPageless, templateInfo,
    continueWatching, watchHistory, watchlist, addToWatchlist, removeFromWatchlist,
    browse, search, similar, seasonalTags, categories, objects,
    seriesInfo, seasons, episodes, upNext, markWatched, unmarkWatched, rateSeries, myRating,
  };
})();

// Data saver state, kept in localStorage so main.js can decide synchronously at
// document_start whether to stop the original page. If CR+ can't get the session on
// its own, the saver turns itself off for a week and the page loads as before.
CRP.saver = (() => {
  const WEEK = 7 * 86400000;
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => {
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { return false; }
    return get(k) === (v == null ? null : String(v));
  };
  const brokenAt = () => +(get('crp-saver-broken') || 0);
  return {
    broken: () => Date.now() - brokenAt() < WEEK,
    reason: () => (Date.now() - brokenAt() < WEEK ? get('crp-saver-reason') : null),
    since: () => brokenAt() || null,
    hadAccount: () => get('crp-account') === '1',
    known: () => get('crp-account') != null,
    setAccount: (on) => set('crp-account', on ? '1' : '0'),
    // Never seen this browser's session (anonymous could mean "not signed in" or "our
    // refresh failed"): run the original page once, it tells us. Once per tab session.
    checkOnce() {
      try {
        if (sessionStorage.getItem('crp-saver-check')) return false;
        sessionStorage.setItem('crp-saver-check', 'pending');
        if (sessionStorage.getItem('crp-saver-check') !== 'pending') return false;
      } catch (e) { return false; }
      location.reload();
      return true;
    },
    // main.js: is this the load checkOnce() asked for? (consumes it)
    skipThisLoad() {
      try {
        if (sessionStorage.getItem('crp-saver-check') !== 'pending') return false;
        sessionStorage.setItem('crp-saver-check', 'done');
        return true;
      } catch (e) { return false; }
    },
    // Turn the saver off and reload with the original page. Returns false (and does
    // nothing) if that can't be remembered, so it never reload-loops.
    fail(reason) {
      if (!set('crp-saver-broken', Date.now())) return false;
      set('crp-saver-reason', reason);
      if (CRP.diag) CRP.diag.error('ahorro de datos', reason);
      location.reload();
      return true;
    },
    reset() { set('crp-saver-broken', null); set('crp-saver-reason', null); },
  };
})();
