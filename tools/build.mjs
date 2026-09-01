// Assembles an uploadable copy of the site in build/.
//
//   node tools/build.mjs
//
// Same game, two deployment-friendly changes:
//  - the web app manifest ships as manifest.json, because plenty of hosts
//    reject the .webmanifest extension (it is only a convention — the file is
//    JSON, and the <link rel="manifest"> is what actually matters)
//  - nothing outside build/ is referenced, so the folder can be uploaded as-is
//
// It finishes by listing every extension in the output, so you can check the
// build against a host's allowed-file-types list before uploading.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.argv[2] || 'build');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Directories that ship verbatim.
for (const dir of ['src', 'vendor', 'icons']) {
  cpSync(resolve(ROOT, dir), join(OUT, dir), { recursive: true });
}

// The manifest itself is unchanged — only its filename and the two references.
writeFileSync(join(OUT, 'manifest.json'), read('manifest.webmanifest'));
writeFileSync(join(OUT, 'index.html'), read('index.html').replace('manifest.webmanifest', 'manifest.json'));
writeFileSync(join(OUT, 'sw.js'), read('sw.js').replace("'manifest.webmanifest'", "'manifest.json'"));
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
