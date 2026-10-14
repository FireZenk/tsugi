const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./env');

// values created inside the sandbox have their own Array/Object prototypes
const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

// A tiny catalog snapshot, stored where catalog.load() looks for it.
const now = Date.now();
const item = (id, o) => ({
  id, kind: 'series', title: o.title, slug: o.title.toLowerCase().replace(/\s+/g, '-'), description: o.desc || '',
  poster: null, wide: null, rating: o.rating ?? 4.5, votes: o.votes ?? 1000, quality: o.quality ?? 4.5,
  genres: o.genres || [], episodes: o.eps ?? 12, seasons: 1, year: o.year ?? 2020, dubbed: false, subbed: true,
  simulcast: false, mature: false, maturity: 'TV-14', audio: o.audio || ['ja-JP'], subs: [], dist: null,
  lastPublic: new Date(now - (o.days ?? 400) * 86400000).toISOString(), pop: o.pop ?? 0, tags: o.tags || [],
});
const items = [
  item('A', { title: 'Frieren', genres: ['fantasy', 'drama'], eps: 28, audio: ['ja-JP', 'es-ES'], pop: 0, quality: 4.8 }),
  item('B', { title: 'Boticaria', genres: ['drama', 'romance'], eps: 24, days: 3, pop: 1, quality: 4.7 }),
  item('C', { title: 'Corta Comedia', genres: ['comedy'], eps: 12, audio: ['ja-JP', 'es-419'], pop: 2, quality: 4.2, year: 2025 }),
  item('D', { title: 'Peli Mecha', genres: ['sci-fi'], eps: 1, pop: 3 }),
  item('E', { title: 'Joya Rara', genres: ['drama'], eps: 13, pop: 4, quality: 4.75, votes: 400 }),
];
items[3].kind = 'movie_listing';
const snap = { v: 3, ts: now, locale: 'es-ES', total: items.length, tags: [{ id: 'fall-2026', title: 'Otoño 2026' }], items };

const env = load(['src/core/util.js', 'src/core/model.js', 'src/core/store.js', 'src/core/api.js', 'src/core/external.js', 'src/core/tags.js', 'src/core/catalog.js'],
  { storage: { 'catalog:es-ES': snap } });
const { CRP } = env;
const ctx = { hasWatched: (id) => id === 'A', inWatchlist: (id) => id === 'B', seriesStats: () => new Map([['A', { eps: 3 }]]) };

test('filters by length, audio, genres (include/exclude), status, mine', async () => {
  await CRP.catalog.load();
  const ids = (F, sort = 'popular') => CRP.catalog.query({ audio: [], genresIn: [], genresOut: [], tagsIn: [], tagsOut: [], ...F }, ctx, sort).map((x) => x.id);
  eq(ids({ len: 'short' }), ['C', 'E']);
  eq(ids({ len: 'movie' }), ['D']);
  eq(ids({ audio: ['es-ES'] }), ['A']);
  eq(ids({ genresIn: ['drama'], genresOut: ['romance'] }), ['A', 'E']);
  eq(ids({ status: 'airing' }), ['B']);
  eq(ids({ mine: 'unseen' }), ['B', 'C', 'D', 'E']);
  eq(ids({ text: 'joya' }), ['E']);
});

test('facet counts ignore their own group', async () => {
  await CRP.catalog.load();
  const F = { audio: [], genresIn: ['drama'], genresOut: [], tagsIn: [], tagsOut: [], len: 'short' };
  const c = CRP.catalog.counts(F, ctx, 'len', [{ id: 'short', patch: { len: 'short' } }, { id: 'mid', patch: { len: 'mid' } }]);
  eq(c, { short: 1, mid: 1 });
});

test('findTitle prefers exact and needs every word', async () => {
  await CRP.catalog.load();
  assert.strictEqual(CRP.catalog.findTitle('frieren').id, 'A');
  assert.strictEqual(CRP.catalog.findTitle('frieren corta'), null);
});
