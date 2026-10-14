const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./env');

// values created inside the sandbox have their own Array/Object prototypes
const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

const { CRP } = load(['src/core/util.js', 'src/core/i18n.js', 'src/core/model.js', 'src/core/store.js', 'src/core/api.js', 'src/core/external.js']);
const { pick, linksTo } = CRP.ext._test;
const x = { id: 'G3KHEVDJ7', slug: 'the-apothecary-diaries', title: 'Los diarios de la boticaria', year: 2023, kind: 'series' };
const m = (o) => ({ id: 1, idMal: 10, title: { english: 'X', romaji: 'X' }, synonyms: [], averageScore: 80, popularity: 1000, startDate: { year: 2023 }, format: 'TV', externalLinks: [], ...o });

test('links match by Crunchyroll id or legacy slug, any host variant', () => {
  assert.ok(linksTo(m({ externalLinks: [{ url: 'https://www.crunchyroll.com/series/G3KHEVDJ7/the-apothecary-diaries' }] }), x));
  assert.ok(linksTo(m({ externalLinks: [{ url: 'http://crunchyroll.com/the-apothecary-diaries' }] }), x));
  assert.ok(!linksTo(m({ externalLinks: [{ url: 'https://www.crunchyroll.com/series/GOTHER/x' }] }), x));
});

test('several linked seasons average by popularity; earliest is the main id', () => {
  const e = pick(x, [
    m({ id: 2, idMal: 20, averageScore: 90, popularity: 3000, startDate: { year: 2025 }, externalLinks: [{ url: 'https://www.crunchyroll.com/series/G3KHEVDJ7' }] }),
    m({ id: 1, idMal: 10, averageScore: 80, popularity: 1000, startDate: { year: 2023 }, externalLinks: [{ url: 'https://www.crunchyroll.com/series/G3KHEVDJ7' }] }),
  ]);
  assert.strictEqual(e.c, 'id');
  assert.strictEqual(e.al, 1);
  assert.strictEqual(e.s, 88);
  eq(e.ids, [2, 1]);
});

test('title fallback needs the same name; year must agree unless unique', () => {
  const y = { ...x, slug: 'digimon-savers', title: 'Digimon Savers', year: 2024 };
  assert.strictEqual(pick(y, [m({ title: { english: 'Digimon Data Squad', romaji: 'Digimon Savers' }, startDate: { year: 2006 } })]).c, 'title');
  assert.strictEqual(pick(y, [m({ title: { english: 'Something else', romaji: 'Other' } })]), null);
  const two = pick({ ...y, year: 2011 }, [
    m({ id: 5, title: { english: 'Digimon Savers', romaji: '' }, startDate: { year: 1999 } }),
    m({ id: 6, title: { english: 'Digimon Savers', romaji: '' }, startDate: { year: 2011 } }),
  ]);
  assert.strictEqual(two.al, 6);
});
