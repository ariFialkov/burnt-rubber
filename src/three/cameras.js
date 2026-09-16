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
    const rigid = this.mode === 'cine' || this.mode === 'cockpit' || this.mode === 'hood';
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
