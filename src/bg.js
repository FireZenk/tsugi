// Background service worker.
//  1. Release notifications: every 15 min, read Crunchyroll's "newly added" episodes
//     (public data, anonymous token, no user cookies) and notify about series in the
//     follow list that the home page keeps up to date (notify:watch), in the audio the
//     user watches them in. If Crunchyroll can't be reached from here, fall back to
//     AniList's airing times ("should be on Crunchyroll by now").
//  2. MyAnimeList list import: myanimelist.net has no CORS, so the page asks us.

const CR = 'https://www.crunchyroll.com';
const POLL_MIN = 15;
const local = chrome.storage.local;

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
function schedule() {
  chrome.alarms.create('crp-poll', { periodInMinutes: POLL_MIN, delayInMinutes: 1 });
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'crp-poll') poll().catch(() => {}); });

// ------------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'mal-list') { malList(msg.user).then(reply, (e) => reply({ error: e.message })); return true; }
  if (msg && msg.type === 'notify-test') { test().then(() => reply({ ok: true }), (e) => reply({ error: e.message })); return true; }
  if (msg && msg.type === 'notify-poll') { poll(true).then((s) => reply(s), (e) => reply({ error: e.message })); return true; }
  return false;
});

async function malList(user) {
  const items = [];
  for (let offset = 0; offset < 6000; offset += 300) {
    const res = await fetch(`https://myanimelist.net/animelist/${encodeURIComponent(user)}/load.json?status=7&offset=${offset}`, { credentials: 'omit' });
    if (res.status === 400 || res.status === 404) throw new Error('No existe ese usuario en MyAnimeList o su lista es privada.');
    if (!res.ok) throw new Error('MyAnimeList respondió ' + res.status);
    const page = await res.json();
    items.push(...page.map((e) => ({ anime_id: e.anime_id, score: e.score, status: e.status })));
    if (page.length < 300) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  return { items };
}

// -------------------------------------------------------------- notifications
async function settings() {
  const s = (await chrome.storage.sync.get('settings')).settings || {};
  return { enabled: s.enabled !== false, notify: s.notify !== false };
}

let token = null;
async function anonToken() {
  if (token && token.exp - Date.now() > 60000) return token.value;
  const res = await fetch(CR + '/auth/v1/token', {
    method: 'POST',
    credentials: 'omit',
    headers: { Authorization: 'Basic ' + btoa('cr_web:'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_id',
  });
  if (!res.ok) throw Object.assign(new Error('token ' + res.status), { status: res.status });
  const j = await res.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 300) * 1000 };
  return token.value;
}

async function newlyAdded(locale) {
  const t = await anonToken();
  const res = await fetch(`${CR}/content/v2/discover/browse?type=episode&sort_by=newly_added&n=100&locale=${locale}`, {
    credentials: 'omit', headers: { Authorization: 'Bearer ' + t },
  });
  if (!res.ok) throw Object.assign(new Error('browse ' + res.status), { status: res.status });
  return (await res.json()).data || [];
}

const LANG = { 'ja-JP': '', 'es-ES': ' (castellano)', 'es-419': ' (latino)', 'en-US': ' (inglés)', 'pt-BR': ' (portugués)', 'fr-FR': ' (francés)', 'de-DE': ' (alemán)', 'it-IT': ' (italiano)' };

async function poll(force = false) {
  const st = await settings();
  const { 'notify:watch': watch, 'notify:seen': seenArr = [] } = await local.get(['notify:watch', 'notify:seen']);
  if (!st.enabled || (!st.notify && !force) || !watch || !watch.items || !watch.items.length) {
    return setStatus({ ok: true, skipped: true, reason: !watch ? 'sin lista de seguimiento (abre el inicio de Crunchyroll una vez)' : 'avisos desactivados' });
  }
  const follow = new Map(watch.items.map((x) => [x.id, x]));
  const seen = new Set(seenArr);
  const firstRun = !seenArr.length;
  const fresh = [];
  let mode = 'crunchyroll';
  let error = null;
  try {
    const now = Date.now();
    for (const e of await newlyAdded(watch.locale || 'en-US')) {
      const m = e.episode_metadata || {};
      const f = follow.get(m.series_id);
      if (!f || seen.has(e.id)) continue;
      const at = Date.parse(m.premium_available_date || m.episode_air_date || '') || 0;
      if (at > now) continue;
      seen.add(e.id);
      if (f.audios && f.audios.length && !f.audios.includes(m.audio_locale)) continue;
      fresh.push({
        id: e.id,
        title: m.series_title || f.title,
        line: `T${m.season_number || 1} · E${m.episode_number ?? '?'}${e.title ? ' — ' + e.title : ''}${LANG[m.audio_locale] ?? ''}`,
        url: `${CR}${watch.prefix || ''}/watch/${e.id}/${e.slug_title || ''}`,
      });
    }
  } catch (err) {
    // Fallback: AniList airing time + 1 h (Japanese broadcast → Crunchyroll simulcast).
    mode = 'anilist';
    const now = Date.now();
    for (const f of watch.items) {
      if (!f.nx || now < f.nx.at + 3600000 || now > f.nx.at + 2 * 86400000) continue;
      const key = `al:${f.id}:${f.nx.ep}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({ id: key, title: f.title, line: `Episodio ${f.nx.ep}: debería estar ya en Crunchyroll`, url: `${CR}${watch.prefix || ''}/series/${f.id}` });
    }
    error = String(err.message || err);
  }

  await local.set({ 'notify:seen': [...seen].slice(-1500) });
  if (!firstRun) await notify(fresh); // the first poll only learns what's already out
  return setStatus({ ok: mode === 'crunchyroll', mode, error, found: firstRun ? 0 : fresh.length, firstRun, following: follow.size });
}

async function setStatus(s) {
  const status = { ...s, ts: Date.now() };
  await local.set({ 'notify:status': status });
  return status;
}

async function notify(list) {
  if (!list.length) return;
  const { 'notify:urls': urls = {} } = await local.get('notify:urls');
  if (list.length > 3) {
    const id = 'crp-many-' + Date.now();
    urls[id] = list[0].url.replace(/\/watch\/.*/, '/');
    chrome.notifications.create(id, {
      type: 'list', iconUrl: 'icons/icon128.png', title: `${list.length} episodios nuevos de lo que sigues`, message: '',
      items: list.slice(0, 5).map((x) => ({ title: x.title, message: x.line })), contextMessage: 'Crunchyroll+',
    });
  } else {
    for (const x of list) {
      const id = 'crp-' + x.id;
      urls[id] = x.url;
      chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title: `Nuevo: ${x.title}`, message: x.line, contextMessage: 'Crunchyroll+' });
    }
  }
  const keys = Object.keys(urls);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete urls[k]);
  await local.set({ 'notify:urls': urls });
}

async function test() {
  const { 'notify:urls': urls = {} } = await local.get('notify:urls');
  urls['crp-test'] = CR + '/';
  await local.set({ 'notify:urls': urls });
  chrome.notifications.create('crp-test', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Así se verán los avisos', message: 'Nuevo: Los diarios de la boticaria · T3 · E4 (castellano)', contextMessage: 'Crunchyroll+' });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const { 'notify:urls': urls = {} } = await local.get('notify:urls');
  if (urls[id]) chrome.tabs.create({ url: urls[id] });
  chrome.notifications.clear(id);
});
