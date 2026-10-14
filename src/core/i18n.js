// UI translations. Keys are the Spanish (Spain) text itself — readable at the call site
// and no dictionary needed for Spanish: t('Mi lista'), t('Quedan {n} min', { n }).
// Dictionaries live in src/i18n/*.js; es-419 only overrides what differs from Spain.
// Missing keys fall back to English, then to the Spanish key.
var CRP = globalThis.CRP || (globalThis.CRP = {});

// The product name lives here only: UI strings say "{app}" and t() fills it in.
CRP.brand = { name: 'Tsugi', full: 'Tsugi for Crunchyroll', mark: '次' };

CRP.i18n = (() => {
  const LANGS = [
    { id: 'es', name: 'Español (España)', locale: 'es-ES' },
    { id: 'es-419', name: 'Español (Latinoamérica)', locale: 'es-419' },
    { id: 'en', name: 'English', locale: 'en-US' },
    { id: 'it', name: 'Italiano', locale: 'it-IT' },
    { id: 'de', name: 'Deutsch', locale: 'de-DE' },
    { id: 'fr', name: 'Français', locale: 'fr-FR' },
  ];
  const dicts = {};
  let lang = null;

  // Site locale ("es-ES", "es-419", "fr-FR"…) -> UI language; anything else gets English.
  function fromLocale(loc) {
    loc = String(loc || '');
    if (/^es-(ES)?$/i.test(loc) || loc === 'es') return 'es';
    if (/^es-/i.test(loc)) return 'es-419';
    const base = loc.split('-')[0].toLowerCase();
    return ['it', 'de', 'fr'].includes(base) ? base : 'en';
  }
  // From the site's language prefix (pages) or the browser language (popup, worker).
  const detect = () => fromLocale(CRP.util ? CRP.util.contentLocale() : (globalThis.navigator && navigator.language) || 'en');

  function current() {
    if (lang) return lang;
    const pref = CRP.store && CRP.store.get && CRP.store.get().uiLang;
    return pref && pref !== 'auto' && LANGS.some((l) => l.id === pref) ? pref : detect();
  }
  // Called once settings are loaded (and when the user changes the language).
  function setLang(id) { lang = id && id !== 'auto' && LANGS.some((l) => l.id === id) ? id : detect(); }

  function lookup(key) {
    const l = current();
    if (l === 'es') return key;
    if (dicts[l] && dicts[l][key] != null) return dicts[l][key];
    if (l === 'es-419') return key;
    return (dicts.en && dicts.en[key]) != null ? dicts.en[key] : key;
  }

  function t(key, vars) {
    let s = lookup(key);
    if (s.includes('{')) {
      const v = { app: CRP.brand.name, ...(vars || {}) };
      s = s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
    }
    return s;
  }

  const add = (id, dict) => { dicts[id] = { ...(dicts[id] || {}), ...dict }; };
  const locale = () => (LANGS.find((l) => l.id === current()) || LANGS[0]).locale;
  const isSpanish = () => current() === 'es' || current() === 'es-419';

  return { LANGS, t, add, setLang, current, locale, detect, fromLocale, isSpanish, dicts };
})();

// shorthand used across the UI
var t = (key, vars) => CRP.i18n.t(key, vars);
