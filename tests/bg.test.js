// Background worker: release notifications and MAL list import, with mocked chrome/fetch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function boot() {
  const store = { local: {}, sync: { settings: { enabled: true, notify: true } } };
  const area = (n) => ({ async get(k) { const o = {}; [].concat(k).forEach((x) => { if (x in store[n]) o[x] = store[n][x]; }); return o; }, async set(o) { Object.assign(store[n], o); } });
  const notes = [];
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const net = { feed: [], failCR: false, mal: null };
  const sandbox = {
    console, setTimeout, URL, Date, JSON, Map, Set, Promise, Math,
    btoa: (s) => Buffer.from(s).toString('base64'),
    navigator: { language: 'es-ES' },
    importScripts: (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), sandbox)),
    chrome: {
      storage: { local: area('local'), sync: area('sync') },
      runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message') },
      alarms: { create() {}, onAlarm: on('alarm') },
      notifications: { create: (id, o) => notes.push({ id, title: o.title, message: o.message }), clear() {}, onClicked: on('click') },
      tabs: { create() {} },
    },
    fetch: async (url) => {
      if (net.mal) return net.mal(String(url));
      if (net.failCR) return { ok: false, status: 403, json: async () => ({}) };
      if (String(url).includes('/auth/v1/token')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
      return { ok: true, json: async () => ({ data: net.feed }) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/bg.js'), 'utf8'), sandbox);
  return { sandbox, store, notes, listeners, net };
}
const ep = (id, series, audio, agoMs = 3600e3) => ({
  id, title: 'Ep ' + id, slug_title: 'ep',
  episode_metadata: { series_id: series, series_title: 'Serie ' + series, season_number: 1, episode_number: 5, audio_locale: audio, premium_available_date: new Date(Date.now() - agoMs).toISOString() },
});

test('first poll learns; later polls notify in the followed audio only', async () => {
  const b = boot();
  b.store.local['notify:watch'] = { locale: 'es-ES', prefix: '/es-es', items: [{ id: 'A', title: 'A', audios: ['ja-JP'] }, { id: 'B', title: 'B', audios: ['es-ES'] }] };
  b.net.feed = [ep('e1', 'A', 'ja-JP')];
  const s1 = await b.sandbox.poll();
  assert.strictEqual(s1.firstRun, true);
  assert.strictEqual(b.notes.length, 0);
  b.net.feed = [ep('e1', 'A', 'ja-JP'), ep('e2', 'A', 'ja-JP'), ep('e3', 'B', 'ja-JP'), ep('e4', 'B', 'es-ES'), ep('e5', 'A', 'ja-JP', -3600e3), ep('e6', 'Z', 'ja-JP')];
  await b.sandbox.poll();
  assert.deepStrictEqual(b.notes.map((n) => n.id), ['crp-e2', 'crp-e4']);
  assert.match(b.notes[1].message, /castellano/);
});

test('falls back to AniList airing times when Crunchyroll is unreachable', async () => {
  const b = boot();
  b.store.local['notify:watch'] = { items: [{ id: 'C', title: 'C', audios: ['ja-JP'], nx: { at: Date.now() - 2 * 3600e3, ep: 7 } }] };
  b.store.local['notify:seen'] = ['x'];
  b.net.failCR = true;
  const s = await b.sandbox.poll();
  assert.strictEqual(s.mode, 'anilist');
  assert.strictEqual(b.notes.length, 1);
  await b.sandbox.poll();
  assert.strictEqual(b.notes.length, 1, 'no repeat for the same episode');
});

test('disabled notifications skip polling', async () => {
  const b = boot();
  b.store.sync.settings.notify = false;
  b.store.local['notify:watch'] = { items: [{ id: 'A' }] };
  assert.strictEqual((await b.sandbox.poll()).skipped, true);
});

test('MAL list import pages through 300-item pages', async () => {
  const b = boot();
  b.net.mal = (url) => ({ ok: true, status: 200, json: async () => (url.includes('offset=0') ? Array.from({ length: 300 }, (_, i) => ({ anime_id: i, score: 7, status: 2 })) : [{ anime_id: 999, score: 9, status: 1 }]) });
  const r = await new Promise((res) => b.listeners.message({ type: 'mal-list', user: 'x' }, null, res));
  assert.strictEqual(r.items.length, 301);
});
