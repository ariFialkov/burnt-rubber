// RaceScene: owns the three.js scene for one race — track, cars, lights —
// and drives car transforms from the deterministic race script.

import * as THREE from 'three';
import { rngFor, clamp, lerp, smoothstep } from '../core/rng.js';
import { buildTrack } from './trackGen.js';
import { buildCar, numberSprite, COLLIDERS } from './carFactory.js';
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
    const colw = (COLLIDERS[race.tour.vehicle] || COLLIDERS.formula).width;
    // Rank in the finishing order: cars adjacent here are the ones that spend
    // the race in each other's company, so they are what the line spread below
    // needs to keep apart.
    const rankOf = new Array(race.field.length);
    this.script.finishOrder.forEach((idx, k) => { rankOf[idx] = k; });
    // Usable half-width for car centres.
    const laneSpan = Math.max(1, track.width / 2 - colw - 0.5);
    this.laneSpan = laneSpan;
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
        // Each car runs its own line rather than sweeping the full width —
        // that is both what racers actually do and what keeps a 40-car field
        // from constantly having to be pulled out of itself. The golden-ratio
        // step spreads the field evenly across the track.
        homeBase: (((rankOf[i] * 0.6180339887498949) % 1) * 2 - 1) * laneSpan * 0.9,
        homeDriftF: 0.15 + rand() * 0.3,
        homeDriftP: rand() * Math.PI * 2,
        // Separation state, carried across frames so it eases instead of snapping.
        lane: 0, lon: 0, laneSet: false,
        trackPos: 0, wantLane: 0,
      };
    });
    this.col = COLLIDERS[race.tour.vehicle] || COLLIDERS.formula;
    this.order = race.field.map((_, i) => i); // reused each frame, sorted by track position
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

  // Keep cars from occupying the same space. This is presentation only: it
  // adjusts where a car is *drawn* across the track, never its distance along
  // it, so standings, gaps and the scripted finish are untouched.
  //
  // Everything happens in track space — offset along the track vs. offset
  // across it — so two cars overlap when both offsets are inside their
  // combined footprint. Cars are swept in track order and only compared with
  // the few neighbours within reach, which keeps a 40-truck Baja field cheap.
  // Visit every pair whose track-space gap is within reach, in track order.
  eachNearPair(reach, fn) {
    const cars = this.cars;
    const lapLen = this.script.lapLen;
    const order = this.order;
    const n = order.length;
    for (let a = 0; a < n; a++) {
      const i = order[a];
      for (let k = 1; k < n; k++) {
        const j = order[(a + k) % n];
        let ds = cars[j].trackPos - cars[i].trackPos;
        if (ds < 0) ds += lapLen;
        if (ds >= reach) break; // sorted, so everything further along is clear
        fn(cars[i], cars[j], ds, i, j);
      }
    }
  }

  separate(dt) {
    const col = this.col;
    const minS = col.len * 2;      // combined half-lengths
    const minN = col.width * 2;    // combined half-widths
    // Settle a little wider than the trigger distance. Without this dead zone
    // the racing-line pull and the push would fight every frame and buzz;
    // with it, cars ease together and nudge apart in a slow, natural weave.
    const skin = 0.35;
    const bound = this.track.width / 2 - col.width - 0.4;
    const maxLon = minS * 2;   // a boxed-in car may drop back this far
    // Start easing apart well before the boxes touch. The window is measured
    // in time-to-contact rather than distance: a car closing at 40 m/s needs
    // to start moving much earlier than one easing up at 5 m/s, and a fixed
    // distance gives the fast closer no time to get out of the way.
    const reach = minS + 45;
    const want = minN + skin;
    // Hard cap on how far a car may slide across in one frame, no matter how
    // many neighbours are leaning on it. This is what keeps it from snapping.
    const maxFrame = 8 * dt;

    const cars = this.cars;
    const resort = () => this.order.sort((a, b) => cars[a].trackPos - cars[b].trackPos);
    resort();
    for (const c of cars) c.laneStart = c.lane;

    // Lateral relaxation: three passes settle a dense pack without jitter.
    for (let pass = 0; pass < 3; pass++) {
      this.eachNearPair(reach, (ci, cj, ds, i, j) => {
        const dn = cj.lane - ci.lane;
        const adn = Math.abs(dn);
        if (adn >= want) return;
        // Full strength once overlapping. Otherwise the sooner contact is
        // coming, the harder the pair eases apart — with a distance term as a
        // floor for cars sitting alongside each other at matched speed.
        let falloff;
        if (ds <= minS) {
          falloff = 1;
        } else {
          const closing = (ci.speedS || 0) - (cj.speedS || 0); // i runs behind j
          const ttc = closing > 0.5 ? (ds - minS) / closing : Infinity;
          const fTime = ttc >= 1.6 ? 0 : ttc <= 0.7 ? 1 : (1.6 - ttc) / 0.9;
          const fDist = Math.sqrt(Math.max(0, 1 - (ds - minS) / (minS * 1.6)));
          falloff = Math.max(fTime, fDist);
        }
        if (falloff <= 0) return;

        // Which way to split. Any real gap decides it — that is stable, since
        // the cars keep being pushed the way they already are. Only at a dead
        // heat is there nothing to read, and then a fixed index order breaks
        // the tie; anything derived from the cars' preferred lanes would flip
        // when those preferences cross, swapping the pair straight through
        // each other.
        const dir = adn > 0.2 ? Math.sign(dn) : (i < j ? -1 : 1);

        // Alignment decides who yields: side by side, both ease apart; when one
        // is clearly behind, the trailing car does the work — which is what an
        // overtake actually looks like.
        const overlap = (want - adn) * falloff;
        const trailIsJ = cj.dist < ci.dist;
        const wTrail = 0.5 + 0.5 * Math.min(1, ds / minS);
        const baseI = trailIsJ ? 1 - wTrail : wTrail;

        // ...but only as far as each car can actually go. A car against the
        // edge has no room, and pushing it there just gets clamped away while
        // the pair stays overlapped — so its share passes to the one with
        // space. This is what stops cars from stacking up against the wall.
        const roomI = Math.max(0, dir > 0 ? ci.lane + bound : bound - ci.lane);
        const roomJ = Math.max(0, dir > 0 ? bound - cj.lane : cj.lane + bound);
        const wI = baseI * roomI;
        const wJ = (1 - baseI) * roomJ;
        if (wI + wJ < 1e-6) return; // boxed in; the longitudinal yield handles it
        const moveI = Math.min(overlap * (wI / (wI + wJ)), roomI);
        const moveJ = Math.min(overlap * (wJ / (wI + wJ)), roomJ);

        ci.lane = clamp(ci.lane - dir * moveI, -bound, bound);
        cj.lane = clamp(cj.lane + dir * moveJ, -bound, bound);
      });
    }

    // Rate-limit the whole frame's movement per car, then re-clamp to the track.
    for (const c of cars) {
      c.lane = clamp(c.lane, c.laneStart - maxFrame, c.laneStart + maxFrame);
      c.lane = clamp(c.lane, -bound, bound);
    }

    // Only after rate limiting do we know what actually stayed overlapped —
    // those cars are genuinely boxed in, so the trailing one queues up behind
    // instead of driving through. Checking before the clamp would miss them.
    this.yieldBack(dt, maxLon);

  }

  // For pairs the lateral pass could not separate, the track is full across:
  // the trailing car backs off and queues up instead of driving through. Run
  // between lateral passes so the next one sees the extra room.
  yieldBack(dt, maxLon) {
    const minS = this.col.len * 2;
    const minN = this.col.width * 2;
    const lapLen = this.script.lapLen;
    // i runs behind j, so i is the one that lifts off.
    this.eachNearPair(minS, (ci, cj, ds) => {
      if (Math.abs(cj.lane - ci.lane) >= minN - 0.05) return; // it will clear across
      const trail = cj.dist < ci.dist ? cj : ci;
      const back = (minS + 0.3 - ds) * 0.6;
      trail.lon = clamp(trail.lon - Math.min(back, 30 * dt), -maxLon, 0);
      trail.trackPos = (((trail.dist + trail.lon) % lapLen) + lapLen) % lapLen;
    });
  }

  // mode: 'grid' | 'race'; tRace in seconds (may exceed script.T during cooldown)
  update(mode, tRace, dt, wallTime) {
    const { script, cars } = this;
    const lapLen = script.lapLen;
    const s = clamp(tRace / script.T, 0, 1);
    const vehicle = this.race.tour.vehicle;
    const blend = clamp(tRace / 2.2, 0, 1); // roll off the static grid
    let minD = Infinity, maxD = -Infinity;

    // Pass 1 — where each car wants to be, in track space.
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (mode === 'grid') {
        car.dist = -1;
        car.speed = 0;
        car.lane = 0;
        car.lon = 0;
        car.laneSet = false;
        continue;
      }
      const dist = script.distance(i, tRace, this.adj);
      car.speed = car.dist === -1
        ? script.paceMps
        : Math.max(0, (dist - car.dist) / Math.max(dt, 1e-3));
      car.speedS = car.speedS === undefined ? car.speed : car.speedS + (car.speed - car.speedS) * 0.2;
      car.dist = dist;
      car.trackPos = ((((dist + car.lon) % lapLen) + lapLen) % lapLen);
      // Hold a line, drifting slowly across the race, with a little jitter on
      // top. Overtakes then come from the separation pass, not from everyone
      // sweeping the whole track at once.
      const span = this.laneSpan;
      const home = car.homeBase + Math.sin(s * Math.PI * 2 * car.homeDriftF + car.homeDriftP) * span * 0.25;
      const wander = Math.sin(s * Math.PI * 2 * car.laneF * 3 + car.laneP) * Math.min(1.1, this.col.width * 0.9);
      car.wantLane = clamp(home + wander, -span, span);
      if (!car.laneSet) { car.lane = car.wantLane; car.laneSet = true; }
      // Drift back toward the natural racing line — deliberately rate-limited
      // to half the separation's authority, so a car being pushed clear is
      // never dragged back through its neighbour by the line pull.
      const ease = (car.wantLane - car.lane) * (1 - Math.exp(-3.5 * dt));
      car.lane += clamp(ease, -3 * dt, 3 * dt);
      car.lon += (0 - car.lon) * (1 - Math.exp(-1.2 * dt));
      if (dist > maxD) { maxD = dist; this.leaderIdx = i; }
      if (dist < minD) { minD = dist; this.backIdx = i; }
    }

    // Pass 2 — push apart anything that overlaps.
    if (mode === 'race') this.separate(dt);

    // Pass 3 — place the cars in the world.
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      let tangent, pos;

      if (mode === 'grid') {
        const slot = this.gridSlot(this.script.grid.indexOf(i));
        pos = slot.p;
        tangent = slot.t;
        pos.y += Math.sin(wallTime * 30 + i) * 0.015; // idle vibration
      } else {
        const shown = car.dist + car.lon;
        const u = ((shown / lapLen) % 1 + 1) % 1;
        const p = this.track.curve.getPointAt(u);
        tangent = this.track.curve.getTangentAt(u);
        const nrm = new THREE.Vector3(-tangent.z, 0, tangent.x);
        pos = p.clone().addScaledVector(nrm, car.lane * blend);
        if (blend < 1) {
          const slot = this.gridSlot(this.script.grid.indexOf(i));
          pos.lerpVectors(slot.p, pos, smoothstep(blend));
          tangent = slot.t.clone().lerp(tangent, blend).normalize();
        }
        if (vehicle === 'baja') pos.y += Math.abs(Math.sin(shown * 0.13 + car.bounceP)) * 0.35;
      }

      car.pos.copy(pos);
      car.tangent.copy(tangent);
      car.group.position.copy(pos);
      car.group.quaternion.setFromUnitVectors(FWD, tangent);

      // Corner lean / drift flavor
      const u2 = (((car.dist + 8) / lapLen) % 1 + 1) % 1;
      const tNext = this.track.curve.getTangentAt(u2);
      const turn = Math.atan2(tangent.x * tNext.z - tangent.z * tNext.x, tangent.dot(tNext));
      if (vehicle === 'moto') car.group.rotateZ(clamp(turn * 6, -0.8, 0.8));
      else if (vehicle === 'rally' || vehicle === 'baja') car.group.rotateY(clamp(turn * 2.4, -0.5, 0.5));
      else car.group.rotateZ(clamp(turn * 1.2, -0.18, 0.18));

      for (const w of car.wheels) w.rotation.x -= (car.speed * dt) / 0.45;
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
