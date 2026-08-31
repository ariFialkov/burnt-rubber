// RaceScene: owns the three.js scene for one race — track, cars, lights —
// and drives car transforms from the deterministic race script.

import * as THREE from 'three';
import { rngFor, clamp, lerp, smoothstep } from '../core/rng.js';
import { buildTrack } from './trackGen.js';
import { buildCar, numberSprite } from './carFactory.js';
import { getScript, getFocusLayer } from '../engine/script.js';

const FWD = new THREE.Vector3(0, 0, 1);

export class RaceScene {
  constructor(race) {
    this.race = race;
    this.script = getScript(race);
    this.adj = null;
    this.focusIdx = -1;

    this.scene = new THREE.Scene();
    const track = buildTrack(race, this.script);
    this.track = track;
    this.scene.add(track.group);
    this.scene.background = new THREE.Color(track.theme.sky);
    this.scene.fog = new THREE.Fog(track.theme.fog, 250, this.script.lapLen * 0.85);

    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x50483a, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(200, 320, 120);
    this.scene.add(sun);

    const rand = rngFor('scene-v1', race.key);
    this.cars = race.field.map((r, i) => {
      const { group, wheels } = buildCar(race.tour.vehicle, r.colors);
      const sprite = numberSprite(r.number, race.tour.accent);
      sprite.position.y = race.tour.vehicle === 'baja' ? 4.4 : 3.4;
      group.add(sprite);
      this.scene.add(group);
      return {
        group, wheels, sprite,
        pos: new THREE.Vector3(),
        tangent: new THREE.Vector3(0, 0, 1),
        dist: 0, speed: 0,
        laneF: 0.4 + rand() * 0.9,
        laneP: rand() * Math.PI * 2,
        bounceP: rand() * Math.PI * 2,
      };
    });
    this.leaderIdx = 0;
    this.backIdx = 0;
    this.centroid = new THREE.Vector3();
    this.spread = 0;
  }

  setFocus(idx) {
    this.focusIdx = idx;
    this.adj = idx >= 0 ? getFocusLayer(this.race, idx).adj : null;
  }

  // Static grid slot (two staggered columns behind the line).
  gridSlot(k) {
    const { curve } = this.track;
    const lapLen = this.script.lapLen;
    const back = 12 + k * 7.5;
    const u = ((-back / lapLen) % 1 + 1) % 1;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    return { p: p.clone().addScaledVector(n, (k % 2 === 0 ? -1 : 1) * this.track.width * 0.2), t };
  }

  // mode: 'grid' | 'race'; tRace in seconds (may exceed script.T during cooldown)
  update(mode, tRace, dt, wallTime) {
    const { script, cars } = this;
    const lapLen = script.lapLen;
    const s = clamp(tRace / script.T, 0, 1);
    const vehicle = this.race.tour.vehicle;
    const laneMax = this.track.width / 2 - 2.2;
    let minD = Infinity, maxD = -Infinity;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      let dist, tangent, pos;

      if (mode === 'grid') {
        const slot = this.gridSlot(this.script.grid.indexOf(i));
        pos = slot.p;
        tangent = slot.t;
        dist = -1;
        car.speed = 0;
        // idle vibration
        pos.y += Math.sin(wallTime * 30 + i) * 0.015;
      } else {
        dist = script.distance(i, tRace, this.adj);
        const blend = clamp(tRace / 2.2, 0, 1); // roll off the static grid
        const u = ((dist / lapLen) % 1 + 1) % 1;
        const p = this.track.curve.getPointAt(u);
        tangent = this.track.curve.getTangentAt(u);
        const n = new THREE.Vector3(-tangent.z, 0, tangent.x);
        const lane = Math.sin(s * Math.PI * 2 * car.laneF * 3 + car.laneP) * laneMax * 0.8;
        pos = p.clone().addScaledVector(n, lane * blend);
        if (blend < 1) {
          const slot = this.gridSlot(this.script.grid.indexOf(i));
          pos.lerpVectors(slot.p, pos, smoothstep(blend));
          tangent = slot.t.clone().lerp(tangent, blend).normalize();
        }
        car.speed = Math.max(0, (dist - car.dist) / Math.max(dt, 1e-3));
        if (vehicle === 'baja') pos.y += Math.abs(Math.sin(dist * 0.13 + car.bounceP)) * 0.35;
      }

      car.dist = dist;
      car.pos.copy(pos);
      car.tangent.copy(tangent);
      car.group.position.copy(pos);
      car.group.quaternion.setFromUnitVectors(FWD, tangent);

      // Corner lean / drift flavor
      const u2 = (((dist + 8) / lapLen) % 1 + 1) % 1;
      const tNext = this.track.curve.getTangentAt(u2);
      const turn = Math.atan2(tangent.x * tNext.z - tangent.z * tNext.x, tangent.dot(tNext));
      if (vehicle === 'moto') car.group.rotateZ(clamp(turn * 6, -0.8, 0.8));
      else if (vehicle === 'rally' || vehicle === 'baja') car.group.rotateY(clamp(turn * 2.4, -0.5, 0.5));
      else car.group.rotateZ(clamp(turn * 1.2, -0.18, 0.18));

      for (const w of car.wheels) w.rotation.x -= (car.speed * dt) / 0.45;

      if (mode === 'race') {
        if (dist > maxD) { maxD = dist; this.leaderIdx = i; }
        if (dist < minD) { minD = dist; this.backIdx = i; }
      }
    }

    if (mode === 'race') {
      this.spread = maxD - minD;
      this.centroid.set(0, 0, 0);
      for (const c of cars) this.centroid.add(c.pos);
      this.centroid.divideScalar(cars.length);
    } else {
      this.spread = 30;
      this.centroid.copy(this.gridSlot(Math.floor(cars.length / 2)).p);
      this.leaderIdx = this.script.grid[0];
      this.backIdx = this.script.grid[this.script.grid.length - 1];
    }
  }

  standingsNow(tRace) {
    return this.script.standings(clamp(tRace / this.script.T, 0, 1), this.adj);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
      }
    });
  }
}
