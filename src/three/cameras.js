// The five broadcast cameras. All modes are damped so cuts feel operated,
// not teleported.

import * as THREE from 'three';
import { clamp } from '../core/rng.js';

export const CAMERA_MODES = [
  { id: 'chase', label: '3rd Person', icon: '🎥' },
  { id: 'cockpit', label: 'Driver', icon: '🪖' },
  { id: 'hood', label: 'Hood Back', icon: '🔙' },
  { id: 'cine', label: 'Cinematic', icon: '🎬' },
  { id: 'chopper', label: 'Chopper', icon: '🚁' },
];

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.5, 6000);
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

    if (this.mode === 'chase') {
      pos = car.pos.clone().addScaledVector(car.tangent, -9).addScaledVector(up, 3.6);
      look = car.pos.clone().addScaledVector(car.tangent, 10).addScaledVector(up, 1.2);
      fov = 62; stiff = 8;
    } else if (this.mode === 'cockpit') {
      pos = car.pos.clone().addScaledVector(car.tangent, 0.3).addScaledVector(up, 1.5);
      look = car.pos.clone().addScaledVector(car.tangent, 40).addScaledVector(up, 1.2);
      fov = 74; stiff = 30;
    } else if (this.mode === 'hood') {
      pos = car.pos.clone().addScaledVector(car.tangent, 2.2).addScaledVector(up, 1.6);
      look = car.pos.clone().addScaledVector(car.tangent, -40).addScaledVector(up, 1.6);
      fov = 68; stiff = 30;
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

    const k = this.snap ? 1 : 1 - Math.exp(-stiff * dt);
    const kl = this.snap ? 1 : 1 - Math.exp(-Math.max(stiff, 6) * dt);
    cam.position.lerp(pos, this.mode === 'cine' ? 1 : k); // cine cam is bolted down
    this.smoothLook.lerp(look, kl);
    cam.lookAt(this.smoothLook);
    cam.fov += (fov - cam.fov) * (this.snap ? 1 : 1 - Math.exp(-3 * dt));
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
        const k = Math.ceil((leadD + 15 - c.u * lapLen) / lapLen);
        const abs = c.u * lapLen + k * lapLen;
        if (!best || abs < best.triggerDist) best = { u: c.u, pos: c.pos, triggerDist: abs };
      }
      this.cineCorner = best;
      this.snap = true; // hard cut, like a broadcast switch
    }
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
