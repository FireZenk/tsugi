// Toolbar popup: on/off switch and quick maintenance actions. Shares storage keys
// with src/core/store.js and src/core/catalog.js.
const $ = (id) => document.getElementById(id);

async function getSettings() {
  return (await chrome.storage.sync.get('settings')).settings || {};
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `hace ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

async function render() {
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  const settings = await getSettings();
  $('enabled').checked = settings.enabled !== false;

  const local = await chrome.storage.local.get(null);
  const cats = Object.entries(local).filter(([k]) => k.startsWith('catalog:')).map(([, v]) => v);
  const newest = cats.sort((a, b) => b.ts - a.ts)[0];
  $('cat-info').textContent = newest ? `${newest.items.length.toLocaleString('es-ES')} títulos · ${ago(newest.ts)}` : 'Se indexa al abrir el inicio';
  $('reindex').disabled = !cats.length;

  const ext = Object.values(local['ext:anilist:v1'] || {});
  $('ext-info').textContent = ext.length ? `${ext.filter((e) => !e.none).length} con nota de AniList` : '';

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
