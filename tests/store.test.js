// Chrome Web Store limits and release consistency (also checked by `npm run package`).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./env');

test('manifest and listing fit the Web Store limits', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(m.version, pkg.version, 'manifest and package.json versions differ');
  assert.ok(m.name.length <= 75 && m.short_name.length <= 12);
  for (const loc of fs.readdirSync(path.join(ROOT, '_locales'))) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', loc, 'messages.json'), 'utf8')).description.message;
    assert.ok(d.length <= 132, `${loc}: ${d.length} characters`);
  }
  for (const f of Object.values(m.icons)) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});
