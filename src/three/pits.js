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
import { buildCrewFigure, hasCrewFigures } from './models.js';

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
const BOX_PULL = 2.6;     // how far a car pulls off the lane centre into its box

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
  // Where a car sits at pit fraction f: on the lane centre, pulled into its
  // box around its own box fraction.
  const pullAt = (f, boxF) => sstep(boxF - 0.11, boxF - 0.025, f) * (1 - sstep(boxF + 0.025, boxF + 0.1, f));
  const carAt = (f, boxF) => {
    const L = laneAt(f);
    const pull = boxF != null ? pullAt(f, boxF) : 0;
    return { p: L.p.clone().addScaledVector(L.n, BOX_PULL * pull), t: L.t, n: L.n, pull };
  };

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
  const boxSpan = P.boxPitch / P.span;
  const garages = [];
  const signs = new THREE.Group();
  teams.forEach((team, j) => {
    const fC = P.boxFrom + (2 * j + 0.5) * boxSpan;          // this team's two boxes are centred here
    const L = laneAt(fC);
    const car0 = race.field.find((r) => r.team === team);
    const colors = car0 ? car0.colors : ['#888', '#444', '#ddd'];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), L.t);
    const at = (dx, dy, dz) => L.p.clone().addScaledVector(L.t, dx).addScaledVector(L.n, dz).setY(L.p.y + dy);
    const box = (w, h, d, dx, dy, dz, color, fn) => { const c = at(dx, dy, dz); parts.push(paint(new THREE.BoxGeometry(w, h, d).applyQuaternion(q).translate(c.x, c.y, c.z), color, fn)); };
    const GW = 2 * P.boxPitch - 0.6, GD = 9, GH = 5.4, front = LANE_W / 2 + 1.2;
    // apron between the lane and the garage
    box(GW + 1.2, 0.08, front - LANE_W / 2 + 0.6, 0, 0.04, (LANE_W / 2 + front) / 2, 0x3a3b40);
    // box markings on the lane: an outline per spot
    for (const s of [-1, 1]) {
      const cx = s * P.boxPitch / 2;
      box(0.12, 0.02, 5.6, cx - P.boxPitch / 2 + 0.4, 0.075, LANE_W / 2 - 2.8, 0xf4f4f4);
      box(0.12, 0.02, 5.6, cx + P.boxPitch / 2 - 0.4, 0.075, LANE_W / 2 - 2.8, 0xf4f4f4);
      box(P.boxPitch - 0.8, 0.02, 0.12, cx, 0.075, LANE_W / 2 - 5.6, 0xf4f4f4);
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

  group.add(new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true })));
  group.add(signs);

  // Anything scattered by the dressing must keep off the complex.
  const clearOfPits = (p, margin) => {
    for (let k = 0; k <= K; k += 2) {
      const q = lanePts[k];
      if (Math.hypot(p.x - q.x, p.z - q.z) < margin + 30) return false;
    }
    return true;
  };

  return { group, lane, side, edge, laneAt, carAt, pullAt, garages, clearOfPits, entry: laneAt(0), exit: laneAt(1), BOX_PULL };
}

// --- the crews ----------------------------------------------------------------
// One crew per garage: a mechanic per wheel plus a chief. Each figure is a
// stand / stride / kneel flipbook with live arm joints. The scene tells a
// crew when its team's car is due at the box and where its wheels will be;
// the crew runs out, kneels and works, steps back, waves it off, and walks
// home. Times are relative to the car's box arrival (0) and departure (D).
export class PitCrews {
  constructor(scene, pits, race, wheelCount) {
    this.crews = [];
    this.ok = hasCrewFigures();
    if (!this.ok) return;
    this.pits = pits;
    for (const g of pits.garages) {
      const members = [];
      const count = wheelCount + 1;
      for (let k = 0; k < count; k++) {
        const fig = buildCrewFigure(g.colors);
        // home spots: a line inside the garage, facing the lane
        const home = g.center.clone().addScaledVector(g.t, (k - (count - 1) / 2) * 1.1).addScaledVector(g.n, g.front + 3.5 + (k % 2) * 1.2);
        fig.position.copy(home);
        fig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), g.n.clone().negate());
        scene.add(fig);
        members.push({ fig, home, pose: 'stand', phase: (k * 1.7) % 6.28, isChief: k === count - 1, pos: home.clone(), face: g.n.clone().negate(), faceHome: g.n.clone().negate() });
      }
      this.crews.push({ garage: g, members, job: null });
    }
    this.tmp = new THREE.Vector3();
  }

  // job: { tArrive, tLeave, wheels: [Vector3 world], lookAt: [Vector3], chief: Vector3, chiefLook: Vector3, forward: Vector3 } or null
  setJob(garageIdx, job) { if (this.ok) this.crews[garageIdx].job = job; }

  showPose(m, pose) {
    if (m.pose === pose) return;
    m.pose = pose;
    for (const [name, fig] of Object.entries(m.fig.userData.poses)) fig.visible = name === pose;
  }
  arms(m, pose, fn) {
    const fig = m.fig.userData.poses[pose];
    if (!fig) return;
    const L = fig.getObjectByName('arm_l'), R = fig.getObjectByName('arm_r'), FL = fig.getObjectByName('fore_l'), FR = fig.getObjectByName('fore_r');
    fn(L, R, FL, FR);
  }
  face(m, dir) {
    if (dir.lengthSq() < 1e-6) return;
    m.face.lerp(dir.clone().setY(0).normalize(), 0.25).normalize();
    m.fig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.face);
  }

  update(t, dt) {
    if (!this.ok) return;
    for (const crew of this.crews) {
      const job = crew.job;
      crew.members.forEach((m, k) => {
        const fig = m.fig;
        // What this member wants: where to be, what to do there. Movement
        // is by speed, not by clock, so a job handed over mid-stop (the
        // team-mate double-stacking) just sends everyone to the new spots.
        let want = m.home, act = 'idle', speed = 2.6, faceDir = null;
        if (job) {
          const a = t - job.tArrive;              // seconds since the car stopped (negative: on its way)
          const D = job.tLeave - job.tArrive;
          const target = m.isChief ? job.chief : job.wheels[k % job.wheels.length];
          const look = m.isChief ? job.chiefLook : job.lookAt[k % job.lookAt.length];
          const outward = m.isChief ? job.forward.clone().negate() : target.clone().sub(look).setY(0).normalize();
          if (a >= -2.6 && a < 0) { want = target; act = 'ready'; speed = 6.5; faceDir = look.clone().sub(target); }
          else if (a >= 0 && a < D) { want = target; act = m.isChief ? 'paddle' : 'work'; speed = 6.5; faceDir = look.clone().sub(target); }
          else if (a >= D && a < D + 0.9) { want = target.clone().addScaledVector(outward, 1.4); act = 'back'; speed = 1.8; faceDir = look.clone().sub(want); }
          else if (a >= D + 0.9 && a < D + 3.4) { want = target.clone().addScaledVector(outward, 1.4); act = 'wave'; speed = 1.8; faceDir = job.forward; }
        }
        // move toward the spot at this act's pace
        const d = this.tmp.copy(want).sub(m.pos).setY(0);
        const dist = d.length();
        if (dist > 0.04) {
          const stepLen = Math.min(dist, speed * dt);
          m.pos.addScaledVector(d, stepLen / dist);
          m.pos.y = want.y;
          fig.position.copy(m.pos);
          this.run(m, t, d, speed > 4 ? 8 : 5);
          if (act === 'back') { this.showPose(m, Math.floor(t * 6) % 2 ? 'stride' : 'stand'); if (faceDir) this.face(m, faceDir); }
          return;
        }
        m.pos.copy(want);
        fig.position.copy(m.pos);
        if (act === 'idle') { this.idle(m, t); return; }
        if (faceDir) this.face(m, faceDir);
        if (act === 'ready' || act === 'back') { this.showPose(m, 'stand'); this.armsHang(m, 'stand', t); return; }
        if (act === 'paddle') {
          this.showPose(m, 'stand');
          this.arms(m, 'stand', (L, R, FL, FR) => { if (R) R.rotation.set(-2.9, 0, 0); if (FR) FR.rotation.set(-0.2, 0, 0); if (L) L.rotation.set(0.1, 0, 0); if (FL) FL.rotation.set(-0.3, 0, 0); });
          return;
        }
        if (act === 'work') {
          // kneeling at the wheel, arms pumping on the gun
          this.showPose(m, 'kneel');
          const w = Math.sin(t * 31 + m.phase);
          this.arms(m, 'kneel', (L, R, FL, FR) => { if (R) R.rotation.set(-1.0 + 0.25 * w, 0, 0); if (FR) FR.rotation.set(-0.9 - 0.35 * w, 0, 0); if (L) L.rotation.set(-0.9 - 0.2 * w, 0, 0); if (FL) FL.rotation.set(-1.0 + 0.3 * w, 0, 0); });
          fig.position.y = want.y + 0.02 * Math.abs(w);
          return;
        }
        if (act === 'wave') {
          this.showPose(m, 'stand');
          const w = Math.sin(t * 9 + m.phase);
          this.arms(m, 'stand', (L, R, FL, FR) => { if (R) R.rotation.set(-2.7, 0, 0.3); if (FR) FR.rotation.set(-0.5 + 0.35 * w, 0, 0.35 * w); if (L) L.rotation.set(0.15, 0, 0); if (FL) FL.rotation.set(-0.3, 0, 0); });
        }
      });
      if (job && t > job.tLeave + 6.5) crew.job = null;
    }
  }
  idle(m, t) {
    m.fig.position.copy(m.pos);
    this.showPose(m, 'stand');
    this.face(m, m.faceHome);
    this.armsHang(m, 'stand', t, 0.06);
  }
  armsHang(m, pose, t, amp = 0.04) {
    const w = Math.sin(t * 1.3 + m.phase) * amp;
    this.arms(m, pose, (L, R, FL, FR) => { if (L) L.rotation.set(w, 0, 0); if (R) R.rotation.set(-w, 0, 0); if (FL) FL.rotation.set(-0.15, 0, 0); if (FR) FR.rotation.set(-0.15, 0, 0); });
  }
  run(m, t, dir, hz = 8) {
    this.face(m, dir);
    this.showPose(m, Math.floor(t * hz) % 2 ? 'stride' : 'stand');
    const w = Math.sin(t * hz * Math.PI);
    m.fig.position.y = m.pos.y + 0.05 * Math.abs(w);
    for (const pose of ['stand', 'stride']) this.arms(m, pose, (L, R, FL, FR) => { if (L) L.rotation.set(0.8 * w, 0, 0); if (R) R.rotation.set(-0.8 * w, 0, 0); if (FL) FL.rotation.set(-1.2, 0, 0); if (FR) FR.rotation.set(-1.2, 0, 0); });
  }
}
