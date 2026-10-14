const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./env');

const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

const now = Date.now();
const item = (id, eps, title) => ({
  id, kind: 'series', title, slug: title.toLowerCase(), description: '', poster: null, wide: null, rating: 4.5, votes: 1000, quality: 4.5,
  genres: [], episodes: eps, seasons: 1, year: 2020, dubbed: false, subbed: true, simulcast: false, mature: false, maturity: 'TV-14',
  audio: ['ja-JP'], subs: [], dist: null, lastPublic: new Date(now - 400 * 86400000).toISOString(), pop: 0, tags: [],
});
// A: long, filler known (10 of 50) · B: long, MAL known but not fetched · C: short, unknown · D: long, no MAL link
const items = [item('A', 50, 'Larga Con Relleno'), item('B', 60, 'Larga Sin Datos'), item('C', 12, 'Corta'), item('D', 80, 'Larga Sin Mal')];
const snap = { v: 3, ts: now, locale: 'es-ES', total: items.length, tags: [], items };
const ext = { A: { s: 80, u: 1000, mal: 101, status: 'FINISHED' }, B: { s: 70, u: 500, mal: 202 }, C: { s: 75, u: 100, mal: 303 } };
const filler = { 101: { t: 50, f: [10, 11, 12, 13, 14, 30, 31, 32, 33, 40], r: [25], ts: now, done: true } };

const env = load(['src/core/util.js', 'src/core/i18n.js', 'src/core/model.js', 'src/core/store.js', 'src/core/api.js', 'src/core/external.js', 'src/core/filler.js', 'src/core/tags.js', 'src/core/catalog.js'],
  { storage: { 'catalog:es-ES': snap, 'ext:anilist:v1': ext, 'filler:v1': filler } });
const { CRP } = env;
const ready = Promise.all([CRP.catalog.load(), CRP.ext.load(), CRP.filler.load()]);

test('ranges compress episode lists', () => {
  eq(CRP.filler._test.ranges([7, 1, 2, 3, 9, 10]), [[1, 3], [7, 7], [9, 10]]);
  assert.strictEqual(CRP.filler.fmtRanges([[1, 3], [7, 7]]), '1–3, 7');
});

test('summary, episode kind and share come from the MAL entry linked through AniList', async () => {
  await ready;
  const s = CRP.filler.summary('A');
  eq([s.total, s.filler, s.recap, s.share], [50, 10, 1, 0.2]);
  eq(s.fillerRanges, [[10, 14], [30, 33], [40, 40]]);
  eq(['A', 'A', 'A', 'A'].map((id, i) => CRP.filler.kindOf(id, [12, 25, 26, 99][i])), ['filler', 'recap', null, null]);
  assert.strictEqual(CRP.filler.share('B'), null);
  assert.strictEqual(CRP.filler.kindOf('D', 3), null);
});

test('"little filler" keeps known-low and unknown short series, drops long ones not checked yet', async () => {
  await ready;
  const ids = (F) => CRP.catalog.query({ audio: [], genresIn: [], genresOut: [], tagsIn: [], tagsOut: [], ...F }, null, 'alpha').map((x) => x.id);
  eq(ids({ fillerMax: 0.1 }), ['C', 'D']);
  eq(ids({ fillerMax: 0.25 }), ['C', 'A', 'D']);
});

test('Jikan episodes are read page by page', async () => {
  await ready;
  const calls = [];
  env.sandbox.fetch = async (url) => {
    calls.push(String(url));
    const page = +new URL(url).searchParams.get('page');
    const from = (page - 1) * 100 + 1;
    const to = Math.min(130, page * 100);
    const data = [];
    for (let n = from; n <= to; n++) data.push({ mal_id: n, filler: n > 120, recap: n === 50 });
    return { ok: true, status: 200, json: async () => ({ pagination: { has_next_page: to < 130 }, data }) };
  };
  const r = await CRP.filler._test.fetchMal(303, false);
  eq([r.t, r.f.length, r.r, calls.length], [130, 10, [50], 2]);
  assert.strictEqual(CRP.filler.share('C'), 10 / 130);
});

test('the parser understands "sin relleno" / "little filler" in every language', () => {
  const p = load(['src/core/util.js', 'src/core/i18n.js', 'src/i18n/en.js', 'src/i18n/de.js', 'src/i18n/fr.js', 'src/i18n/it.js', 'src/core/model.js', 'src/core/tags.js', 'src/core/query.js']).CRP;
  const cases = [['es', 'shonen sin relleno', 0], ['es', 'poco relleno', 0.1], ['en', 'no filler shonen', 0], ['de', 'wenig filler', 0.1], ['fr', 'sans filler', 0], ['it', 'poco filler', 0.1]];
  for (const [lang, q, max] of cases) {
    p.i18n.setLang(lang);
    const r = p.query.parse(q, { dub: 'es-ES' });
    assert.strictEqual(r.F.fillerMax, max, `${lang}: ${q}`);
  }
});
