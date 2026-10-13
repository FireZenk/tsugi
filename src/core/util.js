// Shared helpers. All CR+ isolated-world scripts share one global scope; everything
// hangs off the CRP namespace.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.util = (() => {
  // Site language prefixes (from the site's hreflang links) → content locale for the API.
  // English has no prefix. Checked against the API on 2026-10-13.
  const LOCALES = {
    es: 'es-419', 'es-es': 'es-ES', 'pt-br': 'pt-BR', 'pt-pt': 'pt-PT', fr: 'fr-FR', de: 'de-DE', ar: 'ar-SA',
    it: 'it-IT', ru: 'ru-RU', hi: 'hi-IN', id: 'id-ID', ko: 'ko-KR', pl: 'pl-PL', th: 'th-TH', 'zh-tw': 'zh-TW',
  };
  // Likely regions for languages Crunchyroll may add later ("/ja", "/vi"…).
  const FUTURE = { ja: 'ja-JP', vi: 'vi-VN', ms: 'ms-MY', zh: 'zh-CN', tr: 'tr-TR', ca: 'ca-ES', nl: 'nl-NL', sv: 'sv-SE' };
  const LOCALE_RE = /^\/([a-z]{2}(?:-[a-z]{2})?)(?=\/|$)/;

  // First path segment if it's a language prefix: known ones, or any xx / xx-yy code
  // (so a newly added language keeps working).
  function localeCode(pathname = location.pathname) {
    const m = pathname.match(LOCALE_RE);
    return m ? m[1] : null;
  }

  // "/es-es/series/..." -> "/es-es" ; "/series/..." -> ""
  function localePrefix(pathname = location.pathname) {
    const code = localeCode(pathname);
    return code ? '/' + code : '';
  }

  // Content locale for API calls, e.g. "es-ES", "pt-BR", "es-419", "en-US".
  function contentLocale(pathname = location.pathname) {
    const code = localeCode(pathname);
    if (!code) return 'en-US';
    if (LOCALES[code]) return LOCALES[code];
    const [lang, region] = code.split('-');
    return region ? `${lang}-${region.toUpperCase()}` : FUTURE[lang] || 'en-US';
  }

  // Home = "/" or "/{lang}/" (logged out) and "/discover" or "/{lang}/discover" (logged
  // in: Crunchyroll sends signed-in users there). {lang} is any language prefix.
  function isHomePath(pathname = location.pathname) {
    return /^\/(?:[a-z]{2}(?:-[a-z]{2})?(?:\/|$))?(?:discover\/?)?$/.test(pathname);
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Tiny hyperscript: h('div.card', {onclick}, child, [children], 'text')
  function h(tag, props, ...children) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.className = classes.join(' ');
    if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
      children.unshift(props);
      props = null;
    }
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // replaceChildren() that skips null/false (replaceChildren would print "null")
  function fill(el, ...children) {
    el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
    return el;
  }

  function svg(pathD, size = 18) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    for (const d of [].concat(pathD)) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
    return s;
  }

  // images.poster_tall = [[{width,height,source}, ...]] -> best source for width
  function pickImage(images, key, width) {
    const list = images && images[key] && images[key][0];
    if (!list || !list.length) return null;
    const sorted = [...list].sort((a, b) => a.width - b.width);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return (sorted.find((i) => i.width >= width * dpr) || sorted[sorted.length - 1]).source;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    const d = Math.round(s / 86400);
    if (d < 30) return `hace ${d} d`;
    const mo = Math.round(d / 30);
    return mo < 12 ? `hace ${mo} mes${mo > 1 ? 'es' : ''}` : `hace ${Math.round(mo / 12)} año${mo >= 24 ? 's' : ''}`;
  }

  function minutes(ms) { return Math.max(1, Math.round(ms / 60000)); }

  // Bayesian-smoothed rating so a 5.0 with 12 votes doesn't beat a 4.8 with 100k.
  function scoreRating(rating, prior = 4.3, weight = 400) {
    if (!rating || !rating.average) return null;
    const avg = parseFloat(rating.average);
    const n = rating.total || 0;
    return (avg * n + prior * weight) / (n + weight);
  }

  function uniqBy(arr, key) {
    const seen = new Set();
    return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = null; } }
    }));
    return out;
  }

  // lowercase, no accents: "Fantasía" -> "fantasia"
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function fmtMinutes(min) {
    min = Math.round(min);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  const LANGS = {
    'ja-JP': 'Japonés', 'es-ES': 'Castellano', 'es-419': 'Latino', 'en-US': 'Inglés', 'pt-BR': 'Portugués (BR)',
    'pt-PT': 'Portugués', 'fr-FR': 'Francés', 'de-DE': 'Alemán', 'it-IT': 'Italiano', 'ar-SA': 'Árabe', 'ru-RU': 'Ruso',
    'hi-IN': 'Hindi', 'pl-PL': 'Polaco', 'ko-KR': 'Coreano', 'zh-CN': 'Chino', 'zh-TW': 'Chino (TW)', 'th-TH': 'Tailandés',
    'id-ID': 'Indonesio', 'ms-MY': 'Malayo', 'vi-VN': 'Vietnamita', 'ta-IN': 'Tamil', 'te-IN': 'Telugu', 'ca-ES': 'Catalán', 'tr-TR': 'Turco',
  };
  const langName = (code) => LANGS[code] || code;

  // Dub language that matters for this user, from the site locale.
  function defaultDub() {
    const loc = contentLocale();
    if (loc === 'pt-PT') return 'pt-BR'; // Crunchyroll's Portuguese dubs are Brazilian
    return loc in LANGS && loc !== 'ja-JP' ? loc : 'en-US';
  }

  // Monday 00:00 (local) of the week containing d
  function weekStart(d = new Date()) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fmtTime = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return {
    localePrefix, contentLocale, isHomePath, cookie, h, append, fill, svg, pickImage, debounce, timeAgo, minutes,
    scoreRating, uniqBy, pool, norm, clamp, fmtMinutes, LANGS, langName, defaultDub, weekStart, DAYS, DAYS_LONG, fmtTime, sameDay,
  };
})();
