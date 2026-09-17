// Assembles an uploadable copy of the site in build/.
//
//   node tools/build.mjs [outDir] [--js-models]
//
// Same game, deployment-friendly changes:
//  - the web app manifest ships as manifest.json, because plenty of hosts
//    reject the .webmanifest extension (it is only a convention — the file is
//    JSON, and the <link rel="manifest"> is what actually matters)
//  - with --js-models, the .glb models ship as .js instead: one script per
//    model that assigns its bytes (base64) into window.__BR_MODELS__, which is
//    the same hand-off the single-file bundle uses. For hosts that reject .glb
//    uploads — costs ~33% on those files and nothing else changes.
//  - nothing outside build/ is referenced, so the folder can be uploaded as-is
//
// It finishes by listing every extension in the output, so you can check the
// build against a host's allowed-file-types list before uploading.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const JS_MODELS = args.includes('--js-models');
const OUT = resolve(ROOT, args.find((a) => !a.startsWith('--')) || 'build');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Directories that ship verbatim (the models are re-emitted below when they
// are not allowed to travel as .glb).
for (const dir of ['src', 'vendor', 'icons', 'assets/models', 'assets/liveries']) {
  if (dir === 'assets/models' && JS_MODELS) continue;
  if (existsSync(resolve(ROOT, dir))) cpSync(resolve(ROOT, dir), join(OUT, dir), { recursive: true });
}

let html = read('index.html').replace('manifest.webmanifest', 'manifest.json');
let sw = read('sw.js').replace("'manifest.webmanifest'", "'manifest.json'");

if (JS_MODELS) {
  // Each model becomes a classic script that hands its bytes to the loader the
  // same way the single-file bundle does. Deferred classic scripts run in
  // document order before the deferred module, so __BR_MODELS__ is populated
  // by the time main.js asks for it.
  const dir = resolve(ROOT, 'assets/models');
  const names = readdirSync(dir).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();
  mkdirSync(join(OUT, 'assets/models'), { recursive: true });
  for (const name of names) {
    const b64 = readFileSync(join(dir, `${name}.glb`)).toString('base64');
    writeFileSync(join(OUT, 'assets/models', `${name}.js`),
      `(window.__BR_MODELS__ = window.__BR_MODELS__ || {})[${JSON.stringify(name)}] = ${JSON.stringify(b64)};\n`);
  }
  const tags = names.map((n) => `  <script defer src="assets/models/${n}.js"></script>`).join('\n');
  const anchor = '  <script type="module" src="src/main.js"></script>';
  if (!html.includes(anchor)) throw new Error('index.html: could not find the main module script tag');
  html = html.replace(anchor, `${tags}\n${anchor}`);
  // Precache the scripts rather than the .glb files they replace.
  for (const name of names) {
    sw = sw.replace(`'assets/models/${name}.glb'`, `'assets/models/${name}.js'`);
  }
  if (sw.includes('.glb')) throw new Error('sw.js: a .glb entry survived the rewrite');
}

// The manifest itself is unchanged — only its filename and the two references.
writeFileSync(join(OUT, 'manifest.json'), read('manifest.webmanifest'));
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(join(OUT, 'sw.js'), sw);
writeFileSync(join(OUT, 'styles.css'), read('styles.css'));

// Report what came out, so the extension list can be checked before uploading.
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(OUT);

const byExt = new Map();
let bytes = 0;
for (const f of files) {
  const ext = extname(f) || '(no extension)';
  byExt.set(ext, (byExt.get(ext) || 0) + 1);
  bytes += statSync(f).size;
}

console.log(`built ${relative(ROOT, OUT)}/ — ${files.length} files, ${(bytes / 1048576).toFixed(2)} MB`);
console.log('file types:', [...byExt.entries()].map(([e, n]) => `${e} x${n}`).join(', '));
const stray = files.filter((f) => f.endsWith('.webmanifest'));
console.log(stray.length ? `WARNING: .webmanifest still present: ${stray}` : 'no .webmanifest in output ✓');
if (JS_MODELS) {
  const glb = files.filter((f) => f.endsWith('.glb'));
  console.log(glb.length ? `WARNING: .glb still present: ${glb}` : 'no .glb in output ✓');
}
