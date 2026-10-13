// Loads the extension's content-script modules into a sandbox with just enough
// browser/chrome stubs for pure logic tests (no DOM rendering).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function load(files, { pathname = '/es-es/', storage = {} } = {}) {
  const mem = { sync: {}, local: { ...storage } };
  const area = (n) => ({
    async get(k) { if (k == null) return { ...mem[n] }; const o = {}; [].concat(k).forEach((x) => { if (x in mem[n]) o[x] = mem[n][x]; }); return o; },
    async set(o) { Object.assign(mem[n], o); },
    async remove(ks) { [].concat(ks).forEach((k) => delete mem[n][k]); },
  });
  const sandbox = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Map, Set, Promise, JSON, Math, Date,
    location: { pathname, href: 'https://www.crunchyroll.com' + pathname, origin: 'https://www.crunchyroll.com' },
    document: { cookie: '' },
    navigator: { userAgent: 'node' },
    window: { devicePixelRatio: 1, addEventListener() {} },
    chrome: { storage: { sync: area('sync'), local: area('local'), onChanged: { addListener() {} } }, runtime: { getManifest: () => ({ version: 'test' }) } },
    fetch: async () => { throw new Error('network disabled in tests'); },
    btoa: (s) => Buffer.from(s).toString('base64'),
    performance: { now: () => Date.now() },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return { CRP: sandbox.CRP, sandbox, mem };
}

module.exports = { load, ROOT };
