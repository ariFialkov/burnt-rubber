// Scenery for the loop circuits, by environment: instanced flora and props
// scattered off the road, and for city tracks a skyline of textured
// buildings with street furniture along the kerbs.

import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import * as F from './flora.js';

// What each environment scatters: species, count, distance band off the road
// centreline [min, max] (m), scale range, and an optional extra clearance.
const SCENES = {
  city:     [['oak', 40, [22, 60], [0.7, 1.1]], ['bushRound', 40, [20, 70], [0.7, 1.2]]],
  coast:    [['palm', 200, [20, 190], [0.8, 1.3]], ['rock', 70, [24, 190], [0.6, 2.2]], ['bushRound', 140, [20, 160], [0.7, 1.3]], ['beachHut', 20, [40, 170], [0.9, 1.2]], ['fenceSection', 50, [22, 120], [1, 1]]],
  desert:   [['cactus', 60, [22, 190], [0.7, 1.3]], ['cactusBare', 40, [22, 190], [0.7, 1.3]], ['cactusTwin', 40, [22, 190], [0.7, 1.3]], ['rock', 120, [24, 200], [0.5, 2.4]], ['scrub', 320, [20, 200], [0.7, 1.4]]],
  forest:   [['spruce', 220, [22, 200], [0.7, 1.3]], ['fir', 140, [24, 200], [0.7, 1.3]], ['oak', 80, [24, 180], [0.7, 1.2]], ['birch', 80, [22, 180], [0.8, 1.2]], ['stump', 50, [20, 120], [0.8, 1.3]], ['log', 40, [22, 120], [0.8, 1.3]], ['rock', 50, [24, 160], [0.5, 1.6]], ['bushRound', 80, [20, 120], [0.7, 1.2]]],
  tundra:   [['rock', 200, [22, 200], [0.6, 2.6]], ['fir', 40, [40, 200], [0.6, 1.0]], ['bushWide', 120, [20, 180], [0.7, 1.3]]],
  mountain: [['peak', 26, [220, 480], [40, 90]], ['fir', 150, [24, 200], [0.7, 1.3]], ['spruce', 70, [24, 200], [0.7, 1.2]], ['rock', 110, [24, 200], [0.6, 2.4]], ['bushWide', 60, [20, 140], [0.7, 1.2]]],
  plains:   [['oak', 110, [24, 200], [0.7, 1.2]], ['birch', 60, [24, 200], [0.8, 1.2]], ['bushRound', 160, [20, 180], [0.7, 1.3]], ['bushWide', 120, [20, 180], [0.7, 1.3]], ['hayBale', 90, [22, 160], [0.9, 1.2]], ['fenceSection', 120, [20, 90], [1, 1]], ['rock', 30, [26, 180], [0.5, 1.4]]],
};

export function dressLoop({ env, curve, width, rand, clearOfTrack }) {
  const g = new THREE.Group();
  const scene = SCENES[env] || SCENES.plains;
  const halfW = width / 2;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const placed = [];
  for (const [kind, count, band, scale] of scene) {
    const geo = F.SPECIES[kind](rand);
    const mats = [];
    const big = kind === 'peak';
    for (let tries = 0; tries < count * 3 && mats.length < count; tries++) {
      const u = rand();
      const c = curve.getPointAt(u), t = curve.getTangentAt(u);
      const n = new THREE.Vector3(-t.z, 0, t.x);
      const side = rand() < 0.5 ? -1 : 1;
      const dist = band[0] + rand() * (band[1] - band[0]);
      p.copy(c).addScaledVector(n, side * dist);
      const sc = scale[0] + rand() * (scale[1] - scale[0]);
      if (!clearOfTrack(p, halfW + 4 + (big ? sc : 2))) continue;
      if (big && placed.some((o) => o.distanceTo(p) < 120)) continue;
      placed.push(p.clone());
      // fences run along the road; everything else faces any way
      const yaw = kind === 'fenceSection' ? Math.atan2(t.x, t.z) + Math.PI / 2 : rand() * Math.PI * 2;
      q.setFromAxisAngle(up, yaw);
      s.set(sc, sc * (big ? 1 : 0.9 + rand() * 0.25), sc);
      p.y = -0.35;
      m.compose(p, q, s);
      mats.push(m.clone());
    }
    if (mats.length) g.add(F.instanced(geo, mats, kind));
  }
  if (env === 'city') g.add(cityBlocks(curve, width, rand, clearOfTrack));
  return g;
}

// --- city ---------------------------------------------------------------------

let windowTex = null;
function windowTexture() {
  if (windowTex) return windowTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d8dbe0'; g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const lit = r() < 0.18;
    g.fillStyle = lit ? '#f7e9b0' : (r() < 0.5 ? '#3c4a5c' : '#4d5d72');
    g.fillRect(x * 32 + 6, y * 32 + 5, 20, 22);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x * 32 + 6, y * 32 + 5, 20, 6);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x * 32 + 6, y * 32 + 25, 20, 2);
  }
  windowTex = new THREE.CanvasTexture(c);
  windowTex.wrapS = windowTex.wrapT = THREE.RepeatWrapping;
  windowTex.colorSpace = THREE.SRGBColorSpace;
  return windowTex;
}

const TINTS = [0xc9ccd2, 0xd9cdb8, 0xa8b4c4, 0x9a7a66, 0x8f9aa8, 0xe0d6c4, 0x7f8fa3];

// A textured facade plane with window pitch fixed at 3.4 m, tinted.
function facade(w, h, tint, ox, oy) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 3.4) + ox, uv.getY(i) * (h / 3.4) + oy);
  const col = new Float32Array(uv.count * 3);
  const c = new THREE.Color(tint);
  for (let i = 0; i < uv.count; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function plain(geo, color) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

// One building: four textured facades over a dark ground-floor band, a flat
// roof with a parapet, sometimes a setback upper block and roof plant.
function building(x, z, w, d, h, rand, facades, plains) {
  const tint = TINTS[Math.floor(rand() * TINTS.length)];
  const ox = Math.floor(rand() * 8) / 8, oy = Math.floor(rand() * 8) / 8;
  const band = 4.2;
  const block = (cx, cz, bw, bd, y0, bh) => {
    facades.push(facade(bw, bh, tint, ox, oy).translate(0, y0 + bh / 2, bd / 2).translate(cx, 0, cz));
    facades.push(facade(bw, bh, tint, ox, oy).rotateY(Math.PI).translate(0, y0 + bh / 2, -bd / 2).translate(cx, 0, cz));
    facades.push(facade(bd, bh, tint, ox, oy).rotateY(Math.PI / 2).translate(bw / 2, y0 + bh / 2, 0).translate(cx, 0, cz));
    facades.push(facade(bd, bh, tint, ox, oy).rotateY(-Math.PI / 2).translate(-bw / 2, y0 + bh / 2, 0).translate(cx, 0, cz));
    plains.push(plain(new THREE.BoxGeometry(bw + 0.02, 0.3, bd + 0.02).translate(cx, y0 + bh + 0.15, cz), 0x3a3d44));
    plains.push(plain(new THREE.BoxGeometry(bw + 0.4, 0.8, bd + 0.4).translate(cx, y0 + bh + 0.4, cz), new THREE.Color(tint).multiplyScalar(0.8)));
  };
  plains.push(plain(new THREE.BoxGeometry(w + 0.3, band, d + 0.3).translate(x, band / 2 - 0.4, z), 0x4a4e57));
  block(x, z, w, d, band - 0.4, h - band);
  if (h > 40 && rand() < 0.55) {
    const w2 = w * 0.6, d2 = d * 0.6, h2 = h * (0.3 + rand() * 0.4);
    block(x + (rand() - 0.5) * (w - w2) * 0.6, z + (rand() - 0.5) * (d - d2) * 0.6, w2, d2, h + 0.4, h2);
    if (rand() < 0.5) plains.push(plain(new THREE.CylinderGeometry(0.15, 0.2, 8, 6).translate(x, h + h2 + 4.5, z), 0x2a2d33));
  } else if (rand() < 0.6) {
    plains.push(plain(new THREE.BoxGeometry(w * 0.3, 2.2, d * 0.3).translate(x + w * 0.2, h + 1.5, z - d * 0.15), 0x6d7078));
  }
}

function cityBlocks(curve, width, rand, clearOfTrack) {
  const g = new THREE.Group();
  const halfW = width / 2;
  const facades = [], plains = [];
  const placed = [];
  const p = new THREE.Vector3();
  for (let tries = 0; tries < 900 && placed.length < 150; tries++) {
    const u = rand();
    const c = curve.getPointAt(u), t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    const side = rand() < 0.5 ? -1 : 1;
    const dist = 26 + rand() * 170;
    p.copy(c).addScaledVector(n, side * dist);
    const w = 12 + rand() * 20, d = 12 + rand() * 20;
    const far = (dist - 26) / 170;
    const h = 12 + rand() * 24 + far * (30 + rand() * 60);
    const r = Math.max(w, d) / 2;
    if (!clearOfTrack(p, halfW + r + 5)) continue;
    if (placed.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + r + 3)) continue;
    placed.push({ x: p.x, z: p.z, r });
    building(p.x, p.z, w, d, h, rand, facades, plains);
  }
  // street furniture along both kerbs
  const props = { streetlight: [], hydrant: [], mailbox: [], bench: [], bollard: [], trashCan: [], trafficLight: [] };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const L = curve.getLength();
  const place = (kind, u, side, off, yawTo) => {
    const c = curve.getPointAt(u), t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    const pos = c.clone().addScaledVector(n, side * off); pos.y = -0.35;
    // face the road: the lamp arm (+x in the prop) reaches over the kerb
    const yaw = Math.atan2(-side * n.x, -side * n.z) + (yawTo || 0);
    q.setFromAxisAngle(up, yaw);
    m.compose(pos, q, new THREE.Vector3(1, 1, 1));
    props[kind].push(m.clone());
  };
  const lampStep = 34 / L;
  for (let u = 0, k = 0; u < 1; u += lampStep, k++) place('streetlight', u, k % 2 ? 1 : -1, halfW + 2.6, Math.PI / 2);
  for (let k = 0; k < 6; k++) place('trafficLight', rand(), rand() < 0.5 ? -1 : 1, halfW + 2.8, Math.PI / 2);
  const small = ['hydrant', 'mailbox', 'bench', 'bollard', 'trashCan'];
  for (let k = 0; k < 170; k++) {
    const kind = small[Math.floor(rand() * small.length)];
    place(kind, rand(), rand() < 0.5 ? -1 : 1, halfW + 3 + rand() * 2.5, kind === 'bench' ? Math.PI : (rand() - 0.5) * 0.4);
  }
  for (const [kind, mats] of Object.entries(props)) if (mats.length) g.add(F.instanced(F.SPECIES[kind](rand), mats, kind));

  if (facades.length) {
    const fg = mergeGeometries(facades, false);
    g.add(new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: windowTexture(), vertexColors: true })));
    const pg = mergeGeometries(plains.map((x) => (x.index ? x.toNonIndexed() : x)), false);
    g.add(new THREE.Mesh(pg, new THREE.MeshLambertMaterial({ vertexColors: true })));
  }
  return g;
}
