// Procedural scenery species: trees, bushes, stumps, logs, rocks, a cactus,
// a palm, and a few farm and roadside props. Each builder returns one
// merged geometry with vertex colours, built at real-world size with its
// base on y = 0, meant to be drawn as an InstancedMesh (one draw call per
// species, MeshLambertMaterial with vertexColors) and scaled per instance.
//
// The trees are not cones on sticks: conifers are stacked tiers with their
// rims jittered and drooped so the rows of branches read as ridges, the
// broadleaves are clusters of deformed lobes, and every species carries a
// little per-vertex colour noise so a hundred instances don't look stamped.

import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Paint a geometry: base colour, optional per-vertex jitter, optional
// per-vertex function (pos, base colour) -> colour.
function paint(geo, color, jitter = 0.06, fn = null, rand = Math.random) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color), c = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    c.copy(base);
    if (fn) fn(p, c);
    const j = 1 + (rand() - 0.5) * 2 * jitter;
    col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return geo;
}

// Push every vertex radially (about the y axis) by a noise factor, and
// optionally drop the rim of a tier so the branches droop.
function ruffle(geo, amount, rand, droop = 0) {
  const pos = geo.attributes.position;
  const p = new THREE.Vector3();
  const seen = new Map(); // shared displacement for coincident vertices
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    let f = seen.get(key);
    if (f === undefined) { f = 1 + (rand() - 0.5) * 2 * amount; seen.set(key, f); }
    const r = Math.hypot(p.x, p.z);
    if (r > 1e-4) {
      pos.setXYZ(i, p.x * f, p.y - droop * r * (f > 1 ? 1.4 : 0.6), p.z * f);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

const merge = (parts) => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  g.computeVertexNormals();
  return g;
};

// --- conifers ---------------------------------------------------------------

// Spruce: broad, dense tiers right down to the ground.
export function spruce(rand) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.16, 0.34, 2.6, 7).translate(0, 1.3, 0), 0x4a3324, 0.08, null, rand));
  const tiers = 6, top = 9.5 + rand() * 2;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = 1.2 + t * (top - 3.2);
    const r = 2.7 * (1 - t * 0.82) + 0.25;
    const h = 2.4 - t * 0.6;
    const cone = new THREE.ConeGeometry(r, h, 9, 1).translate(0, y + h / 2, 0);
    ruffle(cone, 0.16, rand, 0.12);
    const shade = new THREE.Color(0x2c5a34).lerp(new THREE.Color(0x4d8a45), t * 0.5);
    parts.push(paint(cone, shade, 0.09, (p, c) => { if (Math.hypot(p.x, p.z) < 0.05) c.multiplyScalar(0.8); }, rand));
  }
  return merge(parts);
}

// Fir: tall and narrow, a bare trunk under a slimmer crown, bluer green.
export function fir(rand) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.14, 0.3, 4.2, 7).translate(0, 2.1, 0), 0x5a4030, 0.08, null, rand));
  const tiers = 5, top = 12 + rand() * 2.5;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = 3.2 + t * (top - 5.5);
    const r = 1.7 * (1 - t * 0.78) + 0.22;
    const h = 2.6 - t * 0.5;
    const cone = new THREE.ConeGeometry(r, h, 8, 1).translate(0, y + h / 2, 0);
    ruffle(cone, 0.14, rand, 0.1);
    parts.push(paint(cone, new THREE.Color(0x2f5f4e).lerp(new THREE.Color(0x4a7f5e), t * 0.4), 0.08, null, rand));
  }
  return merge(parts);
}

// --- broadleaves ------------------------------------------------------------

function lobe(r, rand, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const pos = g.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const f = 1 + (Math.sin(p.x * 3.1 + p.y * 2.3) * 0.5 + Math.sin(p.z * 2.7 - p.y * 1.9) * 0.5) * 0.12;
    pos.setXYZ(i, p.x * f, p.y * f * 0.92, p.z * f);
  }
  g.computeVertexNormals();
  return g;
}

// Oak: a stout trunk forking into two limbs under a wide, lumpy crown.
export function oak(rand) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.28, 0.5, 3.2, 7).translate(0, 1.6, 0), 0x4b3b2a, 0.08, null, rand));
  for (const s of [-1, 1]) {
    const limb = new THREE.CylinderGeometry(0.14, 0.22, 2.6, 6).translate(0, 1.3, 0).rotateZ(s * 0.55).translate(0, 2.8, 0);
    parts.push(paint(limb, 0x4b3b2a, 0.08, null, rand));
  }
  const crown = 0x3f7a36;
  const lobes = [[0, 5.6, 0, 2.5], [1.6, 5.0, 0.4, 1.9], [-1.5, 5.2, -0.6, 1.8], [0.3, 4.6, 1.5, 1.7], [-0.4, 6.6, -0.9, 1.6]];
  for (const [x, y, z, r] of lobes) {
    const l = lobe(r * (0.9 + rand() * 0.2), rand).translate(x, y, z);
    parts.push(paint(l, new THREE.Color(crown).offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.08), 0.08, (p, c) => { c.multiplyScalar(0.85 + 0.25 * Math.max(0, (p.y - 4) / 4)); }, rand));
  }
  return merge(parts);
}

// Birch: slim pale trunk with dark bands and a tall, light, airy crown.
export function birch(rand) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 6.5, 7, 6).translate(0, 3.25, 0);
  parts.push(paint(trunk, 0xd8d4c8, 0.05, (p, c) => { if (Math.sin(p.y * 6.3 + p.x * 4) > 0.75) c.multiplyScalar(0.25); }, rand));
  const crownC = 0x78a84a;
  for (const [x, y, z, r, sy] of [[0, 6.8, 0, 1.5, 1.6], [0.7, 5.6, 0.5, 1.1, 1.3], [-0.7, 6.0, -0.5, 1.0, 1.3], [0.1, 8.3, 0.2, 0.9, 1.2]]) {
    const l = lobe(r, rand).scale(1, sy, 1).translate(x, y, z);
    parts.push(paint(l, new THREE.Color(crownC).offsetHSL(0, 0, (rand() - 0.5) * 0.06), 0.1, null, rand));
  }
  return merge(parts);
}

// --- bushes -----------------------------------------------------------------

export function bushRound(rand) {
  const parts = [];
  const c = new THREE.Color(0x4f7a3a).offsetHSL((rand() - 0.5) * 0.05, 0, 0);
  for (const [x, y, z, r] of [[0, 0.8, 0, 1.0], [0.7, 0.6, 0.3, 0.75], [-0.6, 0.65, -0.4, 0.7], [0.1, 0.55, -0.8, 0.6]]) {
    parts.push(paint(lobe(r, rand).translate(x, y, z), c, 0.1, (p, cc) => { cc.multiplyScalar(0.8 + 0.3 * Math.min(1, p.y / 1.4)); }, rand));
  }
  return merge(parts);
}

export function bushWide(rand) {
  const parts = [];
  const c = new THREE.Color(0x6b7f3a).offsetHSL((rand() - 0.5) * 0.05, 0, 0);
  for (const [x, y, z, r] of [[0, 0.5, 0, 0.9], [1.1, 0.45, 0.2, 0.7], [-1.0, 0.4, 0.4, 0.75], [0.3, 0.4, 1.0, 0.6], [-0.2, 0.45, -1.0, 0.65]]) {
    parts.push(paint(lobe(r, rand).scale(1, 0.7, 1).translate(x, y, z), c, 0.1, null, rand));
  }
  return merge(parts);
}

// Dry desert scrub: sparse, olive, a bit ragged.
export function scrub(rand) {
  const parts = [];
  const c = new THREE.Color(0x6d7a3c);
  for (const [x, y, z, r] of [[0, 0.55, 0, 0.8], [0.6, 0.4, 0.4, 0.5], [-0.55, 0.42, -0.3, 0.55]]) {
    parts.push(paint(ruffle(lobe(r, rand, 1), 0.2, rand).scale(1, 0.75, 1).translate(x, y, z), c, 0.14, null, rand));
  }
  return merge(parts);
}

// --- deadwood and rocks -----------------------------------------------------

// A spruce stump: the same flared base as the spruce trunk, sawn off.
export function stump(rand) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.32, 0.46, 0.55, 9, 1, true).translate(0, 0.275, 0), 0x4a3324, 0.08, null, rand));
  parts.push(paint(new THREE.CircleGeometry(0.32, 9).rotateX(-Math.PI / 2).translate(0, 0.551, 0), 0xb99a6a, 0.06, (p, c) => { if (Math.hypot(p.x, p.z) < 0.1) c.multiplyScalar(0.8); }, rand));
  parts.push(paint(new THREE.CylinderGeometry(0.46, 0.62, 0.16, 9).translate(0, 0.08, 0), 0x40301f, 0.08, null, rand));
  return merge(parts);
}

// A fallen log lying on the ground with a couple of broken branch stubs.
export function log(rand) {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.2, 0.3, 4.4, 8, 1, true).rotateZ(Math.PI / 2).translate(0, 0.27, 0);
  parts.push(paint(body, 0x5a4634, 0.08, (p, c) => { if (Math.sin(p.x * 5) > 0.6) c.multiplyScalar(0.85); }, rand));
  parts.push(paint(new THREE.CircleGeometry(0.3, 8).rotateY(-Math.PI / 2).translate(-2.2, 0.27, 0), 0xa88a5c, 0.06, null, rand));
  parts.push(paint(new THREE.CircleGeometry(0.2, 8).rotateY(Math.PI / 2).translate(2.2, 0.27, 0), 0xa88a5c, 0.06, null, rand));
  for (const [x, ang] of [[-0.8, 0.9], [1.1, -0.7]]) {
    const stub = new THREE.CylinderGeometry(0.06, 0.09, 0.7, 5).translate(0, 0.35, 0).rotateX(ang).translate(x, 0.35, 0);
    parts.push(paint(stub, 0x5a4634, 0.08, null, rand));
  }
  return merge(parts);
}

export function rock(rand, color = 0x77736e) {
  const g = new THREE.DodecahedronGeometry(1, 1);
  const pos = g.attributes.position, p = new THREE.Vector3();
  const a = rand() * 6, b = rand() * 6;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const f = 1 + 0.18 * Math.sin(p.x * 2.3 + a) * Math.cos(p.z * 1.9 + b) + 0.08 * Math.sin(p.y * 3.1);
    pos.setXYZ(i, p.x * f, Math.max(-0.2, p.y * f * 0.7), p.z * f);
  }
  g.computeVertexNormals();
  return paint(g, color, 0.08, (pp, c) => { c.multiplyScalar(0.85 + 0.2 * Math.max(0, pp.y)); }, rand);
}

// --- desert -----------------------------------------------------------------

// An oblong ribbed bulb of a cactus with L-shaped arms that run out and
// curve upward, each ending in its own bulb, none reaching the stalk's top.
// `arms` is 0, 1 or 2; two arms sit at different heights on different sides.
export function cactus(rand, arms = 1) {
  const parts = [];
  const green = 0x4f8a3e;
  const ribs = (geo) => {
    const pos = geo.attributes.position, p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const th = Math.atan2(p.z, p.x);
      const f = 1 + 0.07 * Math.cos(th * 12);
      pos.setXYZ(i, p.x * f, p.y, p.z * f);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const ribShade = (p, c) => { const th = Math.atan2(p.z, p.x); c.multiplyScalar(0.85 + 0.2 * Math.cos(th * 12)); };
  const H = 3.6 + rand() * 1.6, R = 0.5 + rand() * 0.12;
  const prof = [];
  for (let k = 0; k <= 9; k++) {
    const t = k / 9, y = t * H;
    const w = Math.pow(Math.max(0, 1 - Math.pow((t - 0.5) * 2, 4)), 0.5);
    prof.push(new THREE.Vector2(k === 0 ? R * 0.45 : R * Math.max(0.3, w) * (k === 9 ? 0.02 : 1), y)); // blunt base, sits in the ground
  }
  parts.push(paint(ribs(new THREE.LatheGeometry(prof, 11)), green, 0.06, ribShade, rand));
  const th0 = rand() * Math.PI * 2;
  for (let a = 0; a < arms; a++) {
    // second arm: the other side, a good way higher or lower
    const th = a === 0 ? th0 : th0 + Math.PI * (0.6 + rand() * 0.8);
    const y0 = a === 0 ? H * (0.28 + rand() * 0.22) : H * (0.5 + rand() * 0.14);
    const out = 0.7 + rand() * 0.4, r = 0.2 + rand() * 0.06;
    const up = Math.min(1.2 + rand() * 0.9, H * 0.82 - y0);
    const dx = Math.cos(th), dz = Math.sin(th);
    const path = new THREE.CatmullRomCurve3([
      V(dx * R * 0.6, y0, dz * R * 0.6), V(dx * (R + out * 0.6), y0 - 0.05, dz * (R + out * 0.6)),
      V(dx * (R + out), y0 + 0.3, dz * (R + out)), V(dx * (R + out), y0 + up, dz * (R + out)),
    ]);
    const tube = new THREE.TubeGeometry(path, 7, r, 6, false);
    parts.push(paint(tube, green, 0.06, null, rand));
    const cap = new THREE.SphereGeometry(r * 1.05, 6, 4).translate(dx * (R + out), y0 + up, dz * (R + out));
    parts.push(paint(cap, green, 0.06, null, rand));
  }
  return merge(parts);
}

// --- coast ------------------------------------------------------------------

export function palm(rand) {
  const parts = [];
  const lean = (rand() - 0.5) * 0.5;
  const path = new THREE.CatmullRomCurve3([V(0, 0, 0), V(lean * 2, 3.5, 0), V(lean * 4.5, 7, 0), V(lean * 5.5, 9.5, 0)]);
  parts.push(paint(new THREE.TubeGeometry(path, 8, 0.24, 7, false), 0x8a6f4a, 0.1, (p, c) => { if (Math.sin(p.y * 7) > 0.5) c.multiplyScalar(0.8); }, rand));
  const top = path.getPoint(1);
  const n = 7 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2 + rand() * 0.3;
    const frond = new THREE.PlaneGeometry(0.7, 3.4, 1, 6);
    const pos = frond.attributes.position, p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const t = (p.y + 1.7) / 3.4;               // 0 at the base, 1 at the tip
      const w = 1 - t * 0.7;
      pos.setXYZ(i, p.x * w, 0.9 * Math.sin(t * 1.9) - 1.1 * t * t, t * 3.2);
    }
    frond.computeVertexNormals();
    { const nn = frond.attributes.normal; let sy = 0; for (let i = 0; i < nn.count; i++) sy += nn.getY(i); if (sy < 0) { const idx = frond.index.array; for (let i = 0; i < idx.length; i += 3) { const t0 = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t0; } } }
    frond.rotateY(th).translate(top.x, top.y + 0.2, top.z);
    parts.push(paint(frond, new THREE.Color(0x5db65a).offsetHSL(0, 0, (rand() - 0.5) * 0.1), 0.08, null, rand));
  }
  const g = merge(parts);
  g.attributes.normal && (g.userData.doubleSided = true);
  return g;
}

// --- farm and roadside ------------------------------------------------------

export function hayBale(rand) {
  const g = new THREE.CylinderGeometry(0.8, 0.8, 1.6, 14).rotateZ(Math.PI / 2).translate(0, 0.8, 0);
  return paint(g, 0xc9a85c, 0.12, (p, c) => { if (Math.abs(p.x) > 0.79) c.multiplyScalar(0.85); }, rand);
}

export function fenceSection(rand) {
  const parts = [];
  for (const x of [-2, 0, 2]) parts.push(paint(new THREE.BoxGeometry(0.14, 1.2, 0.14).translate(x, 0.6, 0), 0x8a7455, 0.08, null, rand));
  for (const y of [0.45, 0.95]) parts.push(paint(new THREE.BoxGeometry(4.2, 0.1, 0.06).translate(0, y, 0), 0x9c8663, 0.08, null, rand));
  return merge(parts);
}

// A jagged mountain peak for the backdrop (mountain env), pale and rocky.
export function peak(rand) {
  const g = new THREE.ConeGeometry(1, 2.2, 7, 4).translate(0, 1.1, 0);
  ruffle(g, 0.22, rand);
  return paint(g, 0x8593a3, 0.1, (p, c) => { if (p.y > 1.7) c.set(0xe8ecf0); }, rand);
}

// --- urban ------------------------------------------------------------------

export function streetlight(rand) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.07, 0.12, 7.5, 7).translate(0, 3.75, 0), 0x5a5f66, 0.03, null, rand));
  parts.push(paint(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 7).translate(0, 0.15, 0), 0x4a4e54, 0.03, null, rand));
  parts.push(paint(new THREE.BoxGeometry(1.7, 0.08, 0.08).translate(0.85, 7.4, 0), 0x5a5f66, 0.03, null, rand));
  parts.push(paint(new THREE.BoxGeometry(0.6, 0.16, 0.26).translate(1.6, 7.32, 0), 0x3c4046, 0.03, null, rand));
  parts.push(paint(new THREE.BoxGeometry(0.5, 0.04, 0.2).translate(1.6, 7.22, 0), 0xfff2c8, 0.0, null, rand));
  return merge(parts);
}

export function hydrant(rand) {
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0.2, 0.1), new THREE.Vector2(0.14, 0.12), new THREE.Vector2(0.14, 0.6), new THREE.Vector2(0.17, 0.65), new THREE.Vector2(0.14, 0.8), new THREE.Vector2(0.001, 0.86)];
  const parts = [paint(new THREE.LatheGeometry(pts, 10), 0xc8322a, 0.05, null, rand)];
  parts.push(paint(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.45, 0), 0xc8322a, 0.05, null, rand));
  return merge(parts);
}

export function mailbox(rand) {
  const parts = [];
  parts.push(paint(new THREE.BoxGeometry(0.55, 0.5, 0.7).translate(0, 0.95, 0), 0x2f4f9a, 0.04, null, rand));
  parts.push(paint(new THREE.CylinderGeometry(0.35, 0.35, 0.55, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 1.2, 0), 0x2f4f9a, 0.04, null, rand));
  parts.push(paint(new THREE.BoxGeometry(0.4, 0.7, 0.4).translate(0, 0.35, 0), 0x2a3b6a, 0.04, null, rand));
  return merge(parts);
}

export function bench(rand) {
  const parts = [];
  parts.push(paint(new THREE.BoxGeometry(1.8, 0.06, 0.45).translate(0, 0.45, 0), 0x8b6b45, 0.06, null, rand));
  parts.push(paint(new THREE.BoxGeometry(1.8, 0.4, 0.05).translate(0, 0.72, -0.22), 0x8b6b45, 0.06, null, rand));
  for (const x of [-0.75, 0.75]) parts.push(paint(new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(x, 0.225, 0), 0x2e3238, 0.03, null, rand));
  return merge(parts);
}

export function bollard(rand) {
  return paint(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 8).translate(0, 0.45, 0), 0x3a3e45, 0.03, (p, c) => { if (p.y > 0.8) c.set(0xd9d9d9); }, rand);
}

export function trashCan(rand) {
  return paint(new THREE.CylinderGeometry(0.32, 0.28, 0.95, 10).translate(0, 0.475, 0), 0x3e474f, 0.04, (p, c) => { if (p.y > 0.9) c.set(0x262b30); }, rand);
}

export function trafficLight(rand) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 7).translate(0, 2.75, 0), 0x3a3e45, 0.03, null, rand));
  parts.push(paint(new THREE.BoxGeometry(2.6, 0.1, 0.1).translate(1.3, 5.4, 0), 0x3a3e45, 0.03, null, rand));
  parts.push(paint(new THREE.BoxGeometry(0.34, 1.0, 0.3).translate(2.4, 4.9, 0), 0x202428, 0.03, null, rand));
  const cols = [0xff3b30, 0xffcc00, 0x2ecc71];
  cols.forEach((c, k) => parts.push(paint(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8).rotateX(Math.PI / 2).translate(2.4, 5.25 - k * 0.3, 0.16), c, 0, null, rand)));
  return merge(parts);
}

export function beachHut(rand) {
  const parts = [];
  const c = [0xe8d8a8, 0xa8d8e8, 0xe8a8b8, 0xb8e8b0][Math.floor(rand() * 4)];
  parts.push(paint(new THREE.BoxGeometry(3, 2.4, 2.6).translate(0, 1.2, 0), c, 0.05, null, rand));
  parts.push(paint(new THREE.ConeGeometry(2.4, 1.3, 4).rotateY(Math.PI / 4).translate(0, 3.05, 0), 0x6b4f3a, 0.06, null, rand));
  return merge(parts);
}

export const cactusBare = (rand) => cactus(rand, 0);
export const cactusTwin = (rand) => cactus(rand, 2);

export const SPECIES = { spruce, fir, oak, birch, bushRound, bushWide, scrub, stump, log, rock, cactus, cactusBare, cactusTwin, palm, hayBale, fenceSection, peak, streetlight, hydrant, mailbox, bench, bollard, trashCan, trafficLight, beachHut };

// One shared material for everything painted per vertex.
let floraMat = null, floraMat2 = null;
export function floraMaterial(doubleSided = false) {
  if (doubleSided) return floraMat2 || (floraMat2 = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  return floraMat || (floraMat = new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// Build an InstancedMesh for a species from a list of matrices.
export function instanced(geo, mats, kind = '') {
  const m = new THREE.InstancedMesh(geo, floraMaterial(!!geo.userData.doubleSided), Math.max(1, mats.length));
  m.userData.kind = kind;
  mats.forEach((mat, i) => m.setMatrixAt(i, mat));
  m.count = mats.length;
  m.frustumCulled = false;
  return m;
}
