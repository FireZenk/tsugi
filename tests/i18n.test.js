const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./env');

const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

const DICTS = ['src/i18n/en.js', 'src/i18n/es-419.js', 'src/i18n/it.js', 'src/i18n/de.js', 'src/i18n/fr.js'];
const { CRP } = load(['src/core/util.js', 'src/core/i18n.js', ...DICTS, 'src/core/model.js', 'src/core/tags.js', 'src/core/query.js']);
const I = CRP.i18n;
const t = (k, v) => I.t(k, v);

// Every key the code can ask for: t('…') / tr('…') literals plus the tables of labels.
function usedKeys() {
  const keys = new Set();
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const files = walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}i18n${path.sep}`)).concat(path.join(ROOT, 'popup/popup.js'));
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:t|tr)\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
  }
  CRP.tags.THEMES.forEach(([, label]) => keys.add(label));
  Object.values(CRP.tags.SOURCES).forEach((s) => keys.add(s));
  Object.values(CRP.util.LANGS).forEach((s) => keys.add(s));
  I.setLang('es');
  CRP.model.allGenres().forEach((g) => keys.add(g.title));
  for (const m of fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8').matchAll(/data-i18n>([^<]+)</g)) keys.add(m[1].trim());
  return [...keys];
}

test('lookup: Spanish is the key, others translate, es-419 overrides, English is the fallback', () => {
  I.setLang('es');
  assert.strictEqual(t('Ajustes'), 'Ajustes');
  assert.strictEqual(t('Quedan {n} min', { n: 5 }), 'Quedan 5 min');
  I.setLang('es-419');
  assert.strictEqual(t('Ajustes'), 'Configuración');
  assert.strictEqual(t('Mi lista'), 'Mi lista');
  I.setLang('de');
  assert.strictEqual(t('Quedan {n} min', { n: 5 }), 'Noch 5 Min.');
  assert.strictEqual(t('una clave que no existe'), 'una clave que no existe');
  I.add('en', { 'solo en inglés': 'English only' });
  assert.strictEqual(t('solo en inglés'), 'English only');
  assert.strictEqual(I.fromLocale('es-419'), 'es-419');
  assert.strictEqual(I.fromLocale('es-ES'), 'es');
  assert.strictEqual(I.fromLocale('pt-BR'), 'en');
  assert.strictEqual(I.fromLocale('fr-FR'), 'fr');
});

test('en, it, de and fr translate every key, with the same placeholders', () => {
  const keys = usedKeys();
  assert.ok(keys.length > 500, `only ${keys.length} keys found`);
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const l of ['en', 'it', 'de', 'fr']) {
    const missing = keys.filter((k) => I.dicts[l][k] == null);
    eq(missing, [], `${l} is missing translations`);
    const bad = keys.filter((k) => ph(k) !== ph(I.dicts[l][k]));
    eq(bad, [], `${l} placeholders differ`);
  }
  for (const [k, v] of Object.entries(I.dicts['es-419'])) assert.strictEqual(ph(k), ph(v), `es-419: ${k}`);
});

// The canned searches (moods, quick searches, examples) are translated text the parser
// must understand exactly like the Spanish original: same filters, nothing left over.
const titles = [{ id: 'F', title: 'Frieren: Beyond Journey’s End' }];
const findTitle = (q) => titles.find((x) => CRP.util.norm(x.title).includes(CRP.util.norm(q)) && q.length > 2) || null;
CRP.tags.setStudios(['MAPPA']);
const QUERIES = [
  'comedia sin tragedia ni gore sin ver', 'accion aventura buenas sin ver', 'drama tragedia sin ver', 'psicologico sin ver',
  'misterio sin ver', 'romance sin tragedia sin ver', 'relajante sin ver', 'supervivencia sin ver', 'isekai sin ver',
  'anilist 85 sin ver', 'joyas ocultas sin ver', 'terminadas buenas sin ver', 'como {title} sin ver', 'esta temporada buenas',
  'peliculas nota 4.5', 'clasicas muy buenas', 'en emision {audio}', 'cortas {audio} buenas sin ver', 'sin romance ni comedia buenas',
  'en mi lista sin ver', 'corta, en castellano, como Frieren', 'isekai corto en castellano, sin harén, de mappa', 'isekai corto en castellano, sin harén',
];
function parsed(lang, key) {
  I.setLang(lang);
  const text = t(key, { title: 'Frieren', audio: CRP.query.audioWords('es-ES') });
  const r = CRP.query.parse(text, { dub: 'es-ES', findTitle, currentSeason: { id: 'fall-2026', title: 'Otoño 2026' } });
  const F = { ...r.F };
  for (const k of ['genresIn', 'genresOut', 'tagsIn', 'tagsOut', 'audio']) F[k] = [...F[k]].sort();
  return { text, F, sort: r.sort, like: r.like && r.like.id, rest: r.rest };
}

for (const lang of ['en', 'it', 'de', 'fr', 'es-419']) {
  test(`canned searches parse the same in ${lang}`, () => {
    for (const q of QUERIES) {
      const want = parsed('es', q);
      const got = parsed(lang, q);
      assert.strictEqual(got.rest, '', `${lang} «${got.text}» left “${got.rest}”`);
      // es-419 examples say "latino" instead of "castellano" on purpose
      if (lang === 'es-419' && /castellano/.test(q)) { want.F.audio = ['es-419']; }
      eq({ F: got.F, sort: got.sort, like: got.like }, { F: want.F, sort: want.sort, like: want.like }, `${lang} «${got.text}» vs «${want.text}»`);
    }
  });
}

test('the UI language adds its own words to the parser', () => {
  I.setLang('de');
  const r = CRP.query.parse('kurz, synchronisiert, ohne romantik noch komödie, zeitreise', { dub: 'de-DE' });
  assert.strictEqual(r.F.len, 'short');
  eq(r.F.audio, ['de-DE']);
  eq([...r.F.genresOut].sort(), ['comedy', 'romance']);
  eq(r.F.tagsIn, ['Time Manipulation']);
  eq(r.chips.map((c) => c.label), ['Kurz (≤ 13 F.)', 'Synchro: Deutsch', 'Ohne Romantik', 'Ohne Komödie', 'Zeitreise']);
  I.setLang('fr');
  const f = CRP.query.parse('courte, en VF, sans harem, terminée', { dub: 'fr-FR' });
  eq([f.F.len, f.F.audio, f.F.tagsOut, f.F.status, f.rest], ['short', ['fr-FR'], ['Female Harem'], 'finished', '']);
  I.setLang('es');
});
