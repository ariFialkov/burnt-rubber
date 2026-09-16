// RaceScene: owns the three.js scene for one race — track, cars, lights —
// and drives car transforms from the deterministic race script.

import * as THREE from 'three';
import { rngFor, clamp, lerp, smoothstep, mulberry32 } from '../core/rng.js';
import { buildTrack } from './trackGen.js';
import { buildCar, carLabel, positionBadge, COLLIDERS } from './carFactory.js';
import { buildModelCar, modelMeta, shadowBlob, eyeFor, LAMP } from './models.js';
import { buildCockpitKit, cockpitFor, updateInstruments } from './cockpit.js';
import { SurfaceFX } from './effects.js';
import { PitCrews } from './pits.js';
import { getScript, getFocusLayer, GRID_OFFSET } from '../engine/script.js';

const FWD = new THREE.Vector3(0, 0, 1);

// How hard each class of vehicle can steer across the road: sideways speed as
// a fraction of forward speed (a slip angle — a car at rest cannot move
// across at all) and how quickly that sideways speed can build or bleed off
// (m/s²). Rally and Baja cars throw themselves around; a stock car does not.
// How each body sits on its suspension. `roll` and `pitch` are radians per
// m/s² of lateral and longitudinal load (a car rolls outward and squats
// under power); `spring` and `damp` are the suspension's natural frequency
// (rad/s) and damping ratio — under 1 it bounces; `drift` is how far the
// nose turns into a corner beyond the path (loose surfaces only); `bump`
// is how much the wheels jitter over gravel (m), at low speed.
const BODY = {
  formula: { roll: 0.0015, rollMax: 0.03, pitch: 0.0010, spring: 16, damp: 1.0,  drift: 0,   bump: 0 },
  stock:   { roll: 0.0040, rollMax: 0.07, pitch: 0.0020, spring: 9,  damp: 0.6,  drift: 0,   bump: 0 },
  rally:   { roll: 0.0080, rollMax: 0.14, pitch: 0.0060, spring: 6,  damp: 0.4,  drift: 1.1, bump: 0.035 },
  baja:    { roll: 0.0070, rollMax: 0.15, pitch: 0.0100, spring: 4.5, damp: 0.35, drift: 0.7, bump: 0.08 },
  moto:    { roll: 0, rollMax: 0, pitch: 0, spring: 10, damp: 1.0, drift: 0, bump: 0, leanMax: 1.0 },
};
// Fastest a wheel is drawn turning (rad/s). Real speeds put a rim well past
// what a frame rate can show, where it reads as slow or backwards; capping
// keeps it visibly spinning hard, and it stays proportional below the cap.
const WHEEL_OMEGA_MAX = 27;
// Smooth 1-D noise in about [-1, 1] from a few incommensurate sines.
const noise1 = (x) => 0.55 * Math.sin(x) + 0.3 * Math.sin(2.31 * x + 1.3) + 0.15 * Math.sin(5.7 * x + 0.4);
const UP = new THREE.Vector3(0, 1, 0);

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
    // A wet race is a grey day: sky and fog darken and close in, the sun
    // goes flat.
    const grey = new THREE.Color(0x6f7680);
    const sky = new THREE.Color(track.theme.sky), fogC = new THREE.Color(track.theme.fog);
    if (race.wet) { sky.lerp(grey, 0.7); fogC.lerp(grey, 0.65); }
    this.scene.background = sky;
    // A stage's terrain reaches about as far as the fog; a loop's fog scales with the lap.
    const fogFar = track.open ? 850 : Math.max(700, this.script.lapLen * 0.85);
    this.scene.fog = new THREE.Fog(fogC, race.wet ? 120 : 250, fogFar * (race.wet ? 0.6 : 1));

    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x50483a, race.wet ? 0.8 : 1.05));
    const sun = new THREE.DirectionalLight(race.wet ? 0xd8dde6 : 0xfff2d8, race.wet ? 0.7 : 1.6);
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
    this.body = BODY[race.tour.vehicle] || BODY.formula;
    // Rank in the finishing order: cars adjacent here are the ones that spend
    // the race in each other's company, so they are what the line spread below
    // needs to keep apart.
    const rankOf = new Array(race.field.length);
    this.script.finishOrder.forEach((idx, k) => { rankOf[idx] = k; });
    // Usable half-width for car centres.
    const laneSpan = Math.max(1, track.width / 2 - colw - 0.5);
    this.laneSpan = laneSpan;
    this.cars = race.field.map((r, i) => {
      const built = buildModelCar(race.tour.vehicle, r.colors, r.number) || (() => {
        const c = buildCar(race.tour.vehicle, r.colors);
        c.group.add(shadowBlob(this.col.width * 2, this.col.len * 2));
        return { ...c, meta: null };
      })();
      const { group, wheels } = built;
      // Front wheels steer: yaw first, then the spin about the axle.
      for (const w of wheels) { w.rotation.order = 'YXZ'; w.userData.front = w.position.z > 0; }
      const height = built.meta ? built.meta.height : (race.tour.vehicle === 'baja' ? 3.4 : 2.4);
      const length = built.meta ? built.meta.length : this.col.len * 2;
      const sprite = carLabel(r, race.tour.accent);
      sprite.position.y = height + 1.1;
      group.add(sprite);
      const badge = positionBadge(race.tour.accent);
      badge.sprite.position.y = height + 1.1;
      group.add(badge.sprite);
      this.scene.add(group);
      const eye = eyeFor(race.tour.vehicle, height, length);
      group.userData.carIdx = i; // for picking: a hit anywhere in the group resolves to this car
      for (const w of wheels) w.userData.restY = w.position.y;
      const riderObj = group.getObjectByName('rider');
      if (riderObj) riderObj.userData.seat = { x: riderObj.position.x, y: riderObj.position.y };
      return {
        group, wheels, sprite, badge, posSprite: badge.sprite, rank: 0, height, length, eye,
        glass: group.getObjectByName('glass') || null,
        stand: group.getObjectByName('stand') || null,
        rider: riderObj,
        driver: group.getObjectByName('driver') || null,
        lamps: built.lamps || [],
        drs: group.getObjectByName('drs') || null,
        steer: 0, braking: false, brakeHold: 0, drsOpen: false, drsAng: 0, dashTimer: rand(),
        needleSpeed: 0, needleRpm: 0.1, gear: 1,
        // How late this driver brakes (seconds of look-ahead) and where in
        // the flash cycle this car's rain light sits.
        brakePoint: 1.15 - 0.45 * (r.stats.aggression / 100) + rand() * 0.1, blinkPhase: rand() * 0.5,
        interior: group.getObjectByName('interior') || null,
        bodyMeshes: ['primary', 'secondary', 'dark'].map((n) => group.getObjectByName(n)).filter(Boolean),
        // Body state: suspension roll/pitch (with their velocities), drift
        // angle, bike lean, filtered loads, gravel-bump phase, stand angle.
        roll: 0, rollV: 0, pitch: 0, pitchV: 0, drift: 0, lean: 0,
        latAcc: 0, lonAcc: 0, prevSpeed: 0, prevLaneVel: 0,
        bumpPhase: rand() * 20, standAng: 0,
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
    this.rankTimer = 0;
    this.kit = null;   // the driver's-eye interior, built on first use
    this.kitOn = -1;   // which car carries it
    // Tyre marks and dust/mud/gravel, per surface and weather.
    this.fx = new SurfaceFX(this.scene, race.tour.vehicle, race.wet, race.field.length);
    this.fxRand = mulberry32(12345);
    for (const c of this.cars) c.tracks = c.wheels.filter((w) => !w.userData.front).map((w) => ({ wheel: w, last: null, lastHard: false }));

    this.leaderIdx = 0;
    this.backIdx = 0;
    this.centroid = new THREE.Vector3();
    this.spread = 0;
    // The pit complex and its crews (loop tours).
    this.pits = track.pit || null;
    this.crews = this.pits && this.cars.length ? new PitCrews(this.scene, this.pits, race, this.cars[0].wheels.length) : null;
    this.pitJobs = new Map(); // garage -> car index whose stop the crew is on
  }

  // Cockpit view looks out through the glazing, which is opaque — hide it on
  // the car being driven and restore it on everything else.
  setSeeThrough(idx) {
    const keep = this.race.tour.vehicle === 'moto'; // the bike's screen is see-through anyway
    for (let i = 0; i < this.cars.length; i++) {
      const g = this.cars[i].glass;
      if (g) g.visible = keep || i !== idx;
    }
  }

  // Put the cockpit interior in the car the driver camera is riding (and hide
  // that bike's rider, who would otherwise fill the lens); -1 removes it.
  setCockpit(idx) {
    if (this.kitOn === idx) return;
    if (this.kitOn >= 0) {
      const prev = this.cars[this.kitOn];
      if (this.kit) prev.group.remove(this.kit);
      if (prev.rider) prev.rider.visible = true;
      if (prev.interior) prev.interior.visible = true;
      for (const m of prev.bodyMeshes) { m.material.clippingPlanes = null; m.material.clipIntersection = false; }
    }
    this.kitOn = idx;
    if (idx < 0) return;
    if (!this.kit) this.kit = buildCockpitKit(this.race.tour.vehicle);
    const car = this.cars[idx];
    car.group.add(this.kit);
    if (car.rider) car.rider.visible = false;   // would fill the lens
    if (car.interior) car.interior.visible = false; // the kit has its own
    // Clip away a region of the bodywork (a windscreen wound inside-out);
    // the planes are kept in world space by poseBody every frame.
    const clip = cockpitFor(this.race.tour.vehicle).clip;
    if (clip) {
      const n = clip.x0 !== undefined ? 6 : 4;
      this.clipPlanes = Array.from({ length: n }, () => new THREE.Plane());
      for (const m of car.bodyMeshes) { m.material.clippingPlanes = this.clipPlanes; m.material.clipIntersection = true; }
    }
  }

  // The windscreen clip box, from the car's frame into the world.
  updateClipPlanes(car) {
    const clip = cockpitFor(this.race.tour.vehicle).clip;
    if (!clip || !this.clipPlanes) return;
    const g = car.group;
    const n = new THREE.Vector3(), p = new THREE.Vector3();
    const set = (k, nx, ny, nz, px, py, pz) => {
      n.set(nx, ny, nz).applyQuaternion(g.quaternion);
      p.set(px, py, pz).applyMatrix4(g.matrixWorld);
      this.clipPlanes[k].setFromNormalAndCoplanarPoint(n, p);
    };
    // A point is clipped only when on the clipped side of all four: inside the box.
    set(0, 0, -1, 0, 0, clip.y0, 0);
    set(1, 0, 1, 0, 0, clip.y1, 0);
    set(2, 0, 0, -1, 0, 0, clip.z0);
    set(3, 0, 0, 1, 0, 0, clip.z1);
    if (clip.x0 !== undefined) { set(4, -1, 0, 0, clip.x0, 0, 0); set(5, 1, 0, 0, clip.x1, 0, 0); }
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
    const back = GRID_OFFSET + k * this.script.pitch;
    const u = this.track.uAt(-back);
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
  // Position in track space: wraps on a loop, runs straight on a stage.
  trackPosOf(d) {
    if (this.track.open) return d;
    const lapLen = this.script.lapLen;
    return ((d % lapLen) + lapLen) % lapLen;
  }
  eachNearPair(reach, fn) {
    const cars = this.cars;
    const lapLen = this.track.open ? Infinity : this.script.lapLen;
    const order = this.order;
    const n = order.length;
    for (let a = 0; a < n; a++) {
      const i = order[a];
      if (cars[i].pit?.inLane) continue;
      for (let k = 1; k < n; k++) {
        const j = order[(a + k) % n];
        if (cars[j].pit?.inLane) continue;
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
      trail.trackPos = this.trackPosOf(trail.dist + trail.lon);
    });
  }

  // mode: 'grid' | 'race'; tRace in seconds (may exceed script.T during cooldown)
  update(mode, tRace, dt, wallTime) {
    const { script, cars } = this;
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
        car.jumped = true; // don't draw a mark from wherever it was to here
      } else {
        // in the pit lane the script's kinematics are the truth, stop included
        const step = car.pit?.inLane ? 0 : minStep;
        const shown = live ? Math.max(scripted, car.shown + step) : scripted;
        car.speed = Math.max(0, (shown - car.shown) / Math.max(dt, 1e-3));
        car.speedS += (car.speed - car.speedS) * 0.2;
        car.shown = shown;
      }
      car.pit = mode === 'race' && this.pits ? script.pitState(i, t, this.adj) : null;
      const dist = car.shown;
      car.dist = dist;
      car.trackPos = this.trackPosOf(dist + car.lon);
      if (mode === 'race') {
        // Hold a line, drifting slowly across the race, with a little jitter
        // on top. Overtakes then come from the separation pass, not from
        // everyone sweeping the whole track at once.
        const span = this.laneSpan;
        const home = car.homeBase + Math.sin(s * Math.PI * 2 * car.homeDriftF + car.homeDriftP) * span * 0.25;
        const wander = Math.sin(s * Math.PI * 2 * car.laneF * 3 + car.laneP) * Math.min(1.1, this.col.width * 0.9);
        car.wantLane = clamp(home + wander, -span, span);
        // heading for the pits: over to the inside edge; rejoining: from it
        if (car.pit) {
          const edgeLane = this.pits.side * this.pits.edge; // the lane peels off along the track normal times the infield side, same as scene lanes
          if (!car.pit.inLane && car.pit.tw > car.pit.tEnter - 7 && car.pit.tw < car.pit.tEnter) car.wantLane = edgeLane;
          if (car.pit.inLane) {
            // whatever is left of the way over is carried into the lane and eased out along its entry ramp
            if (!car.wasInLane) car.pitLat = car.lane - edgeLane;
            car.lane = edgeLane; car.laneVel = 0; car.lon = 0;
          }
          car.wasInLane = car.pit.inLane;
        }
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

    // Position badges: the leaderboard's order, a few times a second.
    this.rankTimer -= dt;
    if (this.rankTimer <= 0) {
      this.rankTimer = 0.25;
      const order = mode === 'grid' ? script.grid : script.standings(s, this.adj);
      order.forEach((idx, k) => {
        const c = cars[idx];
        if (c.rank !== k + 1) { c.rank = k + 1; c.badge.set(k + 1); }
      });
    }

    // Pass 3 — place the cars in the world. Grid and race use the same
    // formula, so the launch continues from exactly where the cars stood.
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const shown = car.dist + car.lon;
      let p, tangent, pos;
      if (car.pit?.inLane) {
        const C = this.pits.carAt(car.pit.f, car.pit.boxF);
        p = C.p; tangent = C.t; pos = C.p.clone();
        const carry = (car.pitLat || 0) * (1 - smoothstep(clamp(car.pit.f / 0.12, 0, 1)));
        if (carry) pos.addScaledVector(C.n, this.pits.side * carry); // C.n is the track normal times the infield side
      } else {
        const u = this.track.uAt(shown);
        p = this.track.curve.getPointAt(u);
        tangent = this.track.curve.getTangentAt(u);
        const nrm = new THREE.Vector3(-tangent.z, 0, tangent.x);
        pos = p.clone().addScaledVector(nrm, car.lane);
      }
      car.groundY = p.y; // the road surface under the car, before any bounce
      if (mode === 'grid') pos.y += Math.sin(wallTime * 30 + i) * 0.015; // idle vibration

      // Point the car where it is actually going: the track direction plus
      // whatever it is steering across. (Lane +1 is the track's right, and
      // +X in the car's frame is its left.)
      const yaw = mode === 'race' ? Math.atan2(car.laneVel, Math.max(car.speedS, 3)) : 0;
      car.yaw += (yaw - car.yaw) * Math.min(1, 12 * dt);

      car.pos.copy(pos);
      car.tangent.copy(tangent);
      this.poseBody(car, tangent, mode, t, Math.min(dt, 0.05));
    }

    // Pit crews: hand each garage the stop that is due, then animate.
    if (this.crews) {
      if (mode === 'race') {
        // One crew per garage, two cars per team: the crew serves the stop
        // that is live (earliest box arrival first) and only then the
        // team-mate's, so a double-stack hands over cleanly.
        const due = new Map();
        for (let i = 0; i < cars.length; i++) {
          const ps = cars[i].pit;
          if (!ps || ps.tw < ps.tBox - 3.4 || ps.tw > ps.tLeave + 5.6) continue;
          const g = Math.floor(ps.boxIdx / 2);
          const cur = due.get(g);
          const live = ps.tw < ps.tLeave + 0.3, curLive = cur && cur.ps.tw < cur.ps.tLeave + 0.3;
          if (!cur || (live && !curLive) || (live === curLive && (live ? ps.tBox < cur.ps.tBox : ps.tLeave > cur.ps.tLeave))) due.set(g, { i, ps });
        }
        for (const [g, { i, ps }] of due) {
          if (this.pitJobs.get(g) !== i) { this.pitJobs.set(g, i); this.crews.setJob(g, this.pitJob(i, ps)); }
        }
      }
      this.crews.update(t, dt);
    }

    // Surface effects: each rear wheel lays its track and throws up its
    // dust, from where the tyre actually meets the road.
    if (mode === 'race') this.surface(dt, t);
    this.fx.update(dt);
    // trackside: the crowds' clock and what the gantry says
    if (this.track.tick) {
      const laps = this.race.tour.laps;
      const leadD = this.cars.length ? Math.max(...this.cars.map((c) => c.dist)) : 0;
      const lap = clamp(Math.floor(leadD / this.script.lapLen) + 1, 1, laps);
      // FINISH only once the leader is on the last lap and closing on the
      // line, so a viewer following a car a lap down isn't misled.
      const toLine = this.script.lapLen - (((leadD % this.script.lapLen) + this.script.lapLen) % this.script.lapLen);
      const closing = lap >= laps && toLine < 260;
      const text = mode !== 'race' ? 'START' : script.finished(t) || leadD >= this.script.totalDist || closing ? 'FINISH' : `LAP ${lap}/${laps}`;
      const color = text === 'START' ? '#2ee6a8' : text === 'FINISH' ? '#ff4d5e' : '#ffd12a';
      this.track.tick(wallTime, text, color);
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

  // Orientation and suspension. The path decides where a car is; this
  // decides how it sits there: nose along its motion (plus a drift angle on
  // loose surfaces), body rolled outward and pitched by the loads on it
  // through a spring, wheels spinning with the road and jittering over
  // gravel, a bike leaned into the corner with its rider hanging off.
  poseBody(car, tangent, mode, t, dt) {
    const B = this.body;
    const vehicle = this.race.tour.vehicle;
    const racing = mode === 'race';

    // Loads. Curvature of the road just ahead gives the cornering load;
    // the steering across the road and the change of pace add to it.
    const tNext = car.pit?.inLane
      ? this.pits.laneAt(Math.min(1, car.pit.f + 8 / this.script.pit.span)).t
      : this.track.curve.getTangentAt(this.track.uAt(car.dist + 8));
    // Positive when the road bends to the right (+X being the car's left).
    const turn = Math.atan2(tangent.x * tNext.z - tangent.z * tNext.x, tangent.dot(tNext));
    car.turnAhead = turn;
    const v = car.speedS;
    const laneAcc = (car.laneVel - car.prevLaneVel) / dt;
    const lonAcc = (car.speed - car.prevSpeed) / dt;
    car.prevLaneVel = car.laneVel;
    car.prevSpeed = car.speed;
    // Lateral load toward the car's left (m/s²): a left bend, or steering left.
    const aLeft = racing ? (v * v * (-turn / 8) - laneAcc) : 0;
    car.latAcc += (aLeft - car.latAcc) * Math.min(1, 8 * dt);
    car.lonAcc += ((racing ? lonAcc : 0) - car.lonAcc) * Math.min(1, 6 * dt);

    // Drift: the nose turns into the corner beyond the path, building and
    // fading over a beat, only once the car is really moving.
    const driftTarget = B.drift ? clamp(-turn * B.drift, -0.35, 0.35) * Math.min(1, v / 12) : 0;
    car.drift += (driftTarget - car.drift) * Math.min(1, 4 * dt);

    // Orientation from an explicit basis (forward, world up), never from a
    // minimal rotation — that flips a car over where the road dips.
    const fwd = tangent.clone().applyAxisAngle(UP, -car.yaw + car.drift).normalize();
    const left = UP.clone().cross(fwd).normalize();
    car.fwd = fwd; car.left = left;
    const up = fwd.clone().cross(left).normalize();
    car.group.position.copy(car.pos);
    car.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));

    if (vehicle === 'moto') {
      // Lean into the load, up to a MotoGP knee-down angle, at a rate a
      // rider can throw the bike across.
      const leanTarget = B.leanMax * Math.tanh(car.latAcc / 40);
      car.lean += clamp(leanTarget - car.lean, -2.5 * dt, 2.5 * dt);
      car.group.rotateZ(-car.lean); // +X is left, so a left lean is a negative roll
      // The rider hangs off the inside: slides across the seat, drops, and
      // leans further than the bike from the hips.
      if (car.rider) {
        const f = Math.abs(car.lean) / B.leanMax;
        const side = Math.sign(car.lean) || 1;
        const seat = car.rider.userData.seat;
        car.rider.position.x = seat.x + side * 0.22 * f;
        car.rider.position.y = seat.y - 0.06 * f;
        car.rider.rotation.z = -side * 0.35 * f;
        // Hands stay on the grips however far the body hangs off.
        const G = B.grips || cockpitFor('moto').grips;
        if (G) this.aimHands(car, car.rider, (side) => new THREE.Vector3(side === 'l' ? G.x : -G.x, G.y, G.z), 0, dt, { x: 0.6, y: -0.25, z: 0.05 });
      }
      // The paddock stand swings up off the rear wheel as the race goes green.
      if (car.stand) {
        const target = racing && t > 0.3 ? 1.75 : 0;
        car.standAng += clamp(target - car.standAng, -2.2 * dt, 2.2 * dt);
        car.stand.rotation.x = car.standAng;
      }
    } else {
      // Body on springs: roll outward under cornering, pitch under power and
      // braking, each following its target through a damped spring.
      const spring = (x, vel, target) => {
        const a = B.spring * B.spring * (target - x) - 2 * B.damp * B.spring * vel;
        vel += a * dt;
        return [x + vel * dt, vel];
      };
      [car.roll, car.rollV] = spring(car.roll, car.rollV, clamp(B.roll * car.latAcc, -B.rollMax, B.rollMax));
      [car.pitch, car.pitchV] = spring(car.pitch, car.pitchV, clamp(B.pitch * car.lonAcc, -0.06, 0.06));
      car.group.rotateZ(car.roll);   // load to the left rolls the body right
      car.group.rotateX(car.pitch);  // nose up under acceleration
    }

    // Steering: the front wheels turn into the road ahead and whatever the
    // car is steering across, and straighten (or counter-steer) as the tail
    // comes round in a drift. Bikes steer by leaning.
    if (vehicle !== 'moto') {
      const steerTarget = clamp(turn * 1.0 + car.yaw * 1.2 + car.drift * 1.0, -0.45, 0.45);
      car.steer += (steerTarget - car.steer) * Math.min(1, 9 * dt);
      for (const w of car.wheels) if (w.userData.front) w.rotation.y = -car.steer; // +Y turns the nose left
    }

    // Brake lights come on in the braking zone: when the car is carrying
    // more speed than the bend ahead (a driver's reaction time away, later
    // for an aggressive driver) can take for its class — and go off again
    // once it is in the corner. Real deceleration lights them too. The
    // formula car's single light is a rain light that flashes only in the
    // wet, each car on its own phase; the bike's stays on in the wet.
    {
      const look = v * car.brakePoint + 6;
      const uA = this.track.uAt(car.dist + look), uB = this.track.uAt(car.dist + look + 8);
      const tA = this.track.curve.getTangentAt(uA), tB = this.track.curve.getTangentAt(uB);
      const kAhead = Math.abs(Math.atan2(tA.x * tB.z - tA.z * tB.x, tA.dot(tB))) / 8;   // curvature ahead (1/m)
      const kHere = Math.abs(turn) / 8;
      // A corner worth braking for, by class (tighter than this radius), seen
      // coming while the road here is still straighter: one stab of brakes
      // per corner entry, its length the driver's, then nothing until the
      // next corner. Hard deceleration lights them for as long as it lasts.
      const rMin = { formula: 48, stock: 55, rally: 40, baja: 34, moto: 40 }[vehicle] || 45;
      const entry = kAhead > 1 / rMin && kHere < kAhead * 0.6 && v > 8;
      // Deceleration through a slow filter: the frame-to-frame figure is
      // noisy and would flicker the lights at the threshold.
      car.lonAccSlow = (car.lonAccSlow || 0) + (car.lonAcc - (car.lonAccSlow || 0)) * Math.min(1, 2.5 * dt);
      const hard = car.lonAccSlow < -5;
      car.brakeCool = Math.max(0, (car.brakeCool || 0) - dt);
      if (racing && (entry || hard) && car.brakeCool <= 0) {
        car.brakeHold = 0.35 + 0.35 * (car.brakePoint - 0.7) + (hard ? 0.3 : 0); // 0.35–0.9 s
        car.brakeCool = 2.2;
        car.lockUp = this.fxRand() < 0.4; // this stab leaves rubber
      }
      car.brakeHold = Math.max(0, car.brakeHold - dt);
      car.braking = racing && car.brakeHold > 0;
    }
    if (car.lamps.length) {
      let lit;
      if (vehicle === 'formula') lit = this.race.wet && racing && Math.floor((t + car.blinkPhase) * 4) % 2 === 0;
      else if (vehicle === 'moto') lit = this.race.wet && racing;
      else lit = car.braking;
      const mat = lit ? LAMP.on : LAMP.off;
      for (const l of car.lamps) { if (l.lens.material !== mat) l.lens.material = mat; l.glow.visible = lit; }
    }

    // DRS: the rear flap swings open above the activation speed and shuts
    // again below it, on hydraulics rather than instantly.
    if (car.drs) {
      const cruise = this.script.pace.cruise;
      if (!car.drsOpen && racing && v > cruise * 0.9 && t > 6) car.drsOpen = true;
      else if (car.drsOpen && (!racing || v < cruise * 0.82)) car.drsOpen = false;
      const target = car.drsOpen ? 0.78 : 0;
      car.drsAng += clamp(target - car.drsAng, -4.5 * dt, 4.5 * dt);
      car.drs.rotation.x = car.drsAng; // trailing edge lifts
    }

    // Wheels: spin with the road (capped where a frame rate can't show it),
    // and on gravel each one works its own bumps — slow and big at a crawl,
    // fast and small at speed — while the body rides level above them.
    if (B.bump) {
      const cruise = this.script.pace.cruise;
      car.bumpPhase += (2 + car.speed * 0.4) * dt;
      const amp = B.bump * (0.4 + 0.6 * (1 - Math.min(1, car.speed / cruise))) * Math.min(1, car.speed / 2);
      car.wheels.forEach((w, k) => {
        w.position.y = w.userData.restY + amp * noise1(car.bumpPhase + k * 1.7 + car.bounceP);
      });
    }
    for (const w of car.wheels) w.rotation.x -= Math.min(car.speed / (w.userData.radius || 0.45), WHEEL_OMEGA_MAX) * dt;

    // The steering wheel in the cockpit kit turns with the road ahead and
    // whatever the car is steering across, and the driver's hands go with it.
    if (this.kit && this.kit.parent === car.group) {
      car.group.updateMatrixWorld();
      this.updateClipPlanes(car);
      const wheel = this.kit.getObjectByName('wheel');
      if (wheel) {
        const target = clamp(turn * 3 + car.yaw * 4, -1.2, 1.2);
        wheel.rotation.z += (target - wheel.rotation.z) * Math.min(1, 10 * dt);
        this.driveHands(car, wheel.rotation.z, dt);
      }
      // Instruments. The needles are physical: they chase the car's state
      // through their own time constants every frame (a gear change drops
      // the revs, which then climb again), and the face is redrawn at 30 Hz.
      const cruise = this.script.pace.cruise;
      const gears = vehicle === 'formula' ? 8 : 6;
      const x = Math.max(0.02, Math.min(0.999, v / (cruise * 1.08))) * gears;
      // Hysteresis on the gear so it never chatters at a boundary.
      const up = Math.ceil(x), down = Math.ceil(x + 0.12);
      if (up > car.gear) car.gear = up; else if (down < car.gear) car.gear = down;
      car.gear = Math.max(1, Math.min(gears, car.gear));
      const rpmTarget = racing ? 0.32 + 0.62 * clamp(x - (car.gear - 1), 0, 1.05) : 0.1;
      // A fresh instrument (the camera just arrived) starts on the reading
      // rather than sweeping up from zero.
      if (car.needleFresh === undefined) { car.needleSpeed = v; car.needleRpm = rpmTarget; car.needleFresh = false; }
      car.needleSpeed += (v - car.needleSpeed) * (1 - Math.exp(-dt / 0.25));
      car.needleRpm += (rpmTarget - car.needleRpm) * (1 - Math.exp(-dt / 0.16));
      car.dashTimer -= dt;
      if (car.dashTimer <= 0) {
        car.dashTimer = 1 / 30;
        const laps = this.race.tour.laps;
        const lap = clamp(Math.floor(car.dist / this.script.lapLen) + 1, 1, laps);
        const lapText = this.track.open
          ? `${(clamp(car.dist, 0, this.script.totalDist) / 1000).toFixed(1)}/${(this.script.totalDist / 1000).toFixed(1)} KM`
          : `LAP ${lap}/${laps}`;
        updateInstruments(this.kit, {
          lapText, progress: clamp(car.dist / this.script.totalDist, 0, 1),
          speed: car.needleSpeed, rpm: car.needleRpm + 0.006 * Math.sin(t * 9), gear: car.gear, gears,
          braking: car.braking, wet: !!this.race.wet, drs: car.drsOpen,
          lap, laps, fuel: 1 - 0.85 * clamp(t / (this.script.T + 8), 0, 1), blink: Math.floor(t * 2) % 2 === 0,
          t, progress: clamp(car.dist / this.script.totalDist, 0, 1),
        });
      }
    }
  }

  // Two-bone IK from the shoulders to grips on the wheel rim. The hands ride
  // the rim as it turns; past a certain angle they let go and re-grip further
  // round, hand over hand, as a driver does in a hard corner.
  driveHands(car, wheelRot, dt) {
    const W = cockpitFor(this.race.tour.vehicle).wheel;
    if (!car.driver || !W) return;
    const REGRIP = 1.1; // radians of wheel turn a grip lasts before the hand moves round
    const follow = wheelRot - Math.round(wheelRot / REGRIP) * REGRIP;
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), W.tilt);
    // Grip point on the rim (car frame, where +X is the car's left): the
    // left hand at ten o'clock, the right at two.
    const grip = (side) => {
      const phi = (side === 'l' ? Math.PI / 6 : Math.PI * 5 / 6) + follow;
      return new THREE.Vector3(Math.cos(phi) * W.r, Math.sin(phi) * W.r, 0).applyQuaternion(tiltQ).add(new THREE.Vector3(W.x, W.y, W.z));
    };
    this.aimHands(car, car.driver, grip, 12, dt, { x: 0.25, y: -0.6, z: 0.1 });
  }

  // Aim a figure's hands at targets given in the car's frame. `rate` is how
  // fast a hand moves to a new target (0 = at once); `pole` says which way
  // the elbows go, in the figure's frame (mirrored for the right arm).
  aimHands(car, D, targetFor, rate, dt, pole) {
    const A = D.userData.arms;
    if (!A) return;
    D.updateMatrix();
    const inv = new THREE.Matrix4().copy(D.matrix).invert();
    for (const side of ['l', 'r']) {
      const arm = D.getObjectByName('arm_' + side), fore = D.getObjectByName('fore_' + side);
      const J = A[side];
      if (!arm || !fore || !J) continue;
      const T = targetFor(side).applyMatrix4(inv); // into the figure's frame
      const smooth = car['hand_' + side + D.name] || (car['hand_' + side + D.name] = T.clone());
      if (rate > 0) smooth.lerp(T, Math.min(1, rate * dt)); else smooth.copy(T);
      const S = new THREE.Vector3().fromArray(J.shoulder), E0 = new THREE.Vector3().fromArray(J.elbow), H0 = new THREE.Vector3().fromArray(J.hand);
      const L1 = E0.distanceTo(S), L2 = H0.distanceTo(E0);
      const toT = smooth.clone().sub(S);
      const d = clamp(toT.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
      const axis = toT.normalize();
      const poleV = new THREE.Vector3(side === 'l' ? pole.x : -pole.x, pole.y, pole.z);
      const poleDir = poleV.sub(axis.clone().multiplyScalar(poleV.dot(axis))).normalize();
      const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      const E = S.clone().addScaledVector(axis, L1 * cosA).addScaledVector(poleDir, L1 * sinA);
      const Tc = S.clone().addScaledVector(axis, d);
      // Upper arm: its rest direction onto shoulder->elbow. Forearm: rest onto
      // elbow->hand, expressed in the upper arm's frame.
      const q1 = new THREE.Quaternion().setFromUnitVectors(E0.clone().sub(S).normalize(), E.clone().sub(S).normalize());
      const q2 = new THREE.Quaternion().setFromUnitVectors(H0.clone().sub(E0).normalize(), Tc.sub(E).normalize());
      arm.quaternion.copy(q1);
      fore.quaternion.copy(q1.clone().invert().multiply(q2));
    }
  }

  surface(dt, t) {
    const vehicle = this.race.tour.vehicle;
    const grip = { formula: 32, stock: 16, rally: 12, baja: 9, moto: 18 }[vehicle] || 14;
    const cruise = this.script.pace.cruise;
    const rng = this.fxRand;
    const pt = new THREE.Vector3();
    for (const car of this.cars) {
      if (!car.tracks || !car.fwd) continue;
      const dirt = vehicle === 'rally' || vehicle === 'baja';
      // Dirt ruts deeper under braking, heavy cornering or a slide; tarmac
      // only takes rubber from a locked-up stab (every corner here would
      // otherwise exceed a load threshold — the tracks are tight for the pace).
      const loaded = Math.abs(car.latAcc) > grip * 0.9 || Math.abs(car.drift) > 0.15;
      const hard = dirt ? (car.braking || loaded) : (car.braking && car.lockUp);
      car.group.updateMatrixWorld();
      for (const tr of car.tracks) {
        pt.set(tr.wheel.position.x, 0, tr.wheel.position.z);
        car.group.localToWorld(pt);
        pt.y = car.groundY + 0.075;
        this.fx.wheel(tr, pt, hard, car.jumped);
        this.fx.emit(pt, car.fwd, car.left, car.speedS, cruise, hard, dt, rng);
      }
      car.jumped = false;
    }
  }

  // Where a car's wheels will be when it stops in its box, and where its
  // crew should stand: a mechanic outboard of each wheel, the chief ahead.
  pitJob(i, ps) {
    const car = this.cars[i];
    const C = this.pits.carAt(ps.boxF, ps.boxF);
    const left = new THREE.Vector3(-C.t.z, 0, C.t.x); // the car's +X in the world
    const wheels = [], lookAt = [], spots = [];
    for (const w of car.wheels) {
      const world = C.p.clone().addScaledVector(C.t, w.position.z).addScaledVector(left, w.position.x);
      lookAt.push(world);
      spots.push(world.clone().addScaledVector(left, Math.sign(w.position.x || 1) * 0.95).setY(C.p.y));
    }
    const chief = C.p.clone().addScaledVector(C.t, car.length / 2 + 1.9).addScaledVector(left, -this.pits.side * 0.9).setY(C.p.y);
    return { carIdx: i, tArrive: ps.tBox, tLeave: ps.tLeave, wheels: spots, lookAt, chief, chiefLook: C.p.clone(), forward: C.t.clone() };
  }

  // Point sprites need the viewport to size themselves in metres.
  setCamera(camera, viewportHeight) { this.fx.setCamera(camera, viewportHeight); }

  standingsNow(tRace) {
    return this.script.standings(clamp(tRace / this.script.T, 0, 1), this.adj);
  }

  dispose() {
    this.fx.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
      }
    });
  }
}
