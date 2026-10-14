// Every script the extension loads must at least parse (UI files have no other tests).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./env');

test('all extension scripts parse', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const files = new Set([...m.content_scripts.flatMap((c) => c.js || []), m.background.service_worker, 'popup/popup.js']);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }), `${f} does not parse`);
  }
});
