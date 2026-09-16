// Procedural circuits. Each (tour style, track) seed produces a closed spline
// scaled to the script's lap length, plus road ribbon, curbs, start gantry,
// grandstands, and environment dressing per location vibe.

import * as THREE from 'three';
import { rngFor, clamp, lerp } from '../core/rng.js';
import { buildTerrain } from './terrain.js';
import { GRID_OFFSET } from '../engine/script.js';

const ENV_THEMES = {
  city:     { ground: 0x3a4149, sky: 0x87a6c4, fog: 0x9db4cb, props: 'buildings' },
  coast:    { ground: 0x8a9a6b, sky: 0x8fc9e8, fog: 0xb8dcef, props: 'palms', water: true },
  desert:   { ground: 0xc9a86a, sky: 0xf2c894, fog: 0xe8c9a0, props: 'cacti' },
  forest:   { ground: 0x4c6b3c, sky: 0x9fc4e0, fog: 0xb5cfe0, props: 'pines' },
  tundra:   { ground: 0x9aa8a6, sky: 0xb9c8d4, fog: 0xcfd9e0, props: 'rocks' },
  mountain: { ground: 0x6b7a5e, sky: 0x9db8d8, fog: 0xb8c8dc, props: 'peaks' },
  plains:   { ground: 0x7d9455, sky: 0xa2cceb, fog: 0xc3ddf0, props: 'trees' },
};

const ROAD_WIDTH = { formula: 13, stock: 19, rally: 10, baja: 22, moto: 11 };

// Point-to-point stages: how the route walks, per zone. Segment length,
// heading change per bend, chance of a straight, chance the next bend goes
// the other way. Rally forest is quick cuts; the ridge is contour sweeps;
// dunes and plains are open sweeps, mesas moderate, canyons tight.
const WALK = {
  rally: {
    forest: { len: [55, 95], turn: [0.55, 1.35], straight: 0.18, flip: 0.55 },
    ridge:  { len: [80, 130], turn: [0.3, 0.9], straight: 0.25, flip: 0.4 },
  },
  baja: {
    dunes:  { len: [140, 220], turn: [0.15, 0.6], straight: 0.35, flip: 0.5 },
    plains: { len: [180, 260], turn: [0.1, 0.45], straight: 0.5, flip: 0.5 },
    mesa:   { len: [120, 180], turn: [0.3, 0.8], straight: 0.25, flip: 0.5 },
    canyon: { len: [70, 110], turn: [0.5, 1.1], straight: 0.15, flip: 0.6 },
  },
};
const ZONE_LEN = { rally: [350, 650], baja: [300, 520] };
const R_MIN = { rally: 16, baja: 30 };

function controlPoints(style, rand, vehicle) {
  const pts = [];
  if (vehicle === 'formula') {
    // A grand-prix layout: many points at uneven angles around a stretched
    // ring, big radius swings for esses and sweepers, and a few pulled hard
    // inward for hairpins and chicane complexes. Radial, so it never crosses.
    const nPts = 18 + Math.floor(rand() * 6);
    const base = 220, noise = 0.7;
    const stretch = 1.15 + rand() * 0.55;
    const angles = [];
    for (let k = 0; k < nPts; k++) angles.push((k + (rand() - 0.5) * 0.6) / nPts * Math.PI * 2);
    for (const a of angles) {
      const r = base * (1 - noise / 2 + rand() * noise);
      pts.push(new THREE.Vector3(Math.cos(a) * r * stretch, 0, Math.sin(a) * r));
    }
    // hairpins / chicanes: pulled well inside, never two next to each other
    const pulls = 2 + Math.floor(rand() * 2);
    const used = new Set([0, nPts - 1]);
    for (let n = 0; n < pulls; n++) {
      let k = 0;
      for (let tries = 0; tries < 20; tries++) { k = 1 + Math.floor(rand() * (nPts - 2)); if (!used.has(k) && !used.has(k - 1) && !used.has(k + 1)) break; }
      used.add(k);
      pts[k].multiplyScalar(0.45 + rand() * 0.2);
    }
    // an esses complex: three neighbours pushed in, out, in
    for (let tries = 0; tries < 20; tries++) {
      const k = 2 + Math.floor(rand() * (nPts - 5));
      if ([k - 1, k, k + 1, k + 2, k + 3].some((j) => used.has(j))) continue;
      pts[k].multiplyScalar(0.8); pts[k + 1].multiplyScalar(1.12); pts[k + 2].multiplyScalar(0.8);
      break;
    }
    return pts;
  }
  if (style === 'oval') {
    const rx = 230 + rand() * 60, rz = 120 + rand() * 40;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz));
    }
  } else {
    const nPts = style === 'baja' ? 11 : 12 + Math.floor(rand() * 4);
    const base = style === 'baja' ? 320 : style === 'rally' ? 250 : 220;
    const noise = style === 'oval' ? 0.08 : style === 'circuit' ? 0.42 : 0.5;
    const stretch = 1 + rand() * 0.5;
    for (let k = 0; k < nPts; k++) {
      const a = (k / nPts) * Math.PI * 2;
      const r = base * (1 - noise / 2 + rand() * noise);
      pts.push(new THREE.Vector3(Math.cos(a) * r * stretch, 0, Math.sin(a) * r));
    }
    // Pull one point inward to force a proper hairpin on circuits.
    if (style !== 'oval') {
      const k = 1 + Math.floor(rand() * (nPts - 2));
      pts[k].multiplyScalar(0.55);
    }
  }
  return pts;
}

// Tightest turning radius along the curve (m), sampled, and where it is.
function minRadius(curve, len, closed = true) {
  const N = 600;
  let prev = curve.getTangentAt(0), r = Infinity, u = 0;
  for (let k = 1; k <= (closed ? N : N - 1); k++) {
    const uu = closed ? (k % N) / N : k / (N - 1);
    const t = curve.getTangentAt(uu);
    const ang = prev.angleTo(t);
    if (ang > 1e-6 && (len / N) / ang < r) { r = (len / N) / ang; u = uu; }
    prev = t;
  }
  return { r, u };
}

// Ease only the control point at the tightest corner toward its neighbours
// (a touch on the neighbours too), so the rest of the layout keeps its
// character instead of the whole loop rounding off.
function easeTightest(curve, pts, m, closed) {
  const at = curve.getPointAt(m.u);
  const n = pts.length;
  let k = 0, bd = Infinity;
  pts.forEach((p, i) => { const d = (p.x - at.x) ** 2 + (p.z - at.z) ** 2; if (d < bd) { bd = d; k = i; } });
  const move = (i, amt) => {
    if (!closed && (i <= 0 || i >= n - 1)) return;
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], p = pts[i];
    p.x += amt * (a.x + b.x - 2 * p.x); p.z += amt * (a.z + b.z - 2 * p.z);
  };
  move(k, 0.3);
  if (closed || (k > 1 && k < n - 2)) { move((k + n - 1) % n, 0.08); move((k + 1) % n, 0.08); }
}

// Zones along a stage, by distance: rally alternates forest and ridge, baja
// draws from dunes, plains, mesa and canyon without repeating itself.
function makeZones(style, need, rand) {
  const zones = [];
  const [lo, hi] = ZONE_LEN[style];
  let s = 0, kind = style === 'rally' ? (rand() < 0.5 ? 'forest' : 'ridge') : 'plains';
  while (s < need) {
    const len = lerp(lo, hi, rand());
    zones.push({ kind, s0: s, s1: s + len, side: rand() < 0.5 ? -1 : 1 });
    s += len;
    if (style === 'rally') kind = kind === 'forest' ? 'ridge' : 'forest';
    else { const pool = ['dunes', 'plains', 'mesa', 'canyon'].filter((k) => k !== kind); kind = pool[Math.floor(rand() * pool.length)]; }
  }
  zones[zones.length - 1].s1 += 2000; // the run-off keeps the last zone
  return zones;
}

// Walk a route in the plane: a straight for the grid, then bends drawn from
// the zone the walk is in, kept clear of its own earlier legs and steered
// back toward the stage's overall direction so it never doubles back.
function walkRoute(style, need, zones, rand, sep) {
  const pts = [];
  const push = (x, z) => pts.push(new THREE.Vector3(x, 0, z));
  const zoneAt = (s) => zones.find((z) => s < z.s1) || zones[zones.length - 1];
  let x = 0, z = 0, th = 0, s = 0;
  push(0, 0);
  const clear = (cx, cz) => {
    for (let i = 0; i < pts.length - 2; i++) {
      const a = pts[i], b = pts[i + 1];
      for (const f of [0, 0.5]) {
        const px = a.x + (b.x - a.x) * f, pz = a.z + (b.z - a.z) * f;
        if (Math.hypot(cx - px, cz - pz) < sep) return false;
      }
    }
    return true;
  };
  let dir = rand() < 0.5 ? -1 : 1;
  while (s < need + 60) {
    const P = WALK[style][zoneAt(s).kind];
    const segLen = lerp(P.len[0], P.len[1], rand());
    let nth = th;
    if (s > 0 && rand() > P.straight) {
      nth = th + dir * lerp(P.turn[0], P.turn[1], rand());
      if (rand() < P.flip) dir = -dir;
    }
    // never wander more than ~65° off the stage's overall heading
    if (Math.abs(nth) > 1.15) { nth = Math.sign(nth) * 0.8; dir = -Math.sign(nth); }
    let ok = false;
    for (let attempt = 0; attempt < 14 && !ok; attempt++) {
      const cx = x + Math.cos(nth) * segLen, cz = z + Math.sin(nth) * segLen;
      if (clear(cx, cz)) { x = cx; z = cz; ok = true; } else nth = (attempt < 7 ? th : 0) + (rand() - 0.5) * 1.4;
    }
    if (!ok) { nth = 0; x += segLen; }
    th = nth; s += segLen;
    push(x, z);
  }
  return pts;
}

// A point-to-point stage: route, terrain and the 3D road curve through it.
function buildStage(race, script, style, width, rand, theme) {
  const n = race.field.length;
  const pre = GRID_OFFSET + n * script.pitch + 40;           // grid straight before the line
  // run-off past the flying finish: the live view runs to the end of the
  // race window, and the leader keeps its pace all the way
  const post = script.pace.cruise * (script.raceS - script.T + 1) + 80;
  const need = pre + script.totalDist + post;
  const zones = makeZones(style, need, rand);
  const pts = walkRoute(style, need, zones, rand, style === 'rally' ? 110 : 170);
  // the grid straight: the first leg(s) run dead ahead
  let acc = 0;
  for (let i = 1; i < pts.length && acc < pre + 30; i++) { acc += pts[i].distanceTo(pts[i - 1]); pts[i].set(acc, 0, 0); }
  let curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  curve.arcLengthDivisions = 1500;
  curve.updateArcLengths();
  const rMin = Math.max(width / 2 + 5, R_MIN[style]);
  for (let iter = 0; iter < 200; iter++) {
    const m = minRadius(curve, curve.getLength(), false);
    if (m.r >= rMin) break;
    easeTightest(curve, pts, m, false);
    curve.updateArcLengths();
  }
  // Smoothing the corners shortens the route: run the last leg on until the
  // curve really is long enough for the grid, the stage and the run-off.
  while (curve.getLength() < need + 80) {
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const dir = b.clone().sub(a).setY(0).normalize();
    pts.push(b.clone().addScaledVector(dir, 100));
    curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    curve.arcLengthDivisions = 1500;
    curve.updateArcLengths();
  }
  // Samples every 5 m along the plan, for the terrain and the road profile.
  const L = curve.getLength();
  const M = Math.ceil(L / 5);
  const samples = [];
  for (let k = 0; k <= M; k++) {
    const u = k / M;
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    samples.push({ x: p.x, z: p.z, s: u * L, tx: t.x, tz: t.z });
  }
  const at = (sd) => samples[clamp(Math.round(sd / 5), 0, M)];
  const flats = [
    { s: pre * 0.5, r: pre * 0.5 + 40, i: clamp(Math.round(pre * 0.5 / 5), 0, M) },   // the grid
    { s: pre + script.totalDist, r: 90, i: clamp(Math.round((pre + script.totalDist) / 5), 0, M) }, // the finish
  ].map((f) => ({ ...f, x: at(f.s).x, z: at(f.s).z }));
  const terrain = buildTerrain({ style, theme, samples, zones, halfW: width / 2, rand, flats });
  const pts3 = samples.map((q, i) => new THREE.Vector3(q.x, terrain.roadY[i], q.z));
  const road = new THREE.CatmullRomCurve3(pts3, false, 'catmullrom', 0.5);
  road.arcLengthDivisions = 2500;
  road.updateArcLengths();
  return { curve: road, d0: -pre, len: road.getLength(), terrain, zones };
}

export function buildTrack(race, script) {
  const rand = rngFor('track-v1', race.trackSeed);
  const style = race.tour.style;
  const theme = ENV_THEMES[race.track.env] || ENV_THEMES.plains;
  const width = ROAD_WIDTH[race.tour.vehicle] || 12;
  const open = style === 'rally' || style === 'baja';

  let curve, d0 = 0, len, terrain = null;
  if (open) {
    ({ curve, d0, len, terrain } = buildStage(race, script, style, width, rand, theme));
  } else {
    const pts = controlPoints(style, rand, race.tour.vehicle);
    curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.6);

    // Scale so lap length matches the race script exactly (speeds line up).
    const fit = () => {
      curve.updateArcLengths();
      const scale = script.lapLen / curve.getLength();
      pts.forEach((p) => { p.x *= scale; p.z *= scale; p.y *= scale; });
      curve.updateArcLengths();
    };
    fit();

    // No corner tighter than the road can take: a centreline radius under half
    // the width would put the inside lane past the corner's own centre, where
    // a car offset across the road is drawn going backwards. Relax the sharpest
    // control points toward their neighbours until every corner clears it,
    // refitting the length each time (smoothing shortens the loop, so the
    // refit also grows it — both help).
    const rMin = width / 2 + 5;
    for (let iter = 0; iter < 200; iter++) {
      const m = minRadius(curve, script.lapLen);
      if (m.r >= rMin) break;
      easeTightest(curve, pts, m, true);
      fit();
    }
    len = script.lapLen;
  }
  // Distance along the race (0 at the start line) -> curve parameter.
  const uAt = open ? (d) => clamp((d - d0) / len, 0, 1) : (d) => ((d / len) % 1 + 1) % 1;

  const group = new THREE.Group();
  const N = open ? 1000 : 700;
  const frames = [];
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const p = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    frames.push({ u, p, tangent, normal });
  }

  // Road ribbon
  const roadColor = race.tour.vehicle === 'baja' ? 0x8a6f4d : race.tour.vehicle === 'rally' ? 0x6e6a5e : 0x2e2e34;
  group.add(ribbon(frames, -width / 2, width / 2, 0.05, roadColor));
  // Edge lines / curbs
  if (style === 'circuit' || style === 'oval') {
    group.add(ribbon(frames, -width / 2 - 1.4, -width / 2, 0.08, 0xd8d8d8));
    group.add(ribbon(frames, width / 2, width / 2 + 1.4, 0.08, 0xc23b3b));
  } else {
    // a loose shoulder, a shade off the road, not a painted edge line
    const shoulder = style === 'baja' ? 0xa88a5a : 0x8a8672;
    group.add(ribbon(frames, -width / 2 - 1.6, -width / 2, 0.04, shoulder));
    group.add(ribbon(frames, width / 2, width / 2 + 1.6, 0.04, shoulder));
  }

  // Center dashes for ovals/circuits
  if (style !== 'baja' && style !== 'rally') {
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
    const dashGeo = new THREE.PlaneGeometry(0.5, 4);
    dashGeo.rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, 120);
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < 120; k++) {
      const f = frames[Math.floor((k / 120) * N)];
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.tangent);
      m4.compose(f.p.clone().setY(f.p.y + 0.09), q, new THREE.Vector3(1, 1, 1));
      dashes.setMatrixAt(k, m4);
    }
    group.add(dashes);
  }

  // Start/finish: checkered strip + gantry (a stage has one of each, apart)
  const frameAt = (u) => {
    const p = curve.getPointAt(u), tangent = curve.getTangentAt(u);
    return { u, p, tangent, normal: new THREE.Vector3(-tangent.z, 0, tangent.x).normalize() };
  };
  const uStart = uAt(0), uFinish = open ? uAt(script.totalDist) : uAt(0);
  const sf = open ? frameAt(uFinish) : frames[0];
  // Painted on the road: the strips follow the surface, so they sit flush
  // on a crest, a dip or a banked bend instead of poking through it.
  group.add(roadStrip(curve, sf.u, 5, width / 2 + 1, len, new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide })));
  group.add(gantry(sf, width, race.tour.accent));
  if (open) {
    const st = frameAt(uStart);
    group.add(gantry(st, width, race.tour.accent));
    group.add(roadStrip(curve, st.u, 0.6, width / 2 + 1, len, new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide })));
  }

  // Keep props and stands off every part of the looping road.
  const clearOfTrack = (p, margin) => {
    for (let k = 0; k < frames.length; k += 6) {
      const f = frames[k].p;
      const dx = p.x - f.x, dz = p.z - f.z;
      if (dx * dx + dz * dz < margin * margin) return false;
    }
    return true;
  };

  // Grandstands near the start and at two corners (a stage: start and finish)
  const standSpots = open ? [uAt(40), uAt(script.totalDist - 60)] : [0.985, 0.03, ...cornerUs(curve, 2, rand)];
  for (const u of standSpots) {
    const stand = grandstand(curve, u, width, rand, clearOfTrack);
    if (stand) group.add(stand);
  }

  // Ground + environment dressing
  if (terrain) {
    group.add(terrain.group);
  } else {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(script.lapLen * 0.62, 48),
      new THREE.MeshLambertMaterial({ color: theme.ground })
    );
    ground.rotateX(-Math.PI / 2);
    ground.position.y = -0.4;
    group.add(ground);
    if (theme.water) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(script.lapLen * 1.4, 32), new THREE.MeshBasicMaterial({ color: 0x2d7ea8 }));
      water.rotateX(-Math.PI / 2);
      water.position.y = -2.5;
      group.add(water);
    }
    group.add(props(theme.props, curve, width, rand, clearOfTrack));
  }

  const corners = cinematicCorners(curve, frames, width, rand, open ? { uStart, uFinish, heightAt: terrain.heightAt } : null);
  for (const c of corners) c.dist = open ? d0 + c.u * len : c.u * len;
  return { group, curve, frames, width, theme, corners, open, d0, len, uAt, heightAt: terrain ? terrain.heightAt : null, terrain };
}

// A strip `length` metres long centred on curve parameter `u`, laid on the
// road surface (sampled along the curve, offset across it), with UVs.
function roadStrip(curve, u, length, halfWidth, curveLen, material) {
  const K = 8, pos = [], uv = [];
  for (let k = 0; k <= K; k++) {
    const uu = Math.min(1, Math.max(0, u + (k / K - 0.5) * (length / curveLen)));
    const p = curve.getPointAt(uu), t = curve.getTangentAt(uu);
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const a = p.clone().addScaledVector(n, -halfWidth), b = p.clone().addScaledVector(n, halfWidth);
    pos.push(a.x, a.y + 0.08, a.z, b.x, b.y + 0.08, b.z);
    uv.push(0, k / K, 1, k / K);
  }
  const idx = [];
  for (let k = 0; k < K; k++) { const v = k * 2; idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 1;
  return mesh;
}

function ribbon(frames, off0, off1, y, color) {
  const pos = [];
  for (let k = 0; k < frames.length - 1; k++) {
    const a = frames[k], b = frames[k + 1];
    const a0 = a.p.clone().addScaledVector(a.normal, off0).setY(a.p.y + y);
    const a1 = a.p.clone().addScaledVector(a.normal, off1).setY(a.p.y + y);
    const b0 = b.p.clone().addScaledVector(b.normal, off0).setY(b.p.y + y);
    const b1 = b.p.clone().addScaledVector(b.normal, off1).setY(b.p.y + y);
    pos.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z);
    pos.push(a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

let checkerTex = null;
function checkerTexture() {
  if (checkerTex) return checkerTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  checkerTex = new THREE.CanvasTexture(c);
  return checkerTex;
}

function gantry(frame, width, accent) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x22252c });
  const post = new THREE.BoxGeometry(0.8, 9, 0.8);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(post, mat);
    m.position.copy(frame.p).addScaledVector(frame.normal, side * (width / 2 + 2));
    m.position.y += 4.5;
    g.add(m);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 5, 1.6, 1.2), new THREE.MeshLambertMaterial({ color: accent }));
  beam.position.copy(frame.p).y += 8.6;
  beam.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), frame.normal));
  g.add(beam);
  return g;
}

function grandstand(curve, u, width, rand, clearOfTrack) {
  const p = curve.getPointAt(u % 1);
  const t = curve.getTangentAt(u % 1);
  const n = new THREE.Vector3(-t.z, 0, t.x);
  const g = new THREE.Group();
  const len = 40 + rand() * 40;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(len, 7, 12),
    new THREE.MeshLambertMaterial({ color: 0x39404d })
  );
  // Seat stripes: a canvas texture of colored dots reads as a crowd from afar.
  const crowd = new THREE.Mesh(new THREE.PlaneGeometry(len, 12.6), new THREE.MeshBasicMaterial({ map: crowdTexture(rand) }));
  let side = rand() > 0.5 ? 1 : -1;
  const off0 = width / 2 + 14;
  // Pick a side whose whole footprint stays off the road (loops come back).
  const footprintClear = (sd) => {
    for (const along of [-len / 2, 0, len / 2]) {
      const c = p.clone().addScaledVector(n, sd * off0).addScaledVector(t, along);
      if (!clearOfTrack(c, width / 2 + 8)) return false;
    }
    return true;
  };
  if (!footprintClear(side)) {
    if (footprintClear(-side)) side = -side;
    else return null;
  }
  const off = side * off0;
  base.position.copy(p).addScaledVector(n, off).y += 3.5;
  base.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), t));
  g.add(base);
  crowd.position.copy(base.position).addScaledVector(n, -side * 6.01);
  crowd.setRotationFromQuaternion(base.quaternion);
  crowd.rotateX(-0.5);
  crowd.position.y = 7.4;
  g.add(crowd);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 14), new THREE.MeshLambertMaterial({ color: 0xd8dce4 }));
  roof.position.copy(base.position).y = 12;
  roof.quaternion.copy(base.quaternion);
  g.add(roof);
  return g;
}

let crowdTexCache = null;
function crowdTexture(rand) {
  if (crowdTexCache) return crowdTexCache;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b3140';
  ctx.fillRect(0, 0, 256, 64);
  const cols = ['#e8c05a', '#c0554d', '#5a86c9', '#67b06b', '#c9c9c9', '#9a67b0', '#e88a3a'];
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = cols[Math.floor(rand() * cols.length)];
    ctx.fillRect(Math.floor(rand() * 128) * 2, Math.floor(rand() * 32) * 2, 2, 2);
  }
  crowdTexCache = new THREE.CanvasTexture(c);
  return crowdTexCache;
}

function props(kind, curve, width, rand, clearOfTrack) {
  const g = new THREE.Group();
  const count = 90;
  const geoms = {
    buildings: () => new THREE.BoxGeometry(14 + rand() * 20, 20 + rand() * 70, 14 + rand() * 20),
    palms: () => new THREE.ConeGeometry(4, 10 + rand() * 6, 5),
    cacti: () => new THREE.CylinderGeometry(0.8, 1, 4 + rand() * 4, 5),
    pines: () => new THREE.ConeGeometry(3 + rand() * 2, 9 + rand() * 8, 6),
    rocks: () => new THREE.DodecahedronGeometry(2 + rand() * 3),
    peaks: () => new THREE.ConeGeometry(30 + rand() * 40, 60 + rand() * 90, 5),
    trees: () => new THREE.SphereGeometry(3 + rand() * 3, 6, 5),
  };
  const colors = { buildings: 0x5d6b7d, palms: 0x3f7d46, cacti: 0x4d7d3f, pines: 0x2f5d3a, rocks: 0x7d7d80, peaks: 0x8593a3, trees: 0x4a7a3d };
  const make = geoms[kind] || geoms.trees;
  for (let i = 0; i < count; i++) {
    const u = rand();
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    const dist = (kind === 'peaks' ? 180 : 30) + rand() * (kind === 'buildings' ? 120 : 160);
    const side = rand() > 0.5 ? 1 : -1;
    const pos = p.clone().addScaledVector(n, side * (width / 2 + dist));
    const clearance = kind === 'buildings' ? width / 2 + 26 : kind === 'peaks' ? width / 2 + 60 : width / 2 + 6;
    if (!clearOfTrack(pos, clearance)) continue;
    const mesh = new THREE.Mesh(make(), new THREE.MeshLambertMaterial({ color: colors[kind] || 0x4a7a3d }));
    mesh.position.copy(pos);
    mesh.position.y = mesh.geometry.parameters?.height ? mesh.geometry.parameters.height / 2 - 0.4 : 2;
    g.add(mesh);
  }
  return g;
}

function cornerUs(curve, count, rand) {
  const us = [];
  for (let i = 0; i < count; i++) us.push(rand());
  return us;
}

// Find "critical corners" (curvature maxima) for the cinematic camera chain.
// On a stage the chain runs from the start to the finish line, no wrap, and
// every mount is kept above the terrain.
function cinematicCorners(curve, frames, width, rand, stage) {
  const M = 240;
  const curvatures = [];
  for (let k = 0; k < M; k++) {
    const u0 = k / M, u1 = (k + 1) / M;
    if (stage && (u0 < stage.uStart || u1 > stage.uFinish)) continue;
    const t0 = curve.getTangentAt(u0), t1 = curve.getTangentAt(u1);
    curvatures.push({ u: u0, c: t0.angleTo(t1) });
  }
  // Local maxima with minimum spacing, always including the start straight.
  const sorted = curvatures.slice().sort((a, b) => b.c - a.c);
  const chosen = stage ? [stage.uStart + 0.01, stage.uFinish] : [0.995];
  const gap = (a, b) => stage ? Math.abs(a - b) : Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
  const maxN = stage ? 12 : 8, minGap = stage ? 0.05 : 0.07;
  for (const cand of sorted) {
    if (chosen.length >= maxN) break;
    if (chosen.every((u) => gap(u, cand.u) > minGap)) chosen.push(cand.u);
  }
  chosen.sort((a, b) => a - b);
  return chosen.map((u) => {
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    const side = rand() > 0.5 ? 1 : -1;
    const pos = p.clone().addScaledVector(n, side * (width / 2 + 9 + rand() * 14)).add(new THREE.Vector3(0, 5 + rand() * 6, 0));
    if (stage) pos.y = Math.max(pos.y, stage.heightAt(pos.x, pos.z) + 6);
    return { u, pos };
  });
}
