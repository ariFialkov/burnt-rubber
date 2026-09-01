// Bundles the game into one self-contained HTML file (no network, no modules)
// for hosting anywhere a single page can go. Each module keeps its own scope
// via a tiny registry, because three.js defines top-level names (clamp, lerp,
// smoothstep) that would otherwise collide with ours.
//
//   node tools/bundle.mjs [outfile]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || resolve(ROOT, 'dist/burnt-rubber.html');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// --- three.js: strip the single `export { ... }` and expose a namespace ------
function threeModule() {
  const src = read('vendor/three.module.js');
  const m = src.match(/^export \{([\s\S]*?)\};\s*$/m);
  if (!m) throw new Error('three.js export block not found');
  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const parts = s.split(/\s+as\s+/);
    return { local: parts[0], exported: parts[1] || parts[0] };
  });
  const body = src.slice(0, m.index);
  const ns = names.map((n) => `${JSON.stringify(n.exported)}: ${n.local}`).join(', ');
  return `__def('three', function (__x) {\n${body}\nObject.assign(__x, { ${ns} });\n});`;
}

// --- our modules: rewrite import/export into registry calls ------------------
const KEY = (p) => relative(resolve(ROOT, 'src'), resolve(ROOT, p)).replace(/\\/g, '/');

function transform(file) {
  let src = read(file);
  const dir = dirname(resolve(ROOT, file));
  const deps = [];
  const exported = new Set();

  // The bundle is a single file, so there is no sw.js to register.
  src = src.replace(/if \('serviceWorker' in navigator[\s\S]*?\n\}\n/, '');

  // import * as NS from 'three'
  src = src.replace(/import \* as (\w+) from ['"]three['"];?/g, (_, ns) => {
    deps.push('three');
    return `const ${ns} = __req('three');`;
  });

  // import { a, b as c } from './x.js'
  src = src.replace(/import \{([\s\S]*?)\} from ['"](\.[^'"]+)['"];?/g, (_, names, spec) => {
    const key = KEY(resolve(dir, spec));
    deps.push(key);
    const binds = names.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const p = s.split(/\s+as\s+/); return p[1] ? `${p[0]}: ${p[1]}` : p[0]; })
      .join(', ');
    return `const { ${binds} } = __req(${JSON.stringify(key)});`;
  });

  // side-effect import
  src = src.replace(/import ['"](\.[^'"]+)['"];?/g, (_, spec) => {
    const key = KEY(resolve(dir, spec));
    deps.push(key);
    return `__req(${JSON.stringify(key)});`;
  });

  // export declarations
  src = src.replace(/^export\s+(async\s+)?(function|class|const|let|var)\s+(\w+)/gm, (m0, a, kind, name) => {
    exported.add(name);
    return `${a || ''}${kind} ${name}`;
  });
  if (/^export\b/m.test(src)) throw new Error(`unhandled export form in ${file}`);

  const assign = exported.size
    ? `\nObject.assign(__x, { ${[...exported].join(', ')} });`
    : '';
  return { key: KEY(file), deps: [...new Set(deps)], code: `__def(${JSON.stringify(KEY(file))}, function (__x, __req) {\n${src}${assign}\n});` };
}

const FILES = [
  'src/core/rng.js', 'src/data/names.js', 'src/data/tours.js', 'src/data/racers.js',
  'src/engine/schedule.js', 'src/engine/odds.js', 'src/engine/script.js', 'src/engine/bets.js',
  'src/three/trackGen.js', 'src/three/carFactory.js', 'src/three/scene.js', 'src/three/cameras.js',
  'src/ui/avatars.js', 'src/ui/hub.js', 'src/ui/slip.js', 'src/ui/board.js', 'src/ui/live.js',
  'src/ui/garage.js', 'src/ui/mybets.js', 'src/main.js',
];

const mods = FILES.map(transform);

// Topological sort so every module is defined before it is required.
const byKey = new Map(mods.map((m) => [m.key, m]));
const order = [];
const state = new Map();
(function visit(k, trail) {
  if (state.get(k) === 'done') return;
  if (state.get(k) === 'open') throw new Error(`import cycle: ${[...trail, k].join(' -> ')}`);
  const m = byKey.get(k);
  if (!m) return; // 'three' is emitted first
  state.set(k, 'open');
  for (const d of m.deps) visit(d, [...trail, k]);
  state.set(k, 'done');
  order.push(m);
})('main.js', []);
for (const m of mods) if (state.get(m.key) !== 'done') order.push(m);

// --- assemble ---------------------------------------------------------------
const html = read('index.html');
const bodyMatch = html.match(/<body>([\s\S]*?)<script type="module"/);
if (!bodyMatch) throw new Error('could not extract body markup');
const markup = bodyMatch[1].trim();

const bundle = `<title>Burnt Rubber</title>
<style>
${read('styles.css')}
</style>
${markup}
<script>
"use strict";
(function () {
  const __mods = {};
  function __def(name, fn) { __mods[name] = { fn, exports: null }; }
  function __req(name) {
    const m = __mods[name];
    if (!m) throw new Error('module not found: ' + name);
    if (!m.exports) { m.exports = {}; m.fn(m.exports, __req); }
    return m.exports;
  }

${threeModule()}

${order.map((m) => m.code).join('\n\n')}

  __req('main.js');
})();
<\/script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bundle);
console.log(`wrote ${out} (${(bundle.length / 1048576).toFixed(2)} MB, ${order.length} modules)`);
console.log('order:', order.map((m) => m.key).join(' '));
