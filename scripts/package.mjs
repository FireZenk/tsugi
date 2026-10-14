// Builds dist/tsugi-<version>.zip for the Chrome Web Store: only what the extension
// loads (manifest, _locales, icons, popup, src), after a few pre-flight checks.
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };

check(manifest.version === pkg.version, `manifest version ${manifest.version} != package.json ${pkg.version}`);
check(manifest.name.length <= 75, 'name longer than 75 characters');
for (const loc of readdirSync(join(root, '_locales'))) {
  const d = JSON.parse(readFileSync(join(root, '_locales', loc, 'messages.json'), 'utf8')).description.message;
  check(d.length <= 132, `_locales/${loc}: description is ${d.length} characters (max 132)`);
}
const referenced = [
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), manifest.action.default_popup,
  manifest.background.service_worker, ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ...manifest.web_accessible_resources.flatMap((w) => w.resources),
];
for (const f of referenced) check(existsSync(join(root, f)), `missing ${f}`);
check(!referenced.some((f) => f.startsWith('dev/') || f.startsWith('tests/')), 'manifest references dev/ or tests/');

if (problems.length) {
  console.error('Not packaged:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const out = join(root, 'dist', `tsugi-${manifest.version}.zip`);
mkdirSync(join(root, 'dist'), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, 'manifest.json', '_locales', 'icons', 'popup', 'src', '-x', '*.DS_Store'], { cwd: root });
const kb = Math.round(statSync(out).size / 1024);
console.log(`dist/tsugi-${manifest.version}.zip · ${kb} KB`);
