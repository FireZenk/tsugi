// Toolbar popup: on/off switch and quick maintenance actions. Shares storage keys
// with src/core/store.js and src/core/catalog.js.
const $ = (id) => document.getElementById(id);

async function getSettings() {
  return (await chrome.storage.sync.get('settings')).settings || {};
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return t('hace {n} min', { n: Math.max(1, m) });
  const h = Math.round(m / 60);
  return h < 48 ? t('hace {n} h', { n: h }) : t('hace {n} d', { n: Math.round(h / 24) });
}

// Language: the one chosen in CR+ settings, else the Crunchyroll site's, else the browser's.
async function setLanguage(settings) {
  const { 'notify:watch': watch } = await chrome.storage.local.get('notify:watch');
  const pref = settings.uiLang && settings.uiLang !== 'auto' ? settings.uiLang : watch && watch.locale ? CRP.i18n.fromLocale(watch.locale) : null;
  CRP.i18n.setLang(pref);
  document.documentElement.lang = CRP.i18n.locale();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.dataset.i18n = el.dataset.i18n || el.textContent.trim();
    el.textContent = t(el.dataset.i18n);
  });
}

async function render() {
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  const settings = await getSettings();
  await setLanguage(settings);
  $('enabled').checked = settings.enabled !== false;

  const local = await chrome.storage.local.get(null);
  const cats = Object.entries(local).filter(([k]) => k.startsWith('catalog:')).map(([, v]) => v);
  const newest = cats.sort((a, b) => b.ts - a.ts)[0];
  $('cat-info').textContent = newest ? `${t('{n} títulos', { n: newest.items.length.toLocaleString(CRP.i18n.locale()) })} · ${ago(newest.ts)}` : t('Se indexa al abrir el inicio');
  $('reindex').disabled = !cats.length;

  const ext = Object.values(local['ext:anilist:v1'] || {});
  $('ext-info').textContent = ext.length ? t('{n} con nota de AniList', { n: ext.filter((e) => !e.none).length }) : '';

  const hidden = Object.keys(local.hidden || {}).length;
  const likes = Object.keys(local.likes || {}).length;
  $('taste-info').textContent = `${likes} 👍 · ${hidden} 👎`;
  $('unhide').disabled = !hidden;
}

$('enabled').addEventListener('change', async (e) => {
  const settings = await getSettings();
  await chrome.storage.sync.set({ settings: { ...settings, enabled: e.target.checked } });
});

// Dropping the index makes the next visit to the home rebuild it.
$('reindex').addEventListener('click', async () => {
  const local = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(local).filter((k) => k.startsWith('catalog:') || k.startsWith('cache:sim:') || k.startsWith('cache:ag:')));
  render();
});

$('unhide').addEventListener('click', async () => {
  await chrome.storage.local.set({ hidden: {} });
  render();
});

render();
