// Persistence: settings in chrome.storage.sync (follows the user across Chrome
// installs); taste signals (👍/👎, muted seeds) and caches in chrome.storage.local.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.store = (() => {
  const DEFAULTS = {
    enabled: true,
    tab: 'today',          // last view
    ext: true,             // add AniList / MyAnimeList ratings
    dub: 'auto',           // preferred dub language ('auto' = from site locale, 'none')
    // Recommender knobs, all -1..1 except explore (0..1)
    tune: { pop: 0, len: 0, era: 0, explore: 0.3, dubOnly: false },
  };

  let settings = null;
  // 👎 / "no me interesa" (kept under the historical key "hidden")
  let hidden = null;      // { [seriesId]: { title, ts } }
  let likes = null;       // { [seriesId]: { title, ts } }
  let muted = null;       // { [seriesId]: true } history seeds the user excluded
  const listeners = new Set();

  const area = (a) => chrome.storage[a];

  async function load() {
    const [got, loc] = await Promise.all([area('sync').get('settings'), area('local').get(['hidden', 'likes', 'muted'])]);
    const s = got.settings || {};
    settings = { ...DEFAULTS, ...s, tune: { ...DEFAULTS.tune, ...(s.tune || {}) } };
    hidden = loc.hidden || {};
    likes = loc.likes || {};
    muted = loc.muted || {};
    return settings;
  }

  function get() { return settings || { ...DEFAULTS }; }

  async function set(patch) {
    settings = { ...get(), ...patch };
    await area('sync').set({ settings });
    listeners.forEach((fn) => fn(settings));
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // effective dub locale or null
  function dubLocale() {
    const d = get().dub;
    if (d === 'none') return null;
    return d === 'auto' ? CRP.util.defaultDub() : d;
  }

  // ---- taste ----
  const isHidden = (id) => !!(hidden && hidden[id]);
  const isLiked = (id) => !!(likes && likes[id]);
  const isMuted = (id) => !!(muted && muted[id]);

  async function hide(id, title) {
    hidden = { ...hidden, [id]: { title, ts: Date.now() } };
    if (likes[id]) { const { [id]: _, ...rest } = likes; likes = rest; }
    await area('local').set({ hidden, likes });
  }
  async function unhide(id) {
    const { [id]: _, ...rest } = hidden || {};
    hidden = rest;
    await area('local').set({ hidden });
  }
  async function like(id, title) {
    likes = { ...likes, [id]: { title, ts: Date.now() } };
    if (hidden[id]) { const { [id]: _, ...rest } = hidden; hidden = rest; }
    await area('local').set({ likes, hidden });
  }
  async function unlike(id) {
    const { [id]: _, ...rest } = likes || {};
    likes = rest;
    await area('local').set({ likes });
  }
  async function setMuted(id, on) {
    const { [id]: _, ...rest } = muted || {};
    muted = on ? { ...rest, [id]: true } : rest;
    await area('local').set({ muted });
  }
  const toList = (o) => Object.entries(o || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.ts - a.ts);
  const hiddenList = () => toList(hidden);
  const likedList = () => toList(likes);

  // ---- caches ----
  async function cacheGet(key, maxAgeMs) {
    const k = 'cache:' + key;
    const got = await area('local').get(k);
    const entry = got[k];
    if (!entry || Date.now() - entry.ts > maxAgeMs) return null;
    return entry.data;
  }
  async function cacheSet(key, data) {
    await area('local').set({ ['cache:' + key]: { ts: Date.now(), data } });
  }
  async function cacheClear(prefix = '') {
    const all = await area('local').get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('cache:' + prefix));
    if (keys.length) await area('local').remove(keys);
  }

  async function localGet(key) { return (await area('local').get(key))[key]; }
  async function localSet(key, value) { await area('local').set({ [key]: value }); }

  return {
    DEFAULTS, load, get, set, onChange, dubLocale,
    isHidden, isLiked, isMuted, hide, unhide, like, unlike, setMuted, hiddenList, likedList,
    cacheGet, cacheSet, cacheClear, localGet, localSet,
  };
})();
