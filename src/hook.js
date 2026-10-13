// Runs in the page's MAIN world at document_start.
// Crunchyroll's web app keeps its access token in memory only. We observe its own
// POST /auth/v1/token calls (XHR via axios, fetch as fallback) and forward the result
// to the extension's isolated world, so CR+ uses exactly the same account/profile.
(() => {
  if (window.__crpHook) return;
  window.__crpHook = true;

  const TOKEN_PATH = '/auth/v1/token';
  const isTokenUrl = (url) => {
    try { return new URL(url, location.href).pathname === TOKEN_PATH; } catch { return false; }
  };

  const post = (request, responseText) => {
    try {
      const res = JSON.parse(responseText);
      if (!res || !res.access_token) return;
      window.postMessage({
        __crp: 'hook',
        kind: 'token',
        response: {
          access_token: res.access_token,
          expires_in: res.expires_in,
          account_id: res.account_id || null,
          profile_id: res.profile_id || null,
          country: res.country || null,
        },
        request,
      }, location.origin);
    } catch { /* not JSON, ignore */ }
  };

  // --- XMLHttpRequest ---
  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const setRequestHeader = XHR.setRequestHeader;
  const send = XHR.send;

  XHR.open = function (method, url) {
    this.__crpToken = String(method).toUpperCase() === 'POST' && isTokenUrl(url);
    if (this.__crpToken) this.__crpAuth = null;
    return open.apply(this, arguments);
  };
  XHR.setRequestHeader = function (name, value) {
    if (this.__crpToken && String(name).toLowerCase() === 'authorization') this.__crpAuth = String(value);
    return setRequestHeader.apply(this, arguments);
  };
  XHR.send = function (body) {
    if (this.__crpToken) {
      const request = { authorization: this.__crpAuth, body: typeof body === 'string' ? body : null };
      this.addEventListener('load', () => {
        if (this.status === 200) post(request, this.responseText);
      });
    }
    return send.apply(this, arguments);
  };

  // --- fetch ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const method = (init && init.method) || (input && input.method) || 'GET';
      if (method.toUpperCase() === 'POST' && isTokenUrl(url)) {
        const h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
        const request = {
          authorization: h.get('authorization'),
          body: init && typeof init.body === 'string' ? init.body : null,
        };
        p.then((r) => { if (r.ok) r.clone().text().then((t) => post(request, t)); }).catch(() => {});
      }
    } catch { /* never break the page */ }
    return p;
  };
})();
