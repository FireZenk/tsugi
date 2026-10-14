const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./env');

// values created inside the sandbox have their own Array/Object prototypes
const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

const { CRP } = load(['src/core/util.js', 'src/core/i18n.js', 'src/core/model.js', 'src/core/tags.js', 'src/core/query.js']);
CRP.tags.setStudios(['MAPPA', 'Studio Pierrot', 'Kyoto Animation']);
const titles = [{ id: 'F', title: 'Frieren: Beyond Journey’s End' }, { id: 'B', title: 'The Apothecary Diaries' }];
const findTitle = (q) => titles.find((t) => CRP.util.norm(t.title).includes(CRP.util.norm(q)) && q.length > 2) || null;
const parse = (q) => CRP.query.parse(q, { dub: 'es-ES', findTitle, currentSeason: { id: 'fall-2026', title: 'Otoño 2026' } });
const labels = (q) => parse(q).chips.map((c) => c.label);

test('length, audio, like, rating', () => {
  const r = parse('corta, en castellano, como Frieren, nota 4.5');
  eq(labels('corta, en castellano, como Frieren, nota 4.5'), ['Corta (≤ 13 ep)', 'Audio castellano', 'Como Frieren: Beyond Journey’s End', '★ ≥ 4.5']);
  assert.strictEqual(r.F.len, 'short');
  eq(r.F.audio, ['es-ES']);
  assert.strictEqual(r.like.id, 'F');
  assert.strictEqual(r.F.ratingMin, 4.5);
  assert.strictEqual(r.rest, '');
});

test('"como X" stops at the title and leaves the rest', () => {
  const r = parse('como frieren sin ver');
  assert.strictEqual(r.like.id, 'F');
  assert.strictEqual(r.F.mine, 'unseen');
});

test('genre and theme negation chains', () => {
  const r = parse('sin romance ni comedia, isekai sin harén');
  eq([...r.F.genresOut].sort(), ['comedy', 'romance']);
  eq(r.F.tagsIn, ['Isekai']);
  eq(r.F.tagsOut, ['Female Harem']);
});

test('years, decades and ranges', () => {
  eq([parse('años 90').F.yearMin, parse('años 90').F.yearMax], [1990, 1999]);
  eq([parse('desde 2018 hasta 2022').F.yearMin, parse('desde 2018 hasta 2022').F.yearMax], [2018, 2022]);
  assert.strictEqual(parse('peliculas de 2023').F.yearMin, 2023);
  assert.strictEqual(parse('peliculas de 2023').F.len, 'movie');
});

test('studio, source and AniList score', () => {
  const r = parse('de mappa basado en novela ligera anilist 85');
  assert.strictEqual(r.F.studio, 'MAPPA');
  assert.strictEqual(r.F.source, 'LIGHT_NOVEL');
  assert.strictEqual(r.F.alMin, 85);
  assert.strictEqual(parse('animada por kyoani').F.studio, 'Kyoto Animation');
});

test('"tipo shonen" is a filter, not a title; unknown words become free text', () => {
  assert.strictEqual(parse('tipo shonen').like, null);
  eq(parse('tipo shonen').F.genresIn, ['shonen']);
  assert.strictEqual(parse('one piece').rest, 'one piece');
});

test('removing a chip removes its words', () => {
  const text = 'corta, en castellano, sin romance';
  const chip = parse(text).chips.find((c) => c.label === 'Audio castellano');
  assert.strictEqual(CRP.query.removeSpan(text, chip), 'corta, sin romance');
});
