// The pit complex on the loop circuits: the lane that peels off the track
// before the start line and rejoins after it, the pit wall between them, a
// garage per team with its box markings and signage, the team control
// centres behind, and the crews that service the cars.
//
// Geometry lives in the track's own frame: the lane is a curve offset from
// the track over the script's pit span, so a car at pit fraction f (0 at the
// entry, 1 at the exit) sits at laneAt(f). The scene drives cars along it
// from the script's kinematics; this module only knows where things are.

import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../core/rng.js';
import { hasCrewFigures } from './models.js';
import { CrewRig, wheelGun, fuelCan, tyre, lollipop } from './crewRig.js';

const sstep = (a, b, x) => smoothstep(clamp((x - a) / (b - a), 0, 1));

function paint(geo, color, fn = null) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(color), cc = new THREE.Color(), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    cc.copy(c); if (fn) fn(p, cc);
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return geo;
}
const merge = (parts) => { const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false); g.computeVertexNormals(); return g; };

// Lane layout, metres from the track centreline outward on the pit side.
const LANE_W = 8;         // the lane itself (fast lane + box lane)
const WALL_GAP = 2.4;     // track edge to pit wall
export const BOX_PULL = 2.6;  // how far a car pulls off the lane centre into its box
const FAST_LANE = 1.35;   // ...and how far the other way the driving line sits

function signTexture(team, palette, colors) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = colors[2] || '#f2f2f2'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = colors[0]; g.fillRect(0, 0, 512, 14); g.fillRect(0, 82, 512, 14);
  const lum = new THREE.Color(colors[2] || '#f2f2f2'); const ink = 0.2126 * lum.r + 0.7152 * lum.g + 0.0722 * lum.b > 0.5 ? '#14161a' : '#f4f4f4';
  g.fillStyle = ink; g.font = '900 40px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(team.toUpperCase(), 256, 46);
  g.fillStyle = colors[1]; g.fillRect(24, 68, 464, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// Build the complex. `track` needs curve, width, uAt, frames; `script` the
// pit spec, teams and box assignments; `race` the field (for colours).
export function buildPits(track, script, race, rand) {
  const P = script.pit;
  const { curve, width } = track;
  const halfW = width / 2;
  const group = new THREE.Group();

  // Which side is the infield: the loop's centroid against the start's normal.
  const centroid = new THREE.Vector3();
  for (const f of track.frames) centroid.add(f.p);
  centroid.divideScalar(track.frames.length);
  const f0 = track.frames[0];
  const side = Math.sign(centroid.clone().sub(f0.p).dot(f0.normal)) || 1;

  // The lane: track frames over the span, pushed out over the entry and
  // exit ramps to the lane centreline.
  const laneOff = halfW + WALL_GAP + 0.4 + LANE_W / 2;
  const edge = halfW - 2.4; // where the lane leaves and rejoins the track: its inside lane
  const ramp = (f) => (f < 0.18 ? sstep(0, 0.18, f) : f > 0.82 ? 1 - sstep(0.82, 1, f) : 1);
  const K = 40;
  const lanePts = [];
  for (let k = 0; k <= K; k++) {
    const f = k / K;
    const u = track.uAt(P.dIn + f * P.span);
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    lanePts.push(p.clone().addScaledVector(n, side * lerp(edge, laneOff, ramp(f))));
  }
  const lane = new THREE.CatmullRomCurve3(lanePts, false, 'centripetal', 0.5);
  lane.arcLengthDivisions = 400;
  lane.updateArcLengths();
  // Frame on the lane at pit fraction f: point, tangent, and the normal
  // pointing toward the garages.
  const laneAt = (f) => {
    const u = clamp(f, 0, 1);
    const p = lane.getPointAt(u), t = lane.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(side);
    return { p, t, n };
  };
  // The lane has two lines: cars run down the fast lane, out toward the
  // wall, and swing in to the box line only around their own box. One line
  // would put a car driving past straight through one that is stopped.
  // In and out over the length of the braking zone, so a car is on the box
  // line only along its own box and runs past the others out in the lane.
  const swing = Math.min(0.42 * P.boxPitch, 16) / P.span;
  // ...in over the braking zone, out again more gently: a car pulling away
  // from its box takes a good twenty metres to be back on the driving line,
  // which is both how it looks and what gives anything coming down the lane
  // time to see it.
  const pullAt = (f, boxF) => sstep(boxF - swing, boxF - 0.1 * swing, f) * (1 - sstep(boxF + 0.1 * swing, boxF + 3 * swing, f));
  // Lateral offset from the lane centre (toward the garages is positive).
  const latAt = (f, boxF) => lerp(-FAST_LANE * ramp(f), BOX_PULL, boxF != null ? pullAt(f, boxF) : 0);
  // Where a car sits at pit fraction f.
  const carAt = (f, boxF) => {
    const L = laneAt(f);
    const pull = boxF != null ? pullAt(f, boxF) : 0;
    return { p: L.p.clone().addScaledVector(L.n, latAt(f, boxF)), t: L.t, n: L.n, pull };
  };
  // Where the lane sits across the track, in the track's own lane units, so
  // the scene can keep cars on the road clear of one peeling off or rejoining.
  const trackLaneAt = (f) => side * lerp(edge, laneOff, ramp(f));

  const parts = [];
  // --- lane surface with edge lines
  const strip = (from, to, y, color, k0 = 0, k1 = K) => {
    const pos = [];
    for (let k = k0; k < k1; k++) {
      const A = laneAt(k / K), B = laneAt((k + 1) / K);
      const a0 = A.p.clone().addScaledVector(A.n, from).setY(A.p.y + y), a1 = A.p.clone().addScaledVector(A.n, to).setY(A.p.y + y);
      const b0 = B.p.clone().addScaledVector(B.n, from).setY(B.p.y + y), b1 = B.p.clone().addScaledVector(B.n, to).setY(B.p.y + y);
      pos.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z, a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return paint(g, color);
  };
  parts.push(strip(-LANE_W / 2, LANE_W / 2, 0.06, 0x2c2c33));
  parts.push(strip(-LANE_W / 2 - 0.3, -LANE_W / 2, 0.07, 0xe8e8e8, Math.round(K * 0.12), Math.round(K * 0.9)));
  parts.push(strip(LANE_W / 2, LANE_W / 2 + 0.3, 0.07, 0xe8e8e8, Math.round(K * 0.12), Math.round(K * 0.9)));
  parts.push(strip(-0.1, 0.1, 0.07, 0xf2c94c, Math.round(K * 0.2), Math.round(K * 0.82))); // the fast-lane line
  // --- pit wall between the lane and the track, with stands on it
  for (let k = Math.round(K * 0.2); k < Math.round(K * 0.82); k++) {
    const A = laneAt(k / K), B = laneAt((k + 1) / K);
    const mid = A.p.clone().lerp(B.p, 0.5).addScaledVector(A.n, -(LANE_W / 2 + 0.6));
    const len = A.p.distanceTo(B.p) + 0.05;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), A.t);
    const wall = new THREE.BoxGeometry(len, 1.1, 0.35).applyQuaternion(q).translate(mid.x, mid.y + 0.55, mid.z);
    parts.push(paint(wall, 0x9a9ca3, (p, c) => { if (p.y > mid.y + 0.95) c.set(0xc0392b); }));
    if (k % 3 === 0) {
      const stand = new THREE.BoxGeometry(2.6, 0.12, 1.2).applyQuaternion(q).translate(mid.x, mid.y + 1.45, mid.z);
      parts.push(paint(stand, 0x3a3d44));
      const rail = new THREE.BoxGeometry(2.6, 0.05, 0.05).applyQuaternion(q).translate(mid.x, mid.y + 2.3, mid.z);
      parts.push(paint(rail, 0xaaaaaa));
      const screen = new THREE.BoxGeometry(0.9, 0.5, 0.05).applyQuaternion(q).translate(mid.x, mid.y + 2.0, mid.z);
      parts.push(paint(screen, 0x0b0d12));
    }
  }

  // --- garages and control centres, one per team
  const teams = script.teams;
  const boxSpan = P.boxPitch / P.span;   // one box per team, in front of its garage
  const garages = [];
  const signs = new THREE.Group();
  teams.forEach((team, j) => {
    const fC = P.boxFrom + j * boxSpan;                      // this team's box
    const L = laneAt(fC);
    const car0 = race.field.find((r) => r.team === team);
    const colors = car0 ? car0.colors : ['#888', '#444', '#ddd'];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), L.t);
    const at = (dx, dy, dz) => L.p.clone().addScaledVector(L.t, dx).addScaledVector(L.n, dz).setY(L.p.y + dy);
    const box = (w, h, d, dx, dy, dz, color, fn) => { const c = at(dx, dy, dz); parts.push(paint(new THREE.BoxGeometry(w, h, d).applyQuaternion(q).translate(c.x, c.y, c.z), color, fn)); };
    const GW = P.boxPitch - 1.2, GD = 9, GH = 5.4, front = LANE_W / 2 + 1.2;
    // apron between the lane and the garage
    box(GW + 1.2, 0.08, front - LANE_W / 2 + 0.6, 0, 0.04, (LANE_W / 2 + front) / 2, 0x3a3b40);
    // the box itself, marked out on the lane in front of the garage
    { const BW = Math.min(9, P.boxPitch - 3);
      box(0.12, 0.02, 5.6, -BW / 2, 0.075, LANE_W / 2 - 2.8, 0xf4f4f4);
      box(0.12, 0.02, 5.6, BW / 2, 0.075, LANE_W / 2 - 2.8, 0xf4f4f4);
      box(BW, 0.02, 0.12, 0, 0.075, LANE_W / 2 - 5.6, 0xf4f4f4);
    }
    // floor, walls, roof, header
    box(GW, 0.1, GD, 0, 0.05, front + GD / 2, 0x50535a);
    box(GW, GH, 0.3, 0, GH / 2, front + GD - 0.15, 0x8d9199);
    box(0.3, GH, GD, -GW / 2 + 0.15, GH / 2, front + GD / 2, 0x8d9199);
    box(0.3, GH, GD, GW / 2 - 0.15, GH / 2, front + GD / 2, 0x8d9199);
    box(GW + 0.6, 0.35, GD + 0.8, 0, GH + 0.1, front + GD / 2 - 0.2, 0xd8dce4, (p, c) => { if (p.y < L.p.y + GH + 0.05) c.multiplyScalar(0.75); });
    box(GW + 0.6, 0.9, 0.5, 0, GH - 0.45, front + 0.1, colors[0]);          // header in team colour
    box(GW, 1.6, GD - 0.6, 0, GH - 0.9, front + GD / 2 + 0.2, 0x111318);   // dark interior mass above
    // kit inside: tyre stacks and toolboxes
    for (const [dx, dz] of [[-GW / 2 + 1.2, 7.6], [-GW / 2 + 2.4, 7.6], [GW / 2 - 1.2, 7.6]]) {
      const c = at(dx, 0, front + dz);
      parts.push(paint(new THREE.CylinderGeometry(0.34, 0.34, 1.3, 10).translate(c.x, c.y + 0.65, c.z), 0x141618));
    }
    box(1.2, 0.9, 0.6, GW / 2 - 2.8, 0.45, front + 7.8, colors[0]);
    box(1.2, 0.9, 0.6, 0.6, 0.45, front + 8.0, 0x2a2d33);
    // the team sign over the door
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(GW - 1, 1.0), new THREE.MeshBasicMaterial({ map: signTexture(team, car0?.palette, colors) }));
    const sp = at(0, GH - 0.45, front - 0.16);
    sign.position.copy(sp);
    sign.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), L.n.clone().negate());
    signs.add(sign);
    // control centre behind: two storeys, a window band, dish and masts
    const CD = 8, CW = GW - 1, CH = 7.6, cz = front + GD + 1.5;
    box(CW, CH, CD, 0, CH / 2, cz + CD / 2, 0xb9bcc4);
    box(CW + 0.1, 1.3, CD + 0.1, 0, 5.2, cz + CD / 2, 0x1d2733);           // upper window band
    box(CW + 0.1, 1.0, CD + 0.1, 0, 2.4, cz + CD / 2, 0x1d2733);           // lower window band
    box(CW + 0.4, 0.3, CD + 0.4, 0, CH + 0.1, cz + CD / 2, colors[0]);      // roof trim
    box(CW, 0.5, 0.2, 0, CH - 0.6, cz + 0.05, colors[1]);
    { const c = at(CW / 2 - 1.6, CH + 0.2, cz + 2); parts.push(paint(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6).translate(c.x, c.y + 1.1, c.z), 0x6d7078)); }
    { const c = at(CW / 2 - 1.6, CH + 2.4, cz + 2); const dish = new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3).rotateX(Math.PI / 2 - 0.9).translate(c.x, c.y, c.z); parts.push(paint(dish, 0xe8ecf0)); }
    for (const dx of [-CW / 2 + 1, -CW / 2 + 2.2]) { const c = at(dx, CH + 0.2, cz + CD - 1.5); parts.push(paint(new THREE.CylinderGeometry(0.06, 0.08, 4.5, 5).translate(c.x, c.y + 2.25, c.z), 0x3a3d44)); }
    box(1.6, 0.9, 1.2, 0, CH + 0.75, cz + CD / 2, 0x8d9199);              // roof plant
    garages.push({ team, j, fC, colors, center: L.p.clone(), t: L.t.clone(), n: L.n.clone(), front, GD, GW, q });
  });

  group.add(new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))); // the strips wind either way depending on the infield side
  group.add(signs);

  // Anything scattered by the dressing must keep off the complex.
  const clearOfPits = (p, margin) => {
    for (let k = 0; k <= K; k += 2) {
      const q = lanePts[k];
      if (Math.hypot(p.x - q.x, p.z - q.z) < margin + 30) return false;
    }
    return true;
  };

  return { group, lane, side, edge, laneAt, carAt, pullAt, latAt, trackLaneAt, garages, clearOfPits, entry: laneAt(0), exit: laneAt(1), BOX_PULL };
}

// --- the crews ----------------------------------------------------------------
// One crew per garage, cast by the class: wheel gunners (mechanics) at every
// hub, tyre carriers (engineers) with the fresh rubber, a fuel man on the
// stock cars and bikes, and the chief on the lollipop. The scene hands a
// crew the stop that is due — when the car stops, where its wheels and
// fuel door will be, which car — and the crew plays it out: out of the
// garage on the run, down on the guns, the old wheel off and the new one
// on, the release, the wave, and the walk back. Times are relative to the
// car's arrival (0) and departure (D).

const RUN = 5.4, WALK = 2.1, STEP = 1.6; // m/s
const TYRE_R = { formula: 0.34, stock: 0.36, moto: 0.3 };
const CLEAR = 0.5;   // how far outside the bodywork a crew member walks

// --- keeping the crew out of the car ----------------------------------------
// The car in its box is an oriented rectangle, and a member crossing to the
// far side of it goes round an end rather than through the middle. Both
// ends of the walk are projected onto the rectangle's perimeter; whichever
// way round is shorter gives the corners to use as waypoints. The member
// aims at the first of them, so the path bends round the car as they go.
function carFrame(job) {
  return { c: job.center, f: job.forward, l: job.left, hw: job.halfW + CLEAR, hl: job.halfL + CLEAR };
}
const toLocal = (F, p) => ({ x: p.clone().sub(F.c).dot(F.l), z: p.clone().sub(F.c).dot(F.f) });
const toWorld = (F, x, z, y) => F.c.clone().addScaledVector(F.l, x).addScaledVector(F.f, z).setY(y);
const insideBox = (F, q) => Math.abs(q.x) < F.hw && Math.abs(q.z) < F.hl;

// Does the segment cross the rectangle? (a slab clip in the car's own frame)
function crossesBox(F, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  let t0 = 0, t1 = 1;
  const slab = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return slab(-dx, a.x + F.hw) && slab(dx, F.hw - a.x) && slab(-dz, a.z + F.hl) && slab(dz, F.hl - a.z) && t1 > t0;
}

// Distance round the perimeter to a point, anticlockwise from the near-side
// front corner. The four corners sit at 0, W, W+L and 2W+L.
function perimAt(F, q) {
  const W = 2 * F.hw, L = 2 * F.hl, e = 1e-6;
  const x = clamp(q.x, -F.hw, F.hw), z = clamp(q.z, -F.hl, F.hl);
  if (z >= F.hl - e) return F.hw - x;
  if (x <= -F.hw + e) return W + (F.hl - z);
  if (z <= -F.hl + e) return W + L + (x + F.hw);
  return 2 * W + L + (z + F.hl);
}

// The corner to head for on the way from a to b, and which way round it is.
// `keep` is the way round chosen last frame: held on to while it is still a
// way round, so the member commits to one side instead of dithering.
function roundTheCar(F, a, b, keep) {
  const W = 2 * F.hw, L = 2 * F.hl, P = 2 * (W + L);
  const corners = [[0, F.hw, F.hl], [W, -F.hw, F.hl], [W + L, -F.hw, -F.hl], [2 * W + L, F.hw, -F.hl]];
  const sA = perimAt(F, a), sB = perimAt(F, b);
  const cyc = (v) => ((v % P) + P) % P;
  const pick = (dir) => {
    const span = dir > 0 ? cyc(sB - sA) : cyc(sA - sB);
    const list = corners
      .map(([cp, cx, cz]) => [dir > 0 ? cyc(cp - sA) : cyc(sA - cp), cx, cz])
      .filter(([d]) => d < span)
      .sort((u, w) => u[0] - w[0]);
    let len = 0, px = a.x, pz = a.z;
    for (const [, cx, cz] of list) { len += Math.hypot(cx - px, cz - pz); px = cx; pz = cz; }
    len += Math.hypot(b.x - px, b.z - pz);
    return { len, list, dir };
  };
  const plus = pick(1), minus = pick(-1);
  let route = plus.len <= minus.len ? plus : minus;
  if (keep && keep !== route.dir) { const held = keep > 0 ? plus : minus; if (held.len < route.len * 1.6) route = held; }
  // stand off the corners themselves, so the path rounds them instead of clipping
  return { pts: route.list.map(([, cx, cz]) => [cx + Math.sign(cx) * 0.2, cz + Math.sign(cz) * 0.2]), dir: route.dir };
}

export class PitCrews {
  constructor(scene, pits, race, wheelCount) {
    this.crews = [];
    this.ok = hasCrewFigures();
    if (!this.ok) return;
    this.pits = pits;
    this.vehicle = race.tour.vehicle;
    this.tmp = new THREE.Vector3();
    this.scratch = new THREE.Vector3();
    // the cast, per garage
    const cast = [];
    if (this.vehicle === 'formula') { for (let k = 0; k < 4; k++) cast.push({ kind: 'gun', role: 'mechanic', wheels: [k] }); for (let k = 0; k < 4; k++) cast.push({ kind: 'carry', role: 'engineer', wheels: [k] }); }
    else if (this.vehicle === 'stock') { cast.push({ kind: 'gun', role: 'mechanic', wheels: ['RF', 'LF'] }, { kind: 'gun', role: 'mechanic', wheels: ['RR', 'LR'] }, { kind: 'carry', role: 'engineer', wheels: ['RF', 'LF'] }, { kind: 'carry', role: 'engineer', wheels: ['RR', 'LR'] }, { kind: 'fuel', role: 'engineer' }); }
    else { for (let k = 0; k < Math.min(2, wheelCount); k++) cast.push({ kind: 'gun', role: 'mechanic', wheels: [k] }); cast.push({ kind: 'fuel', role: 'engineer' }); }
    cast.push({ kind: 'chief', role: 'chief' });
    for (const g of pits.garages) {
      const members = [];
      const first = race.field.find((r) => r.team === g.team);
      cast.forEach((c, k) => {
        const rig = new CrewRig(c.role, g.colors, first ? first.number : null);
        if (!rig.ok) return;
        // home spots: two rows inside the garage, facing the lane
        const home = g.center.clone().addScaledVector(g.t, (k - (cast.length - 1) / 2) * 1.05).addScaledVector(g.n, g.front + 3.4 + (k % 2) * 1.3);
        rig.root.position.copy(home);
        const faceHome = g.n.clone().negate();
        rig.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceHome);
        scene.add(rig.root);
        // props
        if (c.kind === 'gun') rig.attach('gun', wheelGun(new THREE.Color(g.colors[0])), 'RightHand', new THREE.Vector3(0, 0.02, 0.04), new THREE.Euler(0, 0, 0), 'RightHand');
        if (c.kind === 'carry') rig.attach('tyre', tyre(TYRE_R[this.vehicle] || 0.33, this.vehicle === 'moto' ? 0.16 : 0.3), 'Spine2', new THREE.Vector3(0, 0.12, 0.42), new THREE.Euler(Math.PI / 2, 0, 0));
        if (c.kind === 'fuel') rig.attach('can', fuelCan(new THREE.Color(g.colors[1])), 'LeftHand', new THREE.Vector3(0.04, 0.06, 0.02), new THREE.Euler(0, 0, 0), 'LeftHand');
        if (c.kind === 'chief') rig.attach('paddle', lollipop(new THREE.Color(g.colors[0])), 'RightHand', new THREE.Vector3(0, 0.02, 0), new THREE.Euler(0, 0, 0), 'RightHand');
        rig.showProp('tyre', c.kind === 'carry'); rig.showProp('gun', c.kind === 'gun'); rig.showProp('can', c.kind === 'fuel'); rig.showProp('paddle', c.kind === 'chief');
        rig.setPose(c.kind === 'chief' ? 'watch' : 'stand');
        members.push({ rig, kind: c.kind, wheels: c.wheels, home, pos: home.clone(), face: faceHome.clone(), faceHome, phase: (k * 1.7) % 6.28, tyreOn: c.kind === 'carry', backed: false });
      });
      this.crews.push({ garage: g, members, job: null });
    }
  }

  // job: see RaceScene.pitJob — { carIdx, number, tArrive, tLeave, wheels:[{hub, ground, out, front, mesh, restX, outSign, tag}], forward, fuel:{p,out}, chief, chiefLook }
  setJob(garageIdx, job) {
    if (!this.ok) return;
    const crew = this.crews[garageIdx];
    if (crew.job && crew.job !== job) this.restoreWheels(crew.job);
    crew.job = job;
    for (const m of crew.members) { m.rig.setNumber(job ? job.number : m.rig.number); m.backed = false; if (m.kind === 'carry') { m.tyreOn = true; m.rig.showProp('tyre', true); } }
  }
  restoreWheels(job) { for (const w of job.wheels) if (w.mesh) w.mesh.position.x = w.restX; }

  // Where a member waits while the car is not yet in the box, and steps back
  // to once it has gone: their own spot when that is on the garage side of
  // the car, else level with where the nose will be. The lane behind the box
  // is the car's own way in, and the fast lane beside it is where the rest
  // of the field goes past — neither is a place to stand.
  stageSpot(job, spot) {
    const d = this.scratch.copy(spot).sub(job.center);
    const x = d.dot(job.left), z = d.dot(job.forward);
    if (x * job.garageSide > 0 || z > job.halfL) return spot;
    return job.center.clone().addScaledVector(job.left, x).addScaledVector(job.forward, job.halfL + 1.7).setY(spot.y);
  }

  // Steer round the car rather than through it: while it is in the box, a
  // member whose straight line would cross it aims at the corner they are
  // going round instead.
  aimAt(m, job, want, solid) {
    if (!solid) { m.round = 0; return want; }
    const F = carFrame(job);
    const a = toLocal(F, m.pos), b = toLocal(F, want);
    if (insideBox(F, a) || insideBox(F, b) || !crossesBox(F, a, b)) { m.round = 0; return want; }
    const w = roundTheCar(F, a, b, m.round);
    m.round = w.dir;
    // the first corner still ahead of them; standing on one is not a stop
    for (const [cx, cz] of w.pts) if (Math.hypot(cx - a.x, cz - a.z) > 0.5) return toWorld(F, cx, cz, want.y);
    return want;
  }

  // The wheel a member is on at this moment (the stock crews do the right
  // side first, then run round to the left).
  wheelFor(m, job, a, D) {
    const list = m.wheels.map((tag) => (typeof tag === 'number' ? job.wheels[tag] : job.wheels.find((w) => w.tag === tag))).filter(Boolean);
    if (!list.length) return null;
    if (list.length === 1) return { w: list[0], seg: [0, 1] };
    const half = a < 0.5 * D;
    return { w: half ? list[0] : list[1], seg: half ? [0, 0.47] : [0.53, 1] };
  }

  update(t, dt) {
    if (!this.ok) return;
    for (const crew of this.crews) {
      const job = crew.job;
      const D = job ? job.tLeave - job.tArrive : 1;
      const a = job ? t - job.tArrive : -Infinity;
      for (const m of crew.members) {
        const rig = m.rig;
        let want = m.home, face = m.faceHome, pose = m.kind === 'chief' ? 'watch' : 'stand', speed = WALK, work = null;
        if (job && a >= -3.4 && a < D + 6) {
          const fwd = job.forward, back = fwd.clone().negate();
          if (m.kind === 'gun' || m.kind === 'carry') {
            const wf = this.wheelFor(m, job, a, D);
            if (wf) {
              const { w, seg } = wf;
              const s0 = seg[0] * D, s1 = seg[1] * D;
              const gunSpot = w.ground.clone().addScaledVector(w.out, 0.8);
              const carrySpot = w.ground.clone().addScaledVector(w.out, 1.05).addScaledVector(w.front ? fwd : back, 0.95);
              const toHub = w.hub.clone().sub(gunSpot).setY(0).normalize();
              // where this one waits and retreats to, and which way they step
              // off the car: outboard on the garage side, forward on the far one
              const gunClear = this.stageSpot(job, gunSpot), carryClear = this.stageSpot(job, carrySpot);
              const off = gunClear === gunSpot ? w.out : fwd;
              if (m.kind === 'gun') {
                if (a < 0) { want = gunClear; face = a < -1.2 ? toHub : job.forward.clone().negate(); pose = 'ready'; speed = RUN; }
                else if (a < s1 && a >= s0) {
                  want = gunSpot; face = toHub; speed = RUN;
                  const local = (a - s0) / Math.max(0.01, s1 - s0);
                  const on = local < 0.34 || local > 0.72;      // loosen, then tighten after the swap
                  pose = on ? 'gun' : 'gunUp';
                  if (on) work = { lugs: this.vehicle === 'formula' ? 1 : 5 };
                } else if (a < D) { want = gunSpot; face = toHub; pose = 'gunUp'; speed = RUN; }
                else if (a < D + 0.8) { want = gunSpot.clone().addScaledVector(off, 0.9); face = toHub; pose = 'release'; speed = STEP; }
                else if (a < D + 2.6) { want = gunClear; face = fwd; pose = 'watch'; speed = RUN; }
              } else {
                // the carrier: waits with the fresh tyre, steps in for the swap, carries the old one off
                const local = (a - s0) / Math.max(0.01, s1 - s0);
                const swap = a >= s0 && a < s1 && local >= 0.34 && local < 0.72;
                if (a < 0) { want = carryClear; face = a < -1.2 ? toHub : job.forward.clone().negate(); pose = 'carry'; speed = RUN; }
                else if (a < s0 || (a >= s0 && a < s1 && local < 0.34)) { want = carrySpot; face = toHub; pose = 'carry'; speed = RUN; }
                else if (swap) {
                  const x = (local - 0.34) / 0.38; // 0..1 through the swap
                  want = w.ground.clone().addScaledVector(w.out, 0.95); face = toHub; pose = 'wheel'; speed = RUN;
                  // the old wheel out, the new one on: the car's own wheel mesh slides
                  const slide = x < 0.5 ? sstep(0.05, 0.4, x) : 1 - sstep(0.55, 0.95, x);
                  if (w.mesh) w.mesh.position.x = w.restX + w.outSign * 0.34 * slide;
                  const on = x < 0.5; if (m.tyreOn !== on) { m.tyreOn = on; rig.showProp('tyre', on); }
                } else if (a < D) { want = carrySpot; face = toHub; pose = 'carry'; speed = STEP; if (!m.tyreOn) { m.tyreOn = true; rig.showProp('tyre', true); } }
                else if (a < D + 2.6) { want = carryClear; face = fwd; pose = 'carry'; speed = RUN; }
              }
            }
          } else if (m.kind === 'fuel' && job.fuel) {
            const spot = job.fuel.p.clone().addScaledVector(job.fuel.out, 0.8);
            const toDoor = job.fuel.out.clone().negate();
            if (a < D * 0.92) { want = spot; face = toDoor; pose = a < -0.3 ? 'ready' : 'fuel'; speed = RUN; }
            else if (a < D + 2.6) { want = spot.clone().addScaledVector(job.fuel.out, 0.9); face = a < D ? toDoor : fwd; pose = a < D ? 'stand' : 'watch'; speed = STEP; }
          } else if (m.kind === 'chief') {
            if (a < D) { want = job.chief; face = job.chiefLook.clone().sub(job.chief).setY(0).normalize(); pose = 'chief'; speed = RUN; }
            else if (a < D + 3.2) { want = job.chief; face = fwd; pose = 'chiefDown'; speed = STEP; }
          }
        }
        // move toward the spot at this act's pace, round the car if it is in
        // the way; the run clip fades in with the speed
        const solid = !!job && a >= -0.45 && a <= D + 0.45;
        const aim = solid ? this.aimAt(m, job, want, solid) : want;
        const d = this.tmp.copy(aim).sub(m.pos).setY(0);
        const dist = d.length();
        let moving = 0;
        if (dist > 0.03) {
          const stepLen = Math.min(dist, speed * dt);
          m.pos.addScaledVector(d, stepLen / dist);
          m.pos.y = want.y;
          moving = stepLen / Math.max(dt, 1e-3);
          this.turn(m, d, dt);
          if (moving > 1.0) pose = m.kind === 'carry' ? 'carry' : 'stand';
        } else if (aim === want) {
          m.pos.copy(want);
          this.turn(m, face, dt);
        }
        // Last word on it: nobody stands in the bodywork. The routing above
        // keeps them out of it; this catches the corners it cannot, and
        // slides them to the nearest way out.
        if (solid) {
          const F = carFrame(job), q = toLocal(F, m.pos);
          if (insideBox(F, q)) {
            const dx = F.hw - Math.abs(q.x), dz = F.hl - Math.abs(q.z);
            if (dx < dz) m.pos.addScaledVector(job.left, Math.sign(q.x || 1) * dx);
            else m.pos.addScaledVector(job.forward, Math.sign(q.z || 1) * dz);
          }
        }
        rig.root.position.copy(m.pos);
        rig.setPose(pose);
        rig.work = work;
        rig.noise = work ? 0.3 : 1;
        rig.update(dt, t + m.phase, moving);
      }
      if (job && t > job.tLeave + 6.5) { this.restoreWheels(job); crew.job = null; }
    }
  }

  // Ease the facing round toward a direction.
  turn(m, dir, dt) {
    if (dir.lengthSq() < 1e-6) return;
    const target = dir.clone().setY(0).normalize();
    m.face.lerp(target, 1 - Math.exp(-7 * dt)).normalize();
    m.rig.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.face);
  }
}
