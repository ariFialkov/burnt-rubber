// Runs tools/convert-models.html headlessly and writes the GLBs + previews.
//
//   node tools/convert-models.mjs
//
// Needs a static server on the repo root (default http://127.0.0.1:8347) and
// playwright-core with Chromium — this is a dev-time tool only; the game
// itself has no build dependencies.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8347';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT || 'playwright-core'));
} catch {
  console.error('playwright-core not found; set PLAYWRIGHT=/path/to/node_modules/playwright-core');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', String(e)));
await page.goto(`${BASE}/tools/convert-models.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__glb, null, { timeout: 120000 });

const meta = await page.evaluate(() => window.__meta);
const glb = await page.evaluate(() => window.__glb);
const shots = await page.evaluate(() => window.__shots);
await browser.close();

mkdirSync(resolve(ROOT, 'assets/models'), { recursive: true });
const previews = resolve(ROOT, process.env.PREVIEW_DIR || 'dist/model-previews');
mkdirSync(previews, { recursive: true });
for (const [v, b64] of Object.entries(glb)) {
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(resolve(ROOT, `assets/models/${v}.glb`), buf);
  for (const [k, d] of Object.entries(shots[v])) {
    writeFileSync(resolve(previews, `${v}-${k}.png`), Buffer.from(d.split(',')[1], 'base64'));
  }
  const m = meta[v];
  console.log(`${v.padEnd(8)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ${m.length}m x ${m.width}m x ${m.height}m  wheels ${m.wheels} r=${m.wheelRadius}  parts ${JSON.stringify(m.parts)}`);
}
console.log(`previews in ${previews}`);

// Keep the livery manifest in step with whatever atlases are present.
import { readdirSync, existsSync } from 'node:fs';
const livDir = resolve(ROOT, 'assets/liveries');
const present = existsSync(livDir) ? readdirSync(livDir).filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', '')) : [];
mkdirSync(livDir, { recursive: true });
writeFileSync(resolve(livDir, 'index.json'), JSON.stringify(present) + '\n');
console.log(`liveries listed: ${present.length ? present.join(', ') : 'none'}`);
