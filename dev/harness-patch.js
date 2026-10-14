// Dev harness only: pretend the page is the crunchyroll.com home route. ?site=fr (or
// es, es-419, en, it, de) picks the site language, which drives the automatic UI language.
(() => {
  const SITES = {
    es: ['/es-es', 'es-ES'], 'es-419': ['/es', 'es-419'], en: ['', 'en-US'], it: ['/it', 'it-IT'], de: ['/de', 'de-DE'], fr: ['/fr', 'fr-FR'],
  };
  const [prefix, locale] = SITES[new URLSearchParams(location.search).get('site')] || SITES.es;
  CRP.util.isHomePath = () => true;
  CRP.util.localePrefix = () => prefix;
  CRP.util.contentLocale = () => locale;
  CRP.util.defaultDub = () => locale;
})();
