// Terrain for the point-to-point stages (rally, baja): a heightfield the
// road is cut into, coloured by slope and zone, and dressed with instanced
// trees, rocks, cacti and scrub.
//
// The stage is a chain of zones along the route. A rally alternates tight
// forest (rolling ground, trees right up to the shoulder) with mountain
// ridges (big relief, the road clinging to a hillside that rises on one
// side and falls away on the other). A baja runs through dunes (ridged
// crests at an angle to the route), open plains, mesas (flat-topped
// plateaus the road cuts between) and canyons (walls climbing straight off
// the shoulders). Zones blend into each other over sixty metres or so.
//
// The road's own profile is the terrain's, low-passed and grade-limited so
// it stays drivable; the terrain then blends to the road over a shoulder so
// the road reads as cut and filled into the hillside rather than floating.

import * as THREE from 'three';
import { clamp, lerp } from '../core/rng.js';
import * as F from './flora.js';

const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Seeded value noise (smooth, cheap) with a small fbm on top.
function makeNoise(seed) {
  const hash = (ix, iz) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const sm = (t) => t * t * (3 - 2 * t);
  const val = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = sm(x - ix), fz = sm(z - iz);
    return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), fx), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx), fz) * 2 - 1;
  };
  const fbm = (x, z, oct = 3) => {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * val(x * f + o * 17.3, z * f + o * 9.1); n += a; a *= 0.5; f *= 2.1; }
    return s / n;
  };
  return { val, fbm };
}

// Zone weights at a distance `s` along the route: soft boxes that sum to ~1.
function zoneWeightsAt(zones, s) {
  const w = {};
  let side = 0;
  for (const z of zones) {
    const k = sstep(z.s0 - 30, z.s0 + 30, s) * (1 - sstep(z.s1 - 30, z.s1 + 30, s));
    if (k <= 0) continue;
    w[z.kind] = (w[z.kind] || 0) + k;
    side += k * (z.side || 0);
  }
  return { w, side };
}

// Nearest route sample to (x, z): distance to the polyline, the sample
// index, the arc distance, and which side of the road the point is on.
function makeNearest(samples) {
  const M = samples.length;
  const stride = 4;
  return (x, z) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < M; i += stride) {
      const dx = x - samples[i].x, dz = z - samples[i].z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    for (let i = Math.max(0, best - stride); i <= Math.min(M - 1, best + stride); i++) {
      const dx = x - samples[i].x, dz = z - samples[i].z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    // Project on the two adjacent segments for the true polyline distance.
    let d = Math.sqrt(bd), s = samples[best].s, ti = best, tf = 0;
    for (const j of [best - 1, best]) {
      if (j < 0 || j + 1 >= M) continue;
      const a = samples[j], b = samples[j + 1];
      const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
      if (L2 < 1e-6) continue;
      const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
      const px = a.x + ex * t, pz = a.z + ez * t;
      const dd = Math.hypot(x - px, z - pz);
      if (dd < d) { d = dd; s = a.s + (b.s - a.s) * t; ti = j; tf = t; }
    }
    const q = samples[best];
    const side = Math.sign(q.tx * (z - q.z) - q.tz * (x - q.x)) || 1; // +1 = left of travel
    return { d, s, i: ti, f: tf, side };
  };
}

export function buildTerrain({ style, theme, samples, zones, halfW, rand, flats = [] }) {
  const seed = Math.floor(rand() * 1e9);
  const N = makeNoise(seed);
  const nearest = makeNearest(samples);
  const baja = style === 'baja';
  const M = samples.length;
  const dTheta = rand() * Math.PI, dTheta2 = dTheta + 0.9 + rand() * 0.8; // dune crest directions
  const blendW = baja ? 34 : 24;
  // Terrain grid cell. Nothing within a cell and a half of the road may rise
  // above it: a triangle from inside the road to a vertex already up the
  // hillside would otherwise cross the road surface and bury the cars on the
  // uphill side.
  const cell = 12;
  const corridor = halfW + cell * 1.5;

  // Zone weights as a smooth field over the plane: a distance-weighted
  // average over every route sample (a nearest-sample lookup would jump
  // between two legs of the route and cut a cliff along the seam). Far from
  // the route the land settles into one character: mountains behind a
  // rally, mesas and dunes behind a baja.
  const KINDS = baja ? ['dunes', 'plains', 'mesa', 'canyon'] : ['forest', 'ridge'];
  const FAR = baja ? { dunes: 0.35, plains: 0, mesa: 0.65, canyon: 0 } : { forest: 0, ridge: 1 };
  const SIG = 90, SIG2 = 2 * SIG * SIG, REACH2 = 9 * SIG * SIG, STRIDE = 2;
  const sampW = KINDS.map(() => new Float32Array(M));
  const sampSide = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const zw = zoneWeightsAt(zones, samples[i].s);
    KINDS.forEach((k, j) => { sampW[j][i] = zw.w[k] || 0; });
    sampSide[i] = zw.side * (zw.w.ridge || 0);
  }
  function field(x, z) {
    const near = nearest(x, z);
    const acc = new Float32Array(KINDS.length);
    let slope = 0, K = 0;
    for (let i = 0; i < M; i += STRIDE) {
      const q = samples[i];
      const dx = x - q.x, dz = z - q.z, d2 = dx * dx + dz * dz;
      if (d2 > REACH2) continue;
      const k = Math.exp(-d2 / SIG2);
      K += k;
      for (let j = 0; j < KINDS.length; j++) acc[j] += k * sampW[j][i];
      if (!baja && sampSide[i] !== 0) {
        // the hillside: up on one side of this leg, down on the other,
        // levelling out again a few hundred metres off
        const sd = q.tx * dz - q.tz * dx; // signed lateral distance, + = left of travel
        const ad = Math.abs(sd);
        slope += k * sampSide[i] * Math.sign(sd) * 0.38 * Math.min(ad, 150) * (1 - sstep(180, 600, ad));
      }
    }
    const w = {};
    if (K > 1e-9) { KINDS.forEach((k, j) => { w[k] = acc[j] / K; }); slope /= K; }
    else { const zw = zoneWeightsAt(zones, near.s); KINDS.forEach((k) => { w[k] = zw.w[k] || 0; }); slope = 0; }
    const far = sstep(220, 520, near.d);
    KINDS.forEach((k) => { w[k] = lerp(w[k], FAR[k], far); });
    // broken up so the hillside is a hillside, not a wall following the road
    slope *= (1 - far) * (0.75 + 0.5 * N.fbm(x / 260 + 5.5, z / 260, 2));
    return { near, w, slope };
  }

  // Raw relief, before the road is cut in. `f` is the field at this point.
  function relief(x, z, f) {
    const w = f.w, d = f.near.d;
    if (!baja) {
      const ridge = w.ridge || 0;
      const rolling = 5 * N.fbm(x / 90, z / 90);
      const hills = 40 * N.fbm(x / 380 + 3.1, z / 380, 2);
      let h = rolling + hills * (0.6 + 0.4 * ridge);
      if (ridge > 0) {
        const big = 70 * N.fbm(x / 650 + 7.7, z / 650 + 2.2, 2);
        const ridged = 12 * Math.abs(N.fbm(x / 140 + 1.3, z / 140, 2));
        h += ridge * (big + ridged);
      }
      return h + f.slope;
    }
    const dunes = w.dunes || 0, mesa = w.mesa || 0, canyon = w.canyon || 0;
    let h = 2.5 * N.fbm(x / 120, z / 120) + 6 * N.fbm(x / 600 + 4.4, z / 600, 2);
    if (dunes > 0) {
      const warp = 18 * N.fbm(x / 200 + 9.1, z / 200);
      const c1 = x * Math.cos(dTheta) + z * Math.sin(dTheta) + warp;
      const c2 = x * Math.cos(dTheta2) + z * Math.sin(dTheta2) - warp * 0.5;
      const crest = 10 * (1 - Math.abs(Math.sin(c1 * (Math.PI / 130)))) + 4 * (1 - Math.abs(Math.sin(c2 * (Math.PI / 62))));
      h += dunes * crest;
    }
    if (mesa > 0) {
      const n = N.fbm(x / 380 + 2.2, z / 380 + 5.5, 2) * 0.5 + 0.5;
      const top = 42 * sstep(0.5, 0.6, n);
      const talus = 5 * Math.abs(N.fbm(x / 70, z / 70)) * sstep(0.62, 0.5, n);
      h += mesa * (top + talus);
    }
    if (canyon > 0) {
      const wall = 36 * sstep(halfW + 6, halfW + 34, d) + 6 * N.fbm(x / 50 + 1.1, z / 50) * sstep(halfW + 6, halfW + 20, d);
      h += canyon * wall;
    }
    return h;
  }

  // --- the road's own profile: relief along the route, smoothed and
  // grade-limited, so what the terrain blends to is drivable.
  const roadY = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const q = samples[i];
    const f = field(q.x, q.z);
    f.near = { d: 0, s: q.s, i, f: 0, side: 1 };
    roadY[i] = relief(q.x, q.z, f);
  }
  const ds = M > 1 ? samples[1].s - samples[0].s : 5;
  const smooth = (arr, halfWin) => {
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      let s = 0, n = 0;
      for (let k = -halfWin; k <= halfWin; k++) { const j = clamp(i + k, 0, arr.length - 1); s += arr[j]; n++; }
      out[i] = s / n;
    }
    return out;
  };
  let y = smooth(roadY, Math.round(45 / ds));
  // level the grid and the finish area (before the grade limit and the last
  // smoothing, so the way in and out of the level stretch is drivable too)
  for (const f of flats) f.y = y[f.i];
  for (let i = 0; i < M; i++) {
    const q = samples[i];
    for (const f of flats) {
      const k = 1 - sstep(f.r * 0.5, f.r, Math.abs(q.s - f.s));
      if (k > 0) y[i] = lerp(y[i], f.y, k);
    }
  }
  const gmax = baja ? 0.10 : 0.14;
  for (let i = 1; i < M; i++) y[i] = clamp(y[i], y[i - 1] - gmax * ds, y[i - 1] + gmax * ds);
  for (let i = M - 2; i >= 0; i--) y[i] = clamp(y[i], y[i + 1] - gmax * ds, y[i + 1] + gmax * ds);
  y = smooth(y, Math.round(20 / ds));
  for (const f of flats) f.y = y[f.i];
  roadY.set(y);
  const roadYAt = (near) => { const j = clamp(near.i, 0, M - 2); return lerp(roadY[j], roadY[j + 1], near.f); };

  // Height of the finished terrain at any point.
  function heightAt(x, z) {
    const f = field(x, z), near = f.near;
    let h = relief(x, z, f);
    const t = sstep(halfW + 2.5, halfW + 2.5 + blendW, near.d);
    const road = roadYAt(near);
    h = lerp(road - 0.35, h, t);
    if (near.d < corridor) h = Math.min(h, road - 0.35);
    // Levelled ground (grid, finish) follows the road beside it, which the
    // profile step already levelled: never a fixed height the road could
    // dip under on the fringe.
    for (const f of flats) {
      const dx = x - f.x, dz = z - f.z;
      const k = 1 - sstep(f.r * 0.55, f.r, Math.hypot(dx, dz));
      if (k > 0) h = lerp(h, road - 0.35, k);
    }
    return h;
  }

  // --- the mesh: a grid over the route's bounding box plus a margin
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const q of samples) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z); }
  const margin = 820;
  const x0 = minX - margin, z0 = minZ - margin;
  const nx = Math.ceil((maxX - minX + 2 * margin) / cell), nz = Math.ceil((maxZ - minZ + 2 * margin) / cell);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const info = new Array((nx + 1) * (nz + 1));
  let minY = Infinity;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      const x = x0 + i * cell, z = z0 + j * cell;
      const f = field(x, z), near = f.near;
      let h = relief(x, z, f);
      const t = sstep(halfW + 2.5, halfW + 2.5 + blendW, near.d);
      const road = roadYAt(near);
      h = lerp(road - 0.35, h, t);
      if (near.d < corridor) h = Math.min(h, road - 0.35);
      for (const fl of flats) {
        const kk = 1 - sstep(fl.r * 0.55, fl.r, Math.hypot(x - fl.x, z - fl.z));
        if (kk > 0) h = lerp(h, road - 0.35, kk);
      }
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      info[k] = { w: f.w, road: roadYAt(near), d: near.d };
      minY = Math.min(minY, h);
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  let q = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;

  // --- colours by zone, slope and height
  const ground = new THREE.Color(theme.ground);
  const pal = baja
    ? { base: ground, dune: ground.clone().lerp(new THREE.Color(0xe8cf9a), 0.45), rock: new THREE.Color(0x9a6242), top: new THREE.Color(0xb27a52), scrub: ground.clone().lerp(new THREE.Color(0x7a7a4a), 0.35) }
    : { base: ground, floor: ground.clone().lerp(new THREE.Color(0x2f4a28), 0.5), rock: new THREE.Color(0x7b7772), high: ground.clone().lerp(new THREE.Color(0xd9dde0), 0.55) };
  const c = new THREE.Color();
  for (let k = 0; k < info.length; k++) {
    const ny = nrm[k * 3 + 1];
    const h = pos[k * 3 + 1];
    const { w, road } = info[k];
    const steep = sstep(0.86, 0.62, ny);
    const jitter = 1 + 0.07 * N.val(pos[k * 3] / 23, pos[k * 3 + 2] / 23);
    if (baja) {
      c.copy(pal.base).lerp(pal.dune, w.dunes || 0).lerp(pal.scrub, 0.6 * (w.plains || 0));
      const up = sstep(8, 30, h - road);
      c.lerp(pal.top, up * 0.8).lerp(pal.rock, steep);
    } else {
      c.copy(pal.base).lerp(pal.floor, 0.7 * (w.forest || 0));
      c.lerp(pal.high, sstep(45, 90, h - road) * 0.6).lerp(pal.rock, steep);
    }
    c.multiplyScalar(jitter);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  // a floor far beyond the grid so the horizon never shows the void
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: theme.ground }));
  floor.rotateX(-Math.PI / 2);
  floor.position.set((minX + maxX) / 2, minY - 2, (minZ + maxZ) / 2);
  group.add(floor);

  // --- dressing (built below, after the scatter helpers)

  function scatter(count, spread, accept, place) {
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), qn = new THREE.Quaternion(), sc = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; tries < count * 3 && n < count; tries++) {
      const q = samples[Math.floor(rand() * M)];
      const zw = zoneWeightsAt(zones, q.s);
      const off = (halfW + 3 + rand() * spread) * (rand() < 0.5 ? -1 : 1);
      const x = q.x - q.tz * off, z = q.z + q.tx * off;
      const near = nearest(x, z);
      if (near.d < halfW + 3) continue;
      if (rand() > accept(zw, near)) continue;
      const h = heightAt(x, z);
      p.set(x, h + (place.sink || 0), z);
      const { scale, yaw } = place(zw, rand);
      qn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      sc.set(scale.x, scale.y, scale.z);
      m.compose(p, qn, sc);
      n++;
      place.set(n - 1, m);
    }
    return n;
  }

  // Scatter one species: returns its matrices.
  function species(count, spread, accept, scaleRange, sink = -0.3, yScale = null) {
    const mats = [];
    scatter(count, spread, accept, Object.assign((zw, r) => {
      const s = scaleRange[0] + r() * (scaleRange[1] - scaleRange[0]);
      return { scale: { x: s, y: s * (yScale ? yScale(r) : 1), z: s }, yaw: r() * Math.PI * 2 };
    }, { set: (i, m) => { mats[i] = m.clone(); }, sink }));
    return mats;
  }
  const builders = { ...F.SPECIES, redRock: (r) => F.rock(r, 0x9a6a4c) };
  const addAll = (g, list) => { for (const [kind, mats] of list) if (mats.length) g.add(F.instanced(builders[kind](rand), mats, kind)); };

  function forestDressing() {
    const g = new THREE.Group();
    const forest = (zw, near) => (0.12 + 0.9 * (zw.w.forest || 0)) * (near.d < 60 ? 1 : 0.55);
    addAll(g, [
      ['spruce', species(1100, 150, forest, [0.7, 1.4], -0.3, (r) => 0.85 + r() * 0.4)],
      ['fir', species(700, 150, forest, [0.7, 1.3], -0.3, (r) => 0.85 + r() * 0.4)],
      ['oak', species(320, 140, (zw, near) => forest(zw, near) * 0.7, [0.7, 1.2])],
      ['birch', species(360, 140, forest, [0.8, 1.2])],
      ['stump', species(140, 90, (zw) => 0.1 + 0.9 * (zw.w.forest || 0), [0.8, 1.4], -0.25)],
      ['log', species(110, 90, (zw) => 0.1 + 0.9 * (zw.w.forest || 0), [0.8, 1.3], -0.2)],
      ['bushRound', species(300, 110, (zw) => 0.3 + 0.6 * (zw.w.forest || 0), [0.6, 1.2], -0.3)],
      ['rock', species(320, 120, (zw) => 0.08 + 0.8 * (zw.w.ridge || 0), [0.6, 2.4], -0.4, (r) => 0.6 + r() * 0.5)],
    ]);
    return g;
  }

  function desertDressing() {
    const g = new THREE.Group();
    addAll(g, [
      ['cactus', species(380, 200, (zw) => 0.05 + 0.7 * (zw.w.plains || 0) + 0.5 * (zw.w.mesa || 0), [0.7, 1.4], -0.25, (r) => 0.85 + r() * 0.4)],
      ['scrub', species(900, 220, (zw) => 0.15 + 0.8 * (zw.w.plains || 0) + 0.4 * (zw.w.mesa || 0) + 0.3 * (zw.w.canyon || 0), [0.6, 1.5], -0.3)],
      ['rock', species(360, 160, (zw) => 0.1 + 0.8 * (zw.w.canyon || 0) + 0.6 * (zw.w.mesa || 0), [0.6, 2.8], -0.5, (r) => 0.6 + r() * 0.5)],
    ].map(([k, m]) => (k === 'rock' ? ['redRock', m] : [k, m])));
    return g;
  }

  group.add(baja ? desertDressing() : forestDressing());
  return { group, heightAt, roadY, nearest, mesh, grid: { x0, z0, cell, nx, nz } };
}
