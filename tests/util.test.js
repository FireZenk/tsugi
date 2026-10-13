const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./env');

const { CRP } = load(['src/core/util.js']);
const U = CRP.util;

test('home route: root, any language prefix, and /discover', () => {
  for (const p of ['/', '/es-es', '/es-es/', '/fr/', '/zh-tw/discover', '/discover', '/pt-br/discover/']) assert.ok(U.isHomePath(p), p);
  for (const p of ['/es-es/series/G1/x', '/watchlist', '/es-es/discovery', '/didiscover', '/fr/watch/G1']) assert.ok(!U.isHomePath(p), p);
});

test('content locale per site prefix', () => {
  const cases = { '/': 'en-US', '/es/': 'es-419', '/es-es/': 'es-ES', '/pt-pt/x': 'pt-PT', '/zh-tw/': 'zh-TW', '/ko/discover': 'ko-KR', '/ja/': 'ja-JP' };
  for (const [p, loc] of Object.entries(cases)) assert.strictEqual(U.contentLocale(p), loc, p);
});

test('normalize and format helpers', () => {
  assert.strictEqual(U.norm('Fantasía Ñoña'), 'fantasia nona');
  assert.strictEqual(U.fmtMinutes(70), '1 h 10 min');
  assert.strictEqual(U.fmtMinutes(45), '45 min');
});
