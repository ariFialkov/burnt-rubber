// The five broadcast cameras. All modes are damped so cuts feel operated,
// not teleported.

import * as THREE from 'three';
import { clamp } from '../core/rng.js';
import { cockpitFor } from './cockpit.js';

export const CAMERA_MODES = [
  { id: 'chase', label: '3rd Person', icon: '🎥' },
  { id: 'cockpit', label: 'Driver', icon: '🪖' },
  { id: 'hood', label: 'Hood Back', icon: '🔙' },
  { id: 'cine', label: 'Cinematic', icon: '🎬' },
  { id: 'chopper', label: 'Chopper', icon: '🚁' },
];

export class CameraRig {
  constructor(aspect) {
    // Near plane close enough for a steering wheel half a metre from the eye.
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.25, 6000);
    this.mode = 'chopper';
    this.carIdx = 0;
    this.lookTarget = new THREE.Vector3();
    this.posTarget = new THREE.Vector3(0, 120, 160);
    this.smoothLook = new THREE.Vector3();
    this.fovTarget = 60;
    this.orbitA = 0;
    this.cineCorner = null; // {u, pos, triggerDist}
    this.snap = true;
  }

  setMode(mode, carIdx = this.carIdx) {
    if (mode !== this.mode || carIdx !== this.carIdx) this.snap = true;
    this.mode = mode;
    this.carIdx = carIdx;
    if (mode === 'cine') this.cineCorner = null;
  }

  update(rs, dt) {
    const cam = this.camera;
    const car = rs.cars[clamp(this.carIdx, 0, rs.cars.length - 1)];
    const leader = rs.cars[rs.leaderIdx];
    const up = new THREE.Vector3(0, 1, 0);
    let pos = this.posTarget, look = this.lookTarget, fov = 60;
    let stiff = 6;

    const h = car.height || 2.2, len = car.length || 4.8;
    const eye = car.eye || { y: h * 0.75, z: len * 0.05 };
    const followed = clamp(this.carIdx, 0, rs.cars.length - 1);
    const onboard = this.mode === 'chase' || this.mode === 'cockpit' || this.mode === 'hood';
    rs.setSeeThrough?.(this.mode === 'cockpit' ? followed : -1);
    rs.setCockpit?.(this.mode === 'cockpit' ? followed : -1);
    // The followed car's own number board would sit right in the lens.
    for (let i = 0; i < rs.cars.length; i++) {
      const show = !(onboard && i === followed);
      rs.cars[i].sprite.visible = show;
      if (rs.cars[i].posSprite) rs.cars[i].posSprite.visible = show;
    }
    if (this.mode === 'chase') {
      pos = car.pos.clone().addScaledVector(car.tangent, -(3.5 + len * 0.95)).addScaledVector(up, 1.3 + h * 0.95);
      look = car.pos.clone().addScaledVector(car.tangent, 7).addScaledVector(up, h * 0.55);
      fov = 62; stiff = 8;
    } else if (this.mode === 'cockpit') {
      // The driver's eyes, in the car's own frame — so the view rolls and
      // pitches with the body and leans with the bike.
      const C = cockpitFor(rs.race.tour.vehicle);
      car.group.updateMatrixWorld();
      pos = car.group.localToWorld(new THREE.Vector3(C.eye.x, C.eye.y, C.eye.z));
      look = car.group.localToWorld(new THREE.Vector3(C.eye.x, C.eye.y - C.look.down * 30, C.eye.z + 30));
      fov = 72; stiff = 30;
    } else if (this.mode === 'hood') {
      // Reverse angle: a boom out ahead of the nose, above hood height,
      // looking back over the car at whoever is chasing it.
      pos = car.pos.clone().addScaledVector(car.tangent, len * 0.5 + 2.4).addScaledVector(up, h * 1.15 + 0.5);
      look = car.pos.clone().addScaledVector(car.tangent, -7).addScaledVector(up, h * 0.45);
      fov = 66; stiff = 30;
    } else if (this.mode === 'cine') {
      this.updateCine(rs, leader);
      pos = this.cineCorner ? this.cineCorner.pos : new THREE.Vector3(0, 40, 120);
      look = leader.pos.clone().addScaledVector(up, 1);
      const d = pos.distanceTo(look);
      fov = clamp(2600 / Math.max(d, 1), 20, 58);
      stiff = 5; // slow pan like a mounted operator
    } else if (this.mode === 'pit' && rs.pits && car.pit) {
      ({ pos, look, fov } = this.pitShot(rs, car));
      stiff = 40;
    } else { // chopper
      this.orbitA += dt * 0.06;
      const alt = clamp(26 + rs.spread * 0.45, 32, 170);
      const radius = alt * 0.9;
      pos = rs.centroid.clone().add(new THREE.Vector3(Math.cos(this.orbitA) * radius, alt, Math.sin(this.orbitA) * radius));
      look = rs.centroid.clone();
      fov = 52; stiff = 2.2;
    }
    // Terrain under a stage: never fly the chopper into a ridge.
    if (rs.track.heightAt && !onboard) pos.y = Math.max(pos.y, rs.track.heightAt(pos.x, pos.z) + (this.mode === 'cine' ? 4 : 18));

    const k = this.snap ? 1 : 1 - Math.exp(-stiff * dt);
    const kl = this.snap ? 1 : 1 - Math.exp(-Math.max(stiff, 6) * dt);
    // The cine cam is bolted down, and the onboard mounts are rigid: any lag
    // there would leave the camera trailing metres behind the car at speed.
    const rigid = this.mode === 'cine' || this.mode === 'cockpit' || this.mode === 'hood' || this.mode === 'pit';
    cam.position.lerp(pos, rigid ? 1 : k);
    this.smoothLook.lerp(look, kl);
    cam.lookAt(this.smoothLook);
    cam.fov += (fov - cam.fov) * (this.snap ? 1 : 1 - Math.exp(-3 * dt));
    // In the driver's seat the halo and pillars pass within centimetres of
    // the eye, so the near plane comes right in (and the far plane back, to
    // keep depth precision).
    cam.near = this.mode === 'cockpit' ? 0.05 : 0.25;
    cam.far = this.mode === 'cockpit' ? 2500 : 6000;
    cam.updateProjectionMatrix();
    this.snap = false;
  }

  // The pit stop, as a broadcast would cut it: trackside as the car peels
  // off, following it down the lane, the garage's view as it arrives, a slow
  // overhead orbit while the crew works, a low wheel close-up, the launch
  // from ahead, and the exit. Cuts on phase changes.
  pitShot(rs, car) {
    const P = rs.pits, ps = car.pit;
    const tw = ps.tw;
    const box = P.carAt(ps.boxF, ps.boxF);
    const carPos = car.pos, len = car.length || 4.5;
    const D = ps.D;
    // a long lens on the fixed cameras: the car fills the frame at any range
    const longLens = (from, at, fill = 7) => clamp((2 * Math.atan(fill / Math.max(1, from.distanceTo(at))) * 180) / Math.PI, 12, 60);
    let phase, pos, look, fov = 55;
    if (tw < ps.tEnter + 0.9) {
      // fixed on the pit wall at the lane mouth, panning with the car as it peels off
      phase = 'entry';
      const L = P.laneAt(0.2);
      pos = L.p.clone().addScaledVector(L.n, -3.6).addScaledVector(L.t, 2).add(new THREE.Vector3(0, 2.6, 0));
      look = carPos.clone().add(new THREE.Vector3(0, 0.6, 0)); fov = longLens(pos, look, 9);
    } else if (tw < ps.tBox - rs.script.pit.brake - 0.15) {
      // low chase down the lane
      phase = 'lane';
      pos = carPos.clone().addScaledVector(car.tangent, -7.5).add(new THREE.Vector3(0, 2.0, 0)).addScaledVector(box.n, -1.2);
      look = carPos.clone().addScaledVector(car.tangent, 9).add(new THREE.Vector3(0, 0.5, 0)); fov = 60;
    } else if (tw < ps.tBox + 0.32 * D) {
      // from the back of the garage, over the crew's heads, as the car pulls in
      phase = 'garage';
      const g = P.garages[Math.floor(ps.boxIdx / 2)];
      pos = g.center.clone().addScaledVector(g.n, g.front + g.GD - 1.6).addScaledVector(g.t, ps.boxIdx % 2 ? 1.2 : -1.2).add(new THREE.Vector3(0, 2.9, 0));
      look = box.p.clone().lerp(carPos, 0.25).add(new THREE.Vector3(0, 0.5, 0)); fov = 66;
    } else if (tw < ps.tBox + 0.7 * D) {
      // a slow orbit above the box while the guns run
      phase = 'overhead';
      const a0 = Math.atan2(-box.n.z, -box.n.x);
      const a = a0 + 0.6 + 0.16 * (tw - ps.tBox);
      pos = box.p.clone().add(new THREE.Vector3(Math.cos(a) * 7.2, 4.4, Math.sin(a) * 7.2));
      look = box.p.clone().add(new THREE.Vector3(0, 0.7, 0)); fov = 50;
    } else if (tw < ps.tLeave + 0.35) {
      // down at the lane-side front wheel: the gun, the mechanic, then the launch
      phase = 'wheel';
      let wheel = null, best = Infinity;
      for (const w of car.wheels || []) {
        const wp = w.getWorldPosition(new THREE.Vector3());
        const score = wp.clone().sub(box.p).dot(box.n) - 0.3 * wp.clone().sub(box.p).dot(box.t);
        if (score < best) { best = score; wheel = wp; }
      }
      wheel = wheel || box.p.clone();
      pos = wheel.clone().addScaledVector(box.n, -1.5).addScaledVector(box.t, 2.6).add(new THREE.Vector3(0, 0.75, 0));
      // never back into the pit wall: stay inside the lane's far half
      const L = P.laneAt(ps.boxF), across = pos.clone().sub(L.p).dot(L.n), limit = -2.6;
      if (across < limit) pos.addScaledVector(L.n, limit - across);
      look = wheel.clone().add(new THREE.Vector3(0, 0.3, 0)); fov = 46;
    } else if (tw < ps.tLeave + 2.6) {
      // from the pit wall opposite the box, panning as the car pulls away
      phase = 'launch';
      pos = box.p.clone().addScaledVector(box.t, 3).addScaledVector(box.n, -6.2).add(new THREE.Vector3(0, 1.7, 0));
      look = carPos.clone().add(new THREE.Vector3(0, 0.5, 0)); fov = longLens(pos, look, 7);
    } else {
      // fixed beside the lane exit, the car flying past and out onto the track
      phase = 'exit';
      const L = P.laneAt(0.97);
      pos = L.p.clone().addScaledVector(L.n, 5.6).add(new THREE.Vector3(0, 2.2, 0));
      look = carPos.clone().add(new THREE.Vector3(0, 0.6, 0)); fov = longLens(pos, look, 7);
    }
    if (phase !== this.pitPhase) { this.pitPhase = phase; this.snap = true; }
    return { pos, look, fov };
  }

  // Sequential corner cams: hold on a corner until the whole pack is through,
  // then cut to the next corner ahead of the leader.
  updateCine(rs, leader) {
    const lapLen = rs.script.lapLen;
    const corners = rs.track.corners;
    const leadD = leader.dist;
    const backD = rs.cars[rs.backIdx].dist;

    if (this.cineCorner) {
      if (backD > this.cineCorner.triggerDist + 25) this.cineCorner = null; // pack has passed
    }
    if (!this.cineCorner) {
      // nearest corner whose absolute distance is ahead of the leader
      let best = null;
      for (const c of corners) {
        let abs;
        if (rs.track.open) { abs = c.dist; if (abs < leadD + 15) continue; }
        else { const k = Math.ceil((leadD + 15 - c.dist) / lapLen); abs = c.dist + k * lapLen; }
        if (!best || abs < best.triggerDist) best = { u: c.u, pos: c.pos, triggerDist: abs };
      }
      // past the last corner of a stage: stay on the finish
      if (!best) { const c = corners[corners.length - 1]; best = { u: c.u, pos: c.pos, triggerDist: Infinity }; }
      this.cineCorner = best;
      this.snap = true; // hard cut, like a broadcast switch
    }
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
