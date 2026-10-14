// Entry point (isolated world, document_start). Decides when CR+ takes over: only on
// the home route ("/", "/{lang}/" logged out; "/discover", "/{lang}/discover" logged in,
// where {lang} is any site language prefix: es, es-es, pt-br, fr, ko, zh-tw…),
// and follows the site's client-side navigation so going home via the logo also shows CR+.
(() => {
  const { isHomePath } = CRP.util;
  const root = document.documentElement;
  const BYPASS_KEY = CRP.app.BYPASS_KEY;
  let app = null;
  let ready = false;

  // "Ver inicio original" sets a one-shot flag: it applies to the page load that follows
  // and is consumed right away, so the tab never gets stuck on the original home.
  let bypassThisPage = false;
  try {
    bypassThisPage = sessionStorage.getItem(BYPASS_KEY) === '1';
    if (bypassThisPage) sessionStorage.removeItem(BYPASS_KEY);
  } catch (e) { /* storage blocked */ }
  const bypassed = () => bypassThisPage;
  const wanted = () => isHomePath() && !bypassed() && (!ready || CRP.store.get().enabled);

  // Data saver: on the home page the original Crunchyroll app would load ~4 MB of
  // scripts, carousels and trackers just to sit hidden behind CR+. Stop the document
  // right here (document_start) and let CR+ get the session itself. Settings are async,
  // so their on/off state is mirrored to localStorage to decide synchronously.
  // If CR+ couldn't get the session without the page, it turned the saver off for a
  // week (CRP.saver.fail) and this load runs the original app as before.
  const flag = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  if (wanted() && flag('crp-enabled') !== '0' && flag('crp-datasaver-optin') === '1' && !CRP.saver.broken() && !CRP.saver.skipThisLoad()) {
    window.stop();
    CRP.api.setPageless(true);
    CRP.boot.step('pageless');
    if (!document.head) root.prepend(document.createElement('head'));
    document.title = 'Crunchyroll';
  }
  // Spoiler-free mode on Crunchyroll's own pages (styles in boot.css), applied before
  // anything renders thanks to the mirrored flag.
  let noSpoil = flag('crp-nospoil') === '1';
  const applyNoSpoil = () => root.classList.toggle('crp-nospoil', noSpoil);
  applyNoSpoil();
  const mirror = (s) => {
    noSpoil = s.enabled !== false && !!s.noSpoilers && s.noSpoilersSite !== false;
    applyNoSpoil();
    try {
      localStorage.setItem('crp-nospoil', noSpoil ? '1' : '0');
      localStorage.setItem('crp-enabled', s.enabled === false ? '0' : '1');
      localStorage.setItem('crp-datasaver-optin', s.dataSaverOptIn === true ? '1' : '0');
      localStorage.removeItem('crp-datasaver');   // pre-0.6.4 flag (saver on by default)
    } catch (e) { /* ignore */ }
  };

  function activate() {
    root.classList.add('crp-on');
    if (app) return;
    try {
      app = CRP.app.mount();
    } catch (e) {
      console.error('[CR+] mount failed', e);
      CRP.boot.step('mount failed: ' + (e && e.message));
    }
  }
  function deactivate() {
    root.classList.remove('crp-on');
    if (app) { app.unmount(); app = null; }
  }
  // On the original home (bypass for this tab), offer a way back.
  let pill = null;
  function syncPill() {
    const show = ready && isHomePath() && bypassed() && CRP.store.get().enabled;
    if (show && !pill) {
      pill = document.createElement('div');
      pill.id = 'crp-pill';
      const shadow = pill.attachShadow({ mode: 'open' });
      const b = document.createElement('button');
      b.textContent = t('Volver a Crunchyroll+');
      b.style.cssText = 'all:initial;font:600 13px system-ui,sans-serif;color:#fff;background:#f47521;padding:10px 16px;border-radius:999px;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.4)';
      b.addEventListener('click', () => { bypassThisPage = false; pill.remove(); pill = null; sync(); });
      shadow.append(b);
      root.append(pill);
    } else if (!show && pill) {
      pill.remove();
      pill = null;
    }
  }

  function sync() {
    syncPill();
    if (!wanted()) return deactivate();
    if (!ready) { root.classList.add('crp-on'); return; } // hide the original home while settings load
    activate();
  }

  // Hide the original page synchronously to avoid a flash of the old home.
  sync();

  const loaded = (s) => {
    CRP.boot.step('settings');
    if (s) { mirror(s); CRP.i18n.setLang(s.uiLang); }
    ready = true;
    sync();
  };
  CRP.store.load().then(loaded, (e) => { console.warn('[CR+] settings failed', e); loaded(null); });

  // Watchdog: CR+ must be on screen within 10 s. Otherwise never leave a black page:
  // without the original page (data saver) load it as before; else show it.
  setTimeout(() => {
    if (!root.classList.contains('crp-on') || CRP.boot.visible) return;
    console.warn('[CR+] not shown after 10 s; start-up trail:', CRP.boot.trail.join(' → '));
    try { localStorage.setItem('crp-last-stall', new Date().toISOString() + ' ' + CRP.boot.trail.join(' → ')); } catch (e) { /* ignore */ }
    if (CRP.api.isPageless() && CRP.saver.fail('stalled at ' + CRP.boot.last())) return;
    bypassThisPage = true;
    sync();
  }, 10000);

  // Client-side navigations (Next.js pushState) don't reload the page.
  let last = location.href;
  const check = () => { if (location.href !== last) { last = location.href; sync(); } };
  setInterval(check, 300);
  window.addEventListener('popstate', check);
  if (window.navigation) window.navigation.addEventListener('navigatesuccess', check);

  // Enabled/disabled from the popup, the settings drawer or another tab. Other
  // settings are re-rendered by the drawer itself.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) CRP.store.load().then((s) => { mirror(s); CRP.i18n.setLang(s.uiLang); sync(); });
  });

  // The site's own scripts may rewrite <html class>; keep ours while active.
  new MutationObserver(() => {
    if ((app || (!ready && wanted())) && !root.classList.contains('crp-on')) root.classList.add('crp-on');
    if (noSpoil && !root.classList.contains('crp-nospoil')) root.classList.add('crp-nospoil');
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

})();
