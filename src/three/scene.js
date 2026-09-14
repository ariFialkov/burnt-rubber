// RaceScene: owns the three.js scene for one race — track, cars, lights —
// and drives car transforms from the deterministic race script.

import * as THREE from 'three';
import { rngFor, clamp, lerp, smoothstep } from '../core/rng.js';
import { buildTrack } from './trackGen.js';
import { buildCar, numberSprite, COLLIDERS } from './carFactory.js';
import { buildModelCar, modelMeta, shadowBlob, eyeFor } from './models.js';
import { getScript, getFocusLayer, GRID_OFFSET } from '../engine/script.js';

const FWD = new THREE.Vector3(0, 0, 1);

// How hard each class of vehicle can steer across the road: sideways speed as
// a fraction of forward speed (a slip angle — a car at rest cannot move
// across at all) and how quickly that sideways speed can build or bleed off
// (m/s²). Rally and Baja cars throw themselves around; a stock car does not.
const HANDLING = {
  formula: { slip: 0.16, aLat: 7 },
  stock:   { slip: 0.12, aLat: 5 },
  rally:   { slip: 0.22, aLat: 6 },
  baja:    { slip: 0.20, aLat: 4.5 },
  moto:    { slip: 0.15, aLat: 5 },
};

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
    this.scene.fog = new THREE.Fog(track.theme.fog, 250, Math.max(700, this.script.lapLen * 0.85));

    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x50483a, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(200, 320, 120);
    this.scene.add(sun);

    const rand = rngFor('scene-v1', race.key);
    // Collision footprint from the real model when it is loaded (a touch
    // tighter than the visual so door-to-door reads as contact, not a gap),
    // else the static table for the procedural fallback car.
    const meta = modelMeta(race.tour.vehicle);
    this.col = meta
      ? { len: meta.length * 0.48, width: meta.width * 0.45 }
      : (COLLIDERS[race.tour.vehicle] || COLLIDERS.formula);
    const colw = this.col.width;
    this.handling = HANDLING[race.tour.vehicle] || HANDLING.formula;
    // Rank in the finishing order: cars adjacent here are the ones that spend
    // the race in each other's company, so they are what the line spread below
    // needs to keep apart.
    const rankOf = new Array(race.field.length);
    this.script.finishOrder.forEach((idx, k) => { rankOf[idx] = k; });
    // Usable half-width for car centres.
    const laneSpan = Math.max(1, track.width / 2 - colw - 0.5);
    this.laneSpan = laneSpan;
    this.cars = race.field.map((r, i) => {
      const built = buildModelCar(race.tour.vehicle, r.colors) || (() => {
        const c = buildCar(race.tour.vehicle, r.colors);
        c.group.add(shadowBlob(this.col.width * 2, this.col.len * 2));
        return { ...c, meta: null };
      })();
      const { group, wheels } = built;
      const height = built.meta ? built.meta.height : (race.tour.vehicle === 'baja' ? 3.4 : 2.4);
      const length = built.meta ? built.meta.length : this.col.len * 2;
      const sprite = numberSprite(r.number, race.tour.accent);
      sprite.position.y = height + 1.0;
      group.add(sprite);
      this.scene.add(group);
      const eye = eyeFor(race.tour.vehicle, height, length);
      return {
        group, wheels, sprite, height, length, eye,
        glass: group.getObjectByName('glass') || null,
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
        // Motion state, carried across frames. `shown` is the distance the
        // car is drawn at (the script's, floored so it never runs backwards);
        // `lane` and `laneVel` are its position and speed across the road,
        // `lon` how far it has dropped back behind a car it cannot pass.
        shown: null, lane: 0, laneVel: 0, lon: 0, laneFresh: true,
        yaw: 0, trackPos: 0, wantLane: 0, laneStart: 0,
      };
    });
    this.order = race.field.map((_, i) => i); // reused each frame, sorted by track position
    this.leaderIdx = 0;
    this.backIdx = 0;
    this.centroid = new THREE.Vector3();
    this.spread = 0;
  }

  // Cockpit view looks out through the glazing, which is opaque — hide it on
  // the car being driven and restore it on everything else.
  setSeeThrough(idx) {
    for (let i = 0; i < this.cars.length; i++) {
      const g = this.cars[i].glass;
      if (g) g.visible = i !== idx;
    }
  }

  setFocus(idx) {
    this.focusIdx = idx;
    this.adj = idx >= 0 ? getFocusLayer(this.race, idx).adj : null;
  }

  // Grid geometry: two staggered columns behind the line. The distance back
  // is the script's own (its distance() puts every car in this slot at t=0),
  // so the launch simply continues from where the cars stood.
  gridLane(k) { return (k % 2 === 0 ? -1 : 1) * this.track.width * 0.2; }
  gridSlot(k) {
    const { curve } = this.track;
    const lapLen = this.script.lapLen;
    const back = GRID_OFFSET + k * this.script.pitch;
    const u = ((-back / lapLen) % 1 + 1) % 1;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    return { p: p.clone().addScaledVector(n, this.gridLane(k)), t };
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

    const cars = this.cars;
    const resort = () => this.order.sort((a, b) => cars[a].trackPos - cars[b].trackPos);
    resort();

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

    // The relaxation has produced where each car would like to be this
    // frame. Now steer toward it as a car would: sideways speed is a slip
    // angle on the forward speed, and it builds and bleeds at a bounded rate,
    // so the drawn path is a smooth curve the car can be pointed along — and
    // a car on the grid cannot slide across at all.
    const h = this.handling;
    for (const c of cars) {
      const goal = clamp(c.lane, -bound, bound);
      c.lane = c.laneStart;
      const want = goal - c.lane;
      const vMax = Math.min(Math.max(0.05, c.speedS * h.slip), Math.sqrt(2 * h.aLat * Math.abs(want)));
      const vTarget = clamp(want / 0.3, -vMax, vMax);
      c.laneVel += clamp(vTarget - c.laneVel, -h.aLat * dt, h.aLat * dt);
      const next = c.lane + c.laneVel * dt;
      c.lane = clamp(next, -bound, bound);
      if (c.lane !== next) c.laneVel = 0; // against the edge
    }

    // Only now do we know what actually stayed overlapped — those cars are
    // genuinely boxed in, so the trailing one queues up behind instead of
    // driving through. Checking before steering would miss them.
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
      const lead = trail === ci ? cj : ci;
      const back = (minS + 0.3 - ds) * 0.6;
      // Lifting off is only ever as abrupt as the closing speed calls for.
      const rate = clamp(1.5 * Math.max(0, trail.speedS - lead.speedS) + 1, 1, 30);
      // ...and never more than the car's own advance this frame, so lifting
      // off means slowing, never rolling backwards.
      const drop = Math.min(back, rate * dt, Math.max(0, trail.speed * dt * 0.9));
      trail.lon = clamp(trail.lon - drop, -maxLon, 0);
      trail.trackPos = (((trail.dist + trail.lon) % lapLen) + lapLen) % lapLen;
    });
  }

  // mode: 'grid' | 'race'; tRace in seconds (may exceed script.T during cooldown)
  update(mode, tRace, dt, wallTime) {
    const { script, cars } = this;
    const lapLen = script.lapLen;
    const s = clamp(tRace / script.T, 0, 1);
    const vehicle = this.race.tour.vehicle;
    const t = mode === 'grid' ? 0 : tRace;
    const live = mode === 'race' && !script.finished(t);
    // The slowest a car is ever drawn moving while the race is on: the
    // choreography can ask for a brief reversal where two fades overlap, and
    // that is never shown.
    const minStep = 0.25 * script.paceSpeed(t) * dt;
    let minD = Infinity, maxD = -Infinity;

    // Pass 1 — where each car wants to be, in track space.
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const scripted = script.distance(i, t, mode === 'grid' ? null : this.adj);
      if (mode === 'grid' || car.shown === null || Math.abs(scripted - car.shown) > 60) {
        // On the grid, or a scene picked up mid-race (or after a long stall):
        // take the script's word for it and start from rest across the road.
        car.shown = scripted;
        car.speed = mode === 'grid' ? 0 : (scripted - script.distance(i, Math.max(0, t - 0.1), this.adj)) / 0.1;
        car.speedS = car.speed;
        car.lon = 0;
        car.laneVel = 0;
        car.lane = this.gridLane(script.gridSlotOf[i]);
        car.laneFresh = true;
      } else {
        const shown = live ? Math.max(scripted, car.shown + minStep) : scripted;
        car.speed = Math.max(0, (shown - car.shown) / Math.max(dt, 1e-3));
        car.speedS += (car.speed - car.speedS) * 0.2;
        car.shown = shown;
      }
      const dist = car.shown;
      car.dist = dist;
      car.trackPos = ((((dist + car.lon) % lapLen) + lapLen) % lapLen);
      if (mode === 'race') {
        // Hold a line, drifting slowly across the race, with a little jitter
        // on top. Overtakes then come from the separation pass, not from
        // everyone sweeping the whole track at once.
        const span = this.laneSpan;
        const home = car.homeBase + Math.sin(s * Math.PI * 2 * car.homeDriftF + car.homeDriftP) * span * 0.25;
        const wander = Math.sin(s * Math.PI * 2 * car.laneF * 3 + car.laneP) * Math.min(1.1, this.col.width * 0.9);
        car.wantLane = clamp(home + wander, -span, span);
        // A scene picked up mid-race starts on its line rather than steering
        // over from the grid column; within the launch the column is right.
        if (car.laneFresh && t > 1.5) car.lane = car.wantLane;
        car.laneFresh = false;
        car.laneStart = car.lane;
        // Ease toward the racing line. This only seeds the goal the
        // separation pass refines; the steering step decides how much of it
        // the car can actually do this frame.
        car.lane += (car.wantLane - car.lane) * (1 - Math.exp(-3.5 * dt));
        // Close back up behind a car once there is room, no faster than a
        // share of the car's own speed.
        const rec = (0 - car.lon) * (1 - Math.exp(-1.2 * dt));
        const cap = (0.3 * car.speedS + 0.5) * dt;
        car.lon += clamp(rec, -cap, cap);
      }
      if (dist > maxD) { maxD = dist; this.leaderIdx = i; }
      if (dist < minD) { minD = dist; this.backIdx = i; }
    }

    // Pass 2 — push apart anything that overlaps.
    if (mode === 'race') this.separate(dt);

    // Pass 3 — place the cars in the world. Grid and race use the same
    // formula, so the launch continues from exactly where the cars stood.
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const shown = car.dist + car.lon;
      const u = ((shown / lapLen) % 1 + 1) % 1;
      const p = this.track.curve.getPointAt(u);
      const tangent = this.track.curve.getTangentAt(u);
      const nrm = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const pos = p.clone().addScaledVector(nrm, car.lane);
      if (mode === 'grid') pos.y += Math.sin(wallTime * 30 + i) * 0.015; // idle vibration
      else if (vehicle === 'baja') pos.y += Math.abs(Math.sin(shown * 0.13 + car.bounceP)) * 0.35;

      // Point the car where it is actually going: the track direction plus
      // whatever it is steering across. (Lane +1 is the track's left.)
      const yaw = mode === 'race' ? Math.atan2(car.laneVel, Math.max(car.speedS, 3)) : 0;
      car.yaw += (yaw - car.yaw) * Math.min(1, 12 * dt);

      car.pos.copy(pos);
      car.tangent.copy(tangent);
      car.group.position.copy(pos);
      car.group.quaternion.setFromUnitVectors(FWD, tangent);
      car.group.rotateY(-car.yaw);

      // Corner lean / drift flavor
      const u2 = (((car.dist + 8) / lapLen) % 1 + 1) % 1;
      const tNext = this.track.curve.getTangentAt(u2);
      const turn = Math.atan2(tangent.x * tNext.z - tangent.z * tNext.x, tangent.dot(tNext));
      if (vehicle === 'moto') car.group.rotateZ(clamp(turn * 4.5, -0.6, 0.6));
      else if (vehicle === 'rally' || vehicle === 'baja') car.group.rotateY(clamp(turn * 2.4, -0.5, 0.5));
      else car.group.rotateZ(clamp(turn * 1.2, -0.18, 0.18));

      for (const w of car.wheels) w.rotation.x -= (car.speed * dt) / (w.userData.radius || 0.45);
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
