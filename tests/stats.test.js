const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./env');

const { CRP } = load(['src/core/util.js', 'src/core/i18n.js', 'src/core/model.js', 'src/core/store.js', 'src/core/api.js', 'src/core/stats.js']);
const at = (y, m, d, h = 21) => new Date(y, m - 1, d, h).getTime();
const e = (s, t, min, fw = 1) => ({ t, s, st: 'Serie ' + s, id: s + t, sec: min * 60, fw, a: 'ja-JP' });

test('totals, streak, favourites and started/finished series per year', () => {
  const list = [
    e('A', at(2025, 12, 30), 24), e('A', at(2026, 1, 1), 24), e('A', at(2026, 1, 2), 24), e('A', at(2026, 1, 3), 24),
    e('B', at(2026, 3, 10, 9), 48), e('B', at(2026, 3, 12, 22), 24),
  ];
  const s = CRP.stats.compute(list, CRP.stats.yearRange(2026), { episodesOf: (id) => (id === 'A' ? 4 : 12), genresOf: (id) => (id === 'A' ? ['action'] : ['drama']) });
  assert.strictEqual(s.minutes, 24 * 3 + 72);
  assert.strictEqual(s.episodes, 5);
  assert.strictEqual(s.activeDays, 5);
  assert.strictEqual(s.streak.days, 3);
  assert.strictEqual(s.topSeries[0].id, 'A');
  assert.deepStrictEqual(s.started.map((x) => x.id), ['B']);          // A began in 2025
  assert.deepStrictEqual(s.finished.map((x) => x.id), ['A']);          // 4 of 4 episodes
  assert.strictEqual(s.busiestMonth[0], '2026-03');
  assert.strictEqual(s.topGenres[0].id, 'drama');
  assert.deepStrictEqual(CRP.stats.years(list).map(Number), [2026, 2025]);
});
