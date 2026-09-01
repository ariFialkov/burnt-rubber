// Procedural circuits. Each (tour style, track) seed produces a closed spline
// scaled to the script's lap length, plus road ribbon, curbs, start gantry,
// grandstands, and environment dressing per location vibe.

import * as THREE from 'three';
import { rngFor } from '../core/rng.js';

const ENV_THEMES = {
  city:     { ground: 0x3a4149, sky: 0x87a6c4, fog: 0x9db4cb, props: 'buildings' },
  coast:    { ground: 0x8a9a6b, sky: 0x8fc9e8, fog: 0xb8dcef, props: 'palms', water: true },
  desert:   { ground: 0xc9a86a, sky: 0xf2c894, fog: 0xe8c9a0, props: 'cacti' },
  forest:   { ground: 0x4c6b3c, sky: 0x9fc4e0, fog: 0xb5cfe0, props: 'pines' },
  tundra:   { ground: 0x9aa8a6, sky: 0xb9c8d4, fog: 0xcfd9e0, props: 'rocks' },
  mountain: { ground: 0x6b7a5e, sky: 0x9db8d8, fog: 0xb8c8dc, props: 'peaks' },
  plains:   { ground: 0x7d9455, sky: 0xa2cceb, fog: 0xc3ddf0, props: 'trees' },
};

const ROAD_WIDTH = { formula: 13, stock: 19, rally: 14, baja: 26, moto: 11 };

function controlPoints(style, rand) {
  const pts = [];
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

export function buildTrack(race, script) {
  const rand = rngFor('track-v1', race.trackSeed);
  const style = race.tour.style;
  const theme = ENV_THEMES[race.track.env] || ENV_THEMES.plains;
  const width = ROAD_WIDTH[race.tour.vehicle] || 12;

  const pts = controlPoints(style, rand);
  // Gentle elevation for rally/baja so the horizon moves.
  if (style === 'rally' || style === 'baja') {
    pts.forEach((p, i) => { p.y = 4 * Math.sin(i * 1.7 + rand() * 6) + 4; });
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.6);

  // Scale so lap length matches the race script exactly (speeds line up).
  const scale = script.lapLen / curve.getLength();
  pts.forEach((p) => { p.x *= scale; p.z *= scale; p.y *= scale; });
  curve.updateArcLengths();

  const group = new THREE.Group();
  const N = 700;
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
    group.add(ribbon(frames, -width / 2 - 1, -width / 2, 0.04, 0xa89f8c));
    group.add(ribbon(frames, width / 2, width / 2 + 1, 0.04, 0xa89f8c));
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

  // Start/finish: checkered strip + gantry
  const sf = frames[0];
  const check = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 2, 5),
    new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide })
  );
  check.rotateX(-Math.PI / 2);
  check.position.copy(sf.p).y += 0.1;
  check.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sf.tangent));
  check.rotateX(-Math.PI / 2);
  group.add(check);
  group.add(gantry(sf, width, race.tour.accent));

  // Keep props and stands off every part of the looping road.
  const clearOfTrack = (p, margin) => {
    for (let k = 0; k < frames.length; k += 6) {
      const f = frames[k].p;
      const dx = p.x - f.x, dz = p.z - f.z;
      if (dx * dx + dz * dz < margin * margin) return false;
    }
    return true;
  };

  // Grandstands near the start and at two corners
  const standSpots = [0.985, 0.03, ...cornerUs(curve, 2, rand)];
  for (const u of standSpots) {
    const stand = grandstand(curve, u, width, rand, clearOfTrack);
    if (stand) group.add(stand);
  }

  // Ground + environment dressing
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

  const corners = cinematicCorners(curve, frames, width, rand);
  return { group, curve, frames, width, theme, corners };
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
function cinematicCorners(curve, frames, width, rand) {
  const M = 240;
  const curvatures = [];
  for (let k = 0; k < M; k++) {
    const u0 = k / M, u1 = (k + 1) / M;
    const t0 = curve.getTangentAt(u0), t1 = curve.getTangentAt(u1);
    curvatures.push({ u: u0, c: t0.angleTo(t1) });
  }
  // Local maxima with minimum spacing, always including the start straight.
  const sorted = curvatures.slice().sort((a, b) => b.c - a.c);
  const chosen = [0.995];
  for (const cand of sorted) {
    if (chosen.length >= 8) break;
    if (chosen.every((u) => Math.min(Math.abs(u - cand.u), 1 - Math.abs(u - cand.u)) > 0.07)) chosen.push(cand.u);
  }
  chosen.sort((a, b) => a - b);
  return chosen.map((u) => {
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    const side = rand() > 0.5 ? 1 : -1;
    return {
      u,
      pos: p.clone().addScaledVector(n, side * (width / 2 + 9 + rand() * 14)).add(new THREE.Vector3(0, 5 + rand() * 6, 0)),
    };
  });
}
