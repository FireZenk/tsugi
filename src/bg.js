// Background service worker.
//  1. Release notifications: every 15 min, read Crunchyroll's "newly added" episodes
//     (public data, anonymous token, no user cookies) and notify about series in the
//     follow list that the home page keeps up to date (notify:watch), in the audio the
//     user watches them in. If Crunchyroll can't be reached from here, fall back to
//     AniList's airing times ("should be on Crunchyroll by now").
//  2. MyAnimeList list import: myanimelist.net has no CORS, so the page asks us.

// UI strings: same dictionaries as the pages (language from settings or the site's)
importScripts('core/i18n.js', 'i18n/en.js', 'i18n/es-419.js', 'i18n/it.js', 'i18n/de.js', 'i18n/fr.js');

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
    if (!res.ok) throw new Error(t('MyAnimeList respondió {n}', { n: res.status }));
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
  return { enabled: s.enabled !== false, notify: s.notify !== false, uiLang: s.uiLang || 'auto', noSpoilers: !!s.noSpoilers };
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
  const bearer = await anonToken();
  const res = await fetch(`${CR}/content/v2/discover/browse?type=episode&sort_by=newly_added&n=100&locale=${locale}`, {
    credentials: 'omit', headers: { Authorization: 'Bearer ' + bearer },
  });
  if (!res.ok) throw Object.assign(new Error('browse ' + res.status), { status: res.status });
  return (await res.json()).data || [];
}

// audio suffix for the notification line ("· T3 · E4 (castellano)"); none for Japanese
const LANG = { 'es-ES': 'Castellano', 'es-419': 'Latino', 'en-US': 'Inglés', 'pt-BR': 'Portugués (BR)', 'fr-FR': 'Francés', 'de-DE': 'Alemán', 'it-IT': 'Italiano' };
const langSuffix = (code) => {
  if (!LANG[code]) return '';
  const name = t(LANG[code]);
  return ` (${['en', 'de'].includes(CRP.i18n.current()) ? name : name.charAt(0).toLowerCase() + name.slice(1)})`;
};
const epLine = (season, ep, title) => `${t('T{n}', { n: season })} · ${t('E{n}', { n: ep })}${title ? ' — ' + title : ''}`;

async function useLanguage(st, watch) {
  CRP.i18n.setLang(st.uiLang !== 'auto' ? st.uiLang : CRP.i18n.fromLocale(watch && watch.locale));
}

async function poll(force = false) {
  const st = await settings();
  const { 'notify:watch': watch, 'notify:seen': seenArr = [] } = await local.get(['notify:watch', 'notify:seen']);
  await useLanguage(st, watch);
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
        line: epLine(m.season_number || 1, m.episode_number ?? '?', st.noSpoilers ? null : e.title) + langSuffix(m.audio_locale),
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
      fresh.push({ id: key, title: f.title, line: t('Episodio {n}: debería estar ya en Crunchyroll', { n: f.nx.ep }), url: `${CR}${watch.prefix || ''}/series/${f.id}` });
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
      type: 'list', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: t('{n} episodios nuevos de lo que sigues', { n: list.length }), message: '',
      items: list.slice(0, 5).map((x) => ({ title: x.title, message: x.line })), contextMessage: 'Crunchyroll+',
    });
  } else {
    for (const x of list) {
      const id = 'crp-' + x.id;
      urls[id] = x.url;
      chrome.notifications.create(id, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: t('Nuevo: {title}', { title: x.title }), message: x.line, contextMessage: 'Crunchyroll+' });
    }
  }
  const keys = Object.keys(urls);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete urls[k]);
  await local.set({ 'notify:urls': urls });
}

async function test() {
  const { 'notify:urls': urls = {}, 'notify:watch': watch } = await local.get(['notify:urls', 'notify:watch']);
  await useLanguage(await settings(), watch);
  urls['crp-test'] = CR + '/';
  await local.set({ 'notify:urls': urls });
  const message = `${t('Nuevo: {title}', { title: t('Los diarios de la boticaria') })} · ${epLine(3, 4)}${langSuffix('es-ES')}`;
  chrome.notifications.create('crp-test', { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: t('Así se verán los avisos'), message, contextMessage: 'Crunchyroll+' });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const { 'notify:urls': urls = {} } = await local.get('notify:urls');
  if (urls[id]) chrome.tabs.create({ url: urls[id] });
  chrome.notifications.clear(id);
});
