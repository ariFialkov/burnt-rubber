// Race script generation. A race is fully determined the moment betting
// opens: finish order and scripted facts are drawn from the same seeded
// probability model the odds were priced from (that's the whole RTP story).
// What stays "alive" is the choreography — smooth gap curves with drama
// harmonics create overtakes and swings all race while converging to the
// scripted result. A per-focus-racer "director" layer bakes popup-bet
// events (drawn at their priced probability) into the choreography.

import { rngFor, sampleOrder, clamp, lerp, smoothstep } from '../core/rng.js';
import { scriptWeights } from './odds.js';
import { RACE_S } from './schedule.js';

export const LEADER_FINISH_S = 40; // base race: the pace car's 40 seconds; tours scale the distance

// How each class of vehicle moves: launch acceleration (m/s²) and cruising
// speed (m/s). The pace car — the virtual leader every gap is measured
// against — pulls away from the line at `accel` and levels off at `cruise`,
// so a formula car is gone in a blink, a stock car winds up slowly to a
// higher speed, and a trophy truck lumbers. The race distance follows from
// the profile: it is wherever the pace car gets to by LEADER_FINISH_S.
export const PACE = {
  formula: { accel: 14, cruise: 78 },
  stock:   { accel: 6,  cruise: 80 },
  rally:   { accel: 8,  cruise: 48 },
  moto:    { accel: 13, cruise: 55 },
  baja:    { accel: 4.5, cruise: 36 },
};

// Grid geometry (m): row pitch per vehicle, and how far the pole sits behind
// the line. Two staggered columns, so the pitch is per car, not per row.
export const GRID_PITCH = { formula: 7, stock: 6, rally: 6, moto: 4.5, baja: 7 };

// Pit stops, on the loop tours. Every car pits once, on the pit lap, through
// a lane that spans `span` metres of track distance around the start line.
// `vLane` is the lane speed limit; the stationary stop time per car is drawn
// log-normally around `median` (so the over/under `line` prices from the
// same distribution the stop is drawn from). A car brakes from race pace
// to the lane limit at `brakeA` (m/s²) once it is on the entry ramp, and
// pulls away from the lane end at `accelA` back up to pace; `brake` and
// `launch` are its seconds from lane speed to a standstill at its box and
// back up to lane speed.
export const PIT = {
  formula: { span: 230, vLane: 24, line: 2.5, median: 2.62, sigma: 0.22, brakeA: 60, accelA: 12, boxFrom: 0.3, boxPitch: 6, brake: 1.1, launch: 1.6 },
  stock:   { span: 230, vLane: 24, line: 4.5, median: 4.7, sigma: 0.2, brakeA: 55, accelA: 13, boxFrom: 0.31, boxPitch: 6, brake: 1.2, launch: 2.0 },
  moto:    { span: 190, vLane: 18, line: 3.5, median: 3.66, sigma: 0.22, brakeA: 40, accelA: 11, boxFrom: 0.3, boxPitch: 5, brake: 1.1, launch: 1.8 },
};

// Standard normal tail via erf.
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x < 0 ? -y : y; }
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export const GRID_OFFSET = 12;

const scriptCache = new Map();

const drawFrom = (rand, probs) => {
  let r = rand();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
};

// Smooth bump: 0 at s0 and s1, peak 1 at sp, each side a half-cosine, so the
// rise and the fade can have different lengths.
const bump = (s, s0, sp, s1) => {
  if (s <= s0 || s >= s1) return 0;
  const x = s < sp ? (s - s0) / (sp - s0) : (s1 - s) / (s1 - sp);
  return 0.5 * (1 - Math.cos(Math.PI * x));
};

// Drama window: nothing until the field is up to speed (a swing measured in
// seconds is a lot of road at launch pace and would run cars backwards),
// everything settled by the flag. `v` is the pace car's speed as a fraction
// of cruise.
function dramaWindow(s, v) {
  const up = clamp((v - 0.5) / 0.4, 0, 1);
  const down = clamp((0.93 - s) / 0.1, 0, 1);
  return up * up * (3 - 2 * up) * (down * down * (3 - 2 * down));
}

export function getScript(race) {
  if (scriptCache.has(race.key)) return scriptCache.get(race.key);
  if (scriptCache.size > 40) scriptCache.clear();

  const n = race.field.length;
  const rand = rngFor('script-v1', race.key);
  const W = scriptWeights(race);

  // --- Scripted facts, drawn at the exact probabilities they were priced at.
  const finishOrder = sampleOrder(rand, W.win);          // indices, winner first
  const margin = -1.73 * Math.log(Math.max(1e-9, rand())); // median 1.2s => O/U 1.2 is a coin flip
  const holeshotIdx = drawFrom(rand, W.holeshot);
  const fastestLapIdx = drawFrom(rand, W.fastestLap);
  const fastestLapS = 0.45 + rand() * 0.35;              // announced mid-race

  // --- Final gaps behind the winner (seconds). Compressed for big fields so
  // the whole field finishes inside the broadcast window.
  const gapInc = Math.min(0.5, 7 / n);
  const finalGap = new Array(n);
  let acc = 0;
  finishOrder.forEach((racerI, k) => {
    if (k === 0) acc = 0;
    else if (k === 1) acc = Math.max(0.12, margin);
    else acc += 0.15 + gapInc * (0.5 + rand());
    finalGap[racerI] = acc;
  });

  // --- Grid: seeded "qualifying" correlated with strength.
  const qualScore = race.weights.map((w) => w * (0.6 + rand() * 0.8));
  const grid = race.field.map((_, i) => i).sort((a, b) => qualScore[b] - qualScore[a]);
  const gridGap = new Array(n);
  grid.forEach((racerI, k) => { gridGap[racerI] = k * (n > 20 ? 0.22 : 0.35); });
  const gridSlotOf = new Array(n);
  grid.forEach((racerI, k) => { gridSlotOf[racerI] = k; });

  const pace = PACE[race.tour.vehicle] || PACE.formula;
  const { accel, cruise } = pace;
  // Pace-car launch: v = cruise·tanh(accel·t/cruise) starts at `accel` and
  // eases into `cruise` with no knee; its integral is the distance.
  const launchSpeed = (t) => cruise * Math.tanh((accel * t) / cruise);
  const launchDist = (t) => ((cruise * cruise) / accel) * Math.log(Math.cosh((accel * t) / cruise));
  // The race distance is the base 40 seconds' worth scaled by the tour (an
  // extra lap on a loop, a longer stage); the leader's time follows from it.
  const totalDist = launchDist(LEADER_FINISH_S) * (race.tour.distScale ?? 1);
  const lapLen = totalDist / race.tour.laps;
  const paceMps = cruise;

  // Pit laps. Every car pits once, entering the lane at the end of one of
  // laps 1..laps-1; the field is spread over those windows with team-mates
  // never on the same one. The reference (pace car) itself slows through
  // the lane on a car's pit lap — to the speed that spends the lane time
  // plus the field's mean stop there, without stopping — so a car only has
  // its own stop's deviation from the mean to carry afterwards. Each pit
  // lap gets its own reference profile; all of them cost exactly the same
  // time, so they coincide again once the last lane is done and the
  // scripted gaps mean the same thing at the flag whatever lap a car chose.
  const pitSpec = race.tour.laps > 2 ? PIT[race.tour.vehicle] || null : null;
  let pit = null;
  if (pitSpec) {
    // Windows: the end of every lap but the last (the lane rejoins well
    // before the line, so even a last-lap stop is done before the flag).
    const dInAt = (k) => k * lapLen - 0.55 * pitSpec.span;
    const windows = race.tour.laps - 1;
    const dMean = pitSpec.median * Math.exp(pitSpec.sigma * pitSpec.sigma / 2);
    const { span, vLane, brakeA, accelA, brake, launch } = pitSpec;
    // braking on the entry ramp, and the pull-away past the lane end
    const Ld = (cruise * cruise - vLane * vLane) / (2 * brakeA);
    const La = (cruise * cruise - vLane * vLane) / (2 * accelA);
    // what the lane costs a car with the mean stop, against running the
    // same road at cruise: the reference's slow section is solved to match
    const laneTime = (cruise - vLane) / brakeA + (span - Ld - vLane * (brake + launch) / 2) / vLane + brake + dMean + launch + (cruise - vLane) / accelA;
    const meanCost = laneTime - (span + La) / cruise;
    const vEff = span / (span / vLane + dMean); // a first guess for the slow section
    const dIn = dInAt(1);
    pit = { ...pitSpec, windows, dInAt, dIn, dOut: dIn + span, Ld, La, meanCost, vEff, dMean, uIn: ((dIn / lapLen) % 1 + 1) % 1, uOut: (((dIn + span) / lapLen) % 1 + 1) % 1 };
  }
  // Reference profiles as tables: the launch, then cruise, with a lane's
  // decel / slow section / accel cut in by distance on pit lap k (k = 0:
  // no lane at all).
  const DT = 0.02;
  const buildProfile = (dIn, vEff) => {
    const tT = [0], xX = [0], vV = [0];
    const dOut = dIn == null ? 0 : dIn + pit.span;
    const c2 = cruise * cruise, e2 = vEff * vEff;
    const targetAt = (x0) => {
      if (dIn == null) return cruise;
      const xx = x0 - GRID_OFFSET; // drawn distance: the line is GRID_OFFSET into the reference's run
      if (xx < dIn || xx > dOut + pit.La) return cruise;
      if (xx < dIn + pit.Ld) return Math.sqrt(c2 - (c2 - e2) * (xx - dIn) / pit.Ld); // constant deceleration on the entry ramp
      if (xx <= dOut) return vEff;
      return Math.sqrt(e2 + (c2 - e2) * (xx - dOut) / pit.La);                      // constant acceleration past the lane end
    };
    let t = 0, x = 0;
    while (t < 260) {
      const v = Math.min(launchSpeed(t), targetAt(x));
      x += v * DT; t += DT;
      tT.push(t); xX.push(x); vV.push(v);
    }
    const dist = (tq) => {
      if (tq <= 0) return 0;
      const k = tq / DT, i = Math.floor(k);
      if (i >= xX.length - 1) return xX[xX.length - 1] + cruise * (tq - tT[tT.length - 1]);
      return lerp(xX[i], xX[i + 1], k - i);
    };
    const speed = (tq) => (tq <= 0 ? 0 : vV[Math.min(vV.length - 1, Math.round(tq / DT))]);
    // Inverse: reference time at a distance (0 for anything before the line).
    const time = (xq) => {
      if (xq <= 0) return 0;
      let lo = 0, hi = xX.length - 1;
      if (xq >= xX[hi]) return tT[hi] + (xq - xX[hi]) / cruise;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xX[mid] < xq) lo = mid; else hi = mid; }
      return lerp(tT[lo], tT[hi], (xq - xX[lo]) / Math.max(1e-6, xX[hi] - xX[lo]));
    };
    return { dist, speed, time, dIn, dOut, vEff: vEff ?? cruise };
  };
  const profiles = new Map();
  profiles.set(0, buildProfile(null, null));
  if (pit) {
    // each lap's slow-section speed is solved so the lane costs the
    // reference exactly what it costs a car with the mean stop (the launch
    // may still be running through lap 1's lane, so it is per lap)
    const clean = profiles.get(0).time(totalDist);
    for (let k = 1; k <= pit.windows; k++) {
      let lo = 2, hi = pit.vLane, P = null;
      for (let it = 0; it < 26; it++) {
        const mid = (lo + hi) / 2;
        P = buildProfile(pit.dInAt(k), mid);
        if (P.time(totalDist) - clean > pit.meanCost) lo = mid; else hi = mid;
      }
      profiles.set(k, P);
    }
  }
  const profileOf = (k) => profiles.get(k) || profiles.get(0);
  const paceDist = (t, k = 0) => profileOf(k).dist(t);
  const paceSpeed = (t, k = 0) => profileOf(k).speed(t);
  const paceTime = (x, k = 0) => profileOf(k).time(x);
  const T = paceTime(totalDist, pit ? 1 : 0);

  // A gap is kept in seconds, but drawn in metres. At cruise a second is a
  // cruise-speed's worth of road; on the grid it is one row pitch, so that
  // the whole field starts from its real slots and launches together instead
  // of waiting for its time gap to elapse. The conversion ramps between the
  // two over the launch, so the pack stretches out as the speed builds.
  const pitch = GRID_PITCH[race.tour.vehicle] || 7;
  const gridStep = n > 20 ? 0.22 : 0.35;
  const metresPerSecOnGrid = pitch / gridStep;
  const rampT = (2 * cruise) / accel;
  const gapScale = (t) => {
    const x = clamp(t / rampT, 0, 1);
    const r = x * x * (3 - 2 * x);
    return lerp(metresPerSecOnGrid, cruise, r);
  };

  // --- Drama harmonics per racer (inconsistent racers swing harder).
  const harmonics = race.field.map((r, i) => {
    const amp = (0.5 + (1 - r.stats.consistency / 100) * 1.6) * (n > 20 ? 1.5 : 1);
    const parts = [];
    for (let j = 0; j < 3; j++) {
      parts.push({ a: amp * (0.35 + rand() * 0.65) / 3, f: 0.7 + rand() * 2.2, ph: rand() * Math.PI * 2 });
    }
    return parts;
  });

  // --- Enforcement bumps (holeshot leading at the lap-1 mark, etc.)
  const enforce = [];
  // The lap-1 mark in race time, from the pace profile (a slow launch makes
  // the first lap the longest). A point-to-point stage has no lap: the mark
  // is an early split instead.
  const markDist = race.tour.laps === 1 ? lapLen * 0.3 : Math.min(lapLen * 0.9, pit ? pit.dIn - 30 : Infinity);
  const lap1S = (() => {
    let lo = 0, hi = T;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (paceDist(mid) - GRID_OFFSET < markDist) lo = mid; else hi = mid; }
    return lo / T;
  })();

  // Base gap curve (seconds behind the virtual pace car) before enforcement.
  function rawGap(i, s) {
    const ease = s * s * (3 - 2 * s);
    let g = lerp(gridGap[i], finalGap[i], ease);
    const w = dramaWindow(s, launchSpeed(s * T) / cruise); // the launch, not the lane: the reference crawling through the pits is no reason to freeze the drama
    for (const h of harmonics[i]) g += w * h.a * Math.sin(2 * Math.PI * h.f * s + h.ph);
    return g;
  }

  // A surge or a fade is a bump on the gap curve. Its slope is a speed
  // change — a second of gap per second is a whole pace-car's worth — so a
  // bump that would be too steep starts earlier instead, and nothing starts
  // before the field is up to speed. That keeps a charging car at no more
  // than about one and a half times the pace and a fading one always moving.
  const GAP_RATE = 0.45;
  const upToSpeed = (Math.atanh(0.6) * cruise / accel) / T; // pace car at 60% of cruise
  const SETTLED = 0.93;
  // A bump peaking midway through [s0, s1]: the rise starts earlier and the
  // fade runs later (never past SETTLED) as far as the rate needs.
  function shape(s0, s1, amp) {
    const half = (Math.PI * Math.abs(amp)) / (2 * GAP_RATE * T);
    const sp = Math.max((s0 + s1) / 2, upToSpeed + 0.02);
    s0 = Math.max(upToSpeed, Math.min(s0, sp - half));
    s1 = Math.max(Math.min(SETTLED, Math.max(s1, sp + half)), sp + 0.02);
    return { s0, sp, s1, amp };
  }
  // The largest bump that can peak at sp without breaking the rate.
  const maxAmp = (sp) => (Math.min(sp - upToSpeed, SETTLED - sp) * 2 * GAP_RATE * T) / Math.PI;

  // Make the drawn holeshot racer actually lead at the lap-1 mark.
  {
    let minOther = Infinity;
    for (let i = 0; i < n; i++) if (i !== holeshotIdx) minOther = Math.min(minOther, rawGap(i, lap1S));
    const need = rawGap(holeshotIdx, lap1S) - minOther + 0.25;
    // Peaks at the mark; the fade back to the scripted gap runs long.
    if (need > 0) {
      const sh = shape(lap1S - 0.16, lap1S + 0.16, -need);
      const half = (Math.PI * need) / (2 * GAP_RATE * T);
      sh.sp = lap1S;
      sh.s0 = Math.max(upToSpeed, Math.min(sh.s0, lap1S - half)); // the rise stays inside the rate limit
      sh.s1 = Math.max(sh.s1, Math.min(SETTLED, lap1S + 0.3));
      enforce.push({ i: holeshotIdx, ...sh });
    }
  }

  function gapSec(i, s, adj) {
    let g = rawGap(i, s);
    for (const e of enforce) if (e.i === i) g += e.amp * bump(s, e.s0, e.sp, e.s1);
    if (adj) g += adj(i, s);
    return g;
  }

  // --- Time warp after the race: the reference's clock eases to a halt a
  // couple of seconds after the last car is home, so the field coasts to a
  // stop instead of lapping forever.
  const maxGap = Math.max(...finalGap);
  const tEnd = T + maxGap + 2;
  const COAST = 6;
  const warp = (t) => (t <= tEnd ? Math.max(0, t) : tEnd + COAST * (1 - Math.exp(-(t - tEnd) / COAST)));

  // --- A gap in seconds, drawn in metres. On the grid and through the launch
  // a second is `gapScale` metres (row pitch ramping to cruise). Once a car is
  // up to speed the gap is a true time shift: the car is where the reference
  // was g seconds ago — which is what puts every car through the pit lane's
  // slow section at the lane, not wherever it happens to be when the
  // reference gets there.
  // The handover runs while the reference is between half and four fifths
  // of cruise: early enough that a slow-launching class (the stock cars take
  // most of a lap to reach cruise) is on the time shift before the pit lap,
  // where the linear form would have cars backing up as the reference
  // crawls through the lane.
  const shiftAt = (frac) => (Math.atanh(frac) * cruise) / accel;
  const shiftFrom = shiftAt(0.5), shiftTo = shiftAt(0.8);
  const offsetMetres = (g, tw, k = 0) => {
    const tau = tw - g;
    const linear = g * gapScale(tw);
    if (tau <= shiftFrom) return linear;
    const shifted = paceDist(tw, k) - paceDist(tau, k);
    if (tau >= shiftTo) return shifted;
    return lerp(linear, shifted, smoothstep((tau - shiftFrom) / (shiftTo - shiftFrom)));
  };

  // --- Per-car pit stops. Stop times drawn now; the timing of each car's
  // stop depends on the gap curve it is running (the focus layer adjusts
  // gaps), so it is resolved per adjustment and cached.
  const teams = []; const boxOf = new Array(n); const lapOf = new Array(n).fill(0);
  race.field.forEach((r, i) => { let k = teams.indexOf(r.team); if (k < 0) { k = teams.length; teams.push(r.team); } boxOf[i] = k * 2 + race.field.slice(0, i).filter((q) => q.team === r.team).length; });
  const stopOf = new Array(n).fill(0);
  if (pit) {
    // Pit laps: teams dealt round the windows in a seeded order, a team's
    // two cars on consecutive windows — so the field is spread evenly and
    // no garage ever has both its cars in the lane at once.
    const order = sampleOrder(rand, teams.map(() => 1));
    order.forEach((teamIdx, j) => {
      let seat = 0;
      race.field.forEach((r, i) => { if (r.team === teams[teamIdx]) { lapOf[i] = ((j + seat) % pit.windows) + 1; seat++; } });
    });
    for (let i = 0; i < n; i++) {
      const u1 = Math.max(1e-6, rand()), u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      stopOf[i] = clamp(pit.median * Math.exp(pit.sigma * z), pit.median * 0.6, pit.median * 2.2);
    }
  }
  const pitCache = new Map();
  // Everything about car i's stop under gap adjustment `adj`: real times of
  // entry, box arrival, departure and exit, plus the reference-time path.
  // Before its stop a car runs a little ahead of (or behind) its scripted
  // gap, rising smoothly from the launch to the lane entry, by exactly what
  // the stop will cost it against the reference — so it exits the lane on
  // its scripted trajectory with nothing to claw back.
  // The rise runs over a window fixed from the car's uncorrected entry (so
  // the correction's gain at the lane is 1 and the solve converges), ending
  // PRE_MAX+2 s before it — any car reaching the lane earlier by the whole
  // correction still finds the rise complete. Anything past the cap rides
  // out of the lane and fades afterwards.
  // The window opens once the field is on the time shift (a gap change
  // during the launch is amplified by the grid-to-cruise conversion) and
  // the correction is capped at a modest share of the window, so it never
  // reads as a car on a mission; a short window (an early stop) leaves
  // more to the fade after the lane, which then has the whole race to go.
  const PRE_MAX = 4, PRE_RATE = 0.12;
  const preWin = (sEnter) => { const s1 = Math.max(shiftTo / T + 0.1, sEnter - (PRE_MAX + 2) / T); const s0 = Math.max(shiftTo / T + 0.02, Math.min(upToSpeed + 0.02, s1 - 0.15)); return [s0, Math.max(s1, s0 + 0.04)]; };
  const preRise = (s, sEnter) => { const [s0, s1] = preWin(sEnter); return smoothstep(clamp((s - s0) / (s1 - s0), 0, 1)); };
  function pitFor(i, adj) {
    if (!pit) return null;
    const key = adj || 'base';
    let per = pitCache.get(key);
    if (!per) { per = new Array(n).fill(undefined); pitCache.set(key, per); }
    if (per[i] !== undefined) return per[i];
    const k = lapOf[i], prof = profileOf(k);
    const dIn = prof.dIn, dOut = prof.dOut;
    const xBox = pit.span * pit.boxFrom + boxOf[i] * pit.boxPitch;     // the box, along the lane
    let pre = 0, sEnterGuess = 0.5, info = null;
    for (let pass = 0; pass < 8; pass++) {
      const usedPre = pre, usedS = sEnterGuess;
      // real time at which the (corrected) trajectory reaches the lane entry
      const gapAt = (tw) => { const s = clamp(tw / T, 0, 1); return gapSec(i, s, adj) - usedPre * preRise(s, usedS); };
      const baseDist = (tw) => paceDist(tw, k) - offsetMetres(gapAt(tw), tw, k) - GRID_OFFSET;
      let lo = 0, hi = tEnd;
      for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (baseDist(mid) < dIn) lo = mid; else hi = mid; }
      const tEnter = lo;
      const v0 = clamp((baseDist(tEnter) - baseDist(tEnter - 0.1)) / 0.1, pit.vLane + 1, cruise * 1.2); // arriving speed
      info = laneRun(tEnter, v0, xBox, i, k, adj);
      info.pre = usedPre; info.sEnter = usedS; info.lap = k; info.dIn = dIn; info.dOut = dOut;
      if (Math.abs(info.dev) < 0.02) break;
      if (pass === 0) sEnterGuess = tEnter / T;           // the window is set once, from the uncorrected entry
      const [w0, w1] = preWin(sEnterGuess);
      const cap = Math.min(PRE_MAX, PRE_RATE * (w1 - w0) * T);
      pre = clamp(usedPre + 0.85 * info.dev, -cap, cap);
      if (pre === usedPre) break;                          // capped: the rest fades after the lane
    }
    per[i] = info;
    return info;
  }
  // A car's own run through the lane, from the entry at v0: brake to the
  // lane limit on the ramp, hold it to the box, brake to a standstill, the
  // stop, launch back to the limit, hold it to the lane end, then pull
  // away up to pace. Distances along the lane from its entry.
  function laneRun(tEnter, v0, xBox, i, k, adj) {
    const { span, vLane, brake: B, launch: L, accelA } = pit;
    const D = stopOf[i];
    const xStop = xBox - vLane * B / 2;                                  // where the box braking starts
    const aB = Math.max(pit.brakeA, (v0 * v0 - vLane * vLane) / (2 * Math.max(6, xStop - 4))); // always down to the limit before the box braking
    const Lb = (v0 * v0 - vLane * vLane) / (2 * aB), tb = (v0 - vLane) / aB;
    const t1 = tEnter + tb;                                              // at the lane limit
    const t2 = t1 + Math.max(0, xStop - Lb) / vLane;                     // box braking starts
    const tBox = t2 + B, tLeave = tBox + D;
    const xGo = xBox + vLane * L / 2;                                    // back at the limit
    const t3 = tLeave + L;
    const tExit = t3 + Math.max(0, span - xGo) / vLane;                  // lane end
    // The pull-away ends where the reference's own does, at the speed the
    // car's scripted trajectory is running there (its gap may be opening
    // or closing at the time) — so the hand-back to the gap curve is
    // seamless in position and speed alike.
    const xCruise = span + pit.La;
    let aX = accelA, ta = (cruise - vLane) / accelA, tCruise = tExit + ta;
    for (let it = 0; it < 3; it++) {
      const slope = (gapSec(i, clamp((tCruise + 0.05) / T, 0, 1), adj) - gapSec(i, clamp((tCruise - 0.05) / T, 0, 1), adj)) / 0.1;
      const vEnd = clamp(cruise * (1 - slope), vLane + 4, cruise * 1.2);
      aX = clamp((vEnd * vEnd - vLane * vLane) / (2 * pit.La), accelA * 0.3, accelA * 1.8);
      ta = (Math.sqrt(vLane * vLane + 2 * aX * pit.La) - vLane) / aX;
      tCruise = tExit + ta;
    }
    const xAt = (tw) => {
      if (tw < t1) { const e = tw - tEnter; return v0 * e - aB * e * e / 2; }
      if (tw < t2) return Lb + vLane * (tw - t1);
      if (tw < tBox) { const e = tw - t2; return xStop + vLane * e - vLane * e * e / (2 * B); }
      if (tw < tLeave) return xBox;
      if (tw < t3) { const e = tw - tLeave; return xBox + vLane * e * e / (2 * L); }
      if (tw < tExit) return xGo + vLane * (tw - t3);
      const e = Math.min(tw - tExit, ta);
      return span + vLane * e + aX * e * e / 2;
    };
    const dIn = profileOf(k).dIn;
    // the gap the car is back on pace with, versus its scripted gap there
    const gExit = tCruise - paceTime(dIn + xCruise + GRID_OFFSET, k);
    const dev = gExit - gapSec(i, clamp(tCruise / T, 0, 1), adj);
    return { tEnter, tBox, tLeave, tExit, tCruise, D, dBox: dIn + xBox, dev, xAt, v0, boxIdx: boxOf[i] };
  }
  // The stop's deviation from the mean fades out by the settled point.
  const devFade = (tw, tExit) => { const s0 = tExit / T, s1 = Math.max(s0 + 0.08, 0.96); const s = tw / T; if (s <= s0) return 1; if (s >= s1) return 0; const x = (s - s0) / (s1 - s0); return 0.5 + 0.5 * Math.cos(Math.PI * x); };

  const script = {
    race, T, lapLen, totalDist, paceMps, pace, pitch, raceS: RACE_S, tEnd, runOff: cruise * (maxGap + 2 + COAST) + 80,
    paceSpeed, paceDist, paceTime, gapScale, warp,
    shape, upToSpeed, maxAmp,
    grid, gridSlotOf, finishOrder, finalGap, margin,
    holeshotIdx, fastestLapIdx, fastestLapS,
    gapSec, pit, pitFor, pitReset: (adj) => { pitCache.delete(adj || 'base'); }, stopOf, boxOf, lapOf, teams, offsetMetres, preRise,
    // Distance along the track in metres at race-time t (seconds), with the
    // start line at 0. At t=0 every car sits in its grid slot; in its pit
    // window a car is on the lane's kinematics; after the last car is home
    // the clock eases to a halt.
    distance(i, t, adj) {
      const tw = warp(t);
      const p = pit ? pitFor(i, adj) : null;
      const k = p ? p.lap : 0;
      if (p && tw >= p.tEnter && tw < p.tCruise) return p.dIn + p.xAt(tw);
      const s = clamp(tw / T, 0, 1);
      let g = gapSec(i, s, adj);
      if (p) g += tw < p.tEnter ? -p.pre * preRise(s, p.sEnter) : p.dev * devFade(tw, p.tCruise);
      return paceDist(tw, k) - offsetMetres(g, tw, k) - GRID_OFFSET;
    },
    // Where car i is in its pit stop at race-time t, or null.
    pitState(i, t, adj) {
      const p = pit ? pitFor(i, adj) : null;
      if (!p) return null;
      const tw = warp(t);
      const inLane = tw >= p.tEnter && tw < p.tExit;
      return { ...p, inLane, f: inLane ? clamp(p.xAt(tw) / pit.span, 0, 1) : null, boxF: (p.dBox - p.dIn) / pit.span,
        stopped: tw >= p.tBox && tw < p.tLeave, stopT: clamp(tw - p.tBox, 0, p.D), tw };
    },
    // Ranked indices at normalized time s (furthest along = P1).
    standings(s, adj) {
      const idx = race.field.map((_, i) => i);
      const t = Math.max(0, s) * T; // past the flag the tail is still racing (a last-lap stop included)
      const d = idx.map((i) => this.distance(i, t, adj));
      return idx.sort((a, b) => d[b] - d[a]);
    },
    rankOf(i, s, adj) {
      return this.standings(s, adj).indexOf(i) + 1;
    },
    // Time gap of car i behind car j at race-time t, in seconds of the
    // reference's clock (so it holds through the launch and the pits).
    // Measured on the clean reference, so it is the gap as seen on the road.
    timeGap(i, j, t, adj) {
      return paceTime(this.distance(j, t, adj) + GRID_OFFSET) - paceTime(this.distance(i, t, adj) + GRID_OFFSET);
    },
    finished(t) { return t >= T + maxGap + 1; },
  };
  script.maxGap = maxGap;
  scriptCache.set(race.key, script);
  return script;
}

// ---------------------------------------------------------------------------
// Focus layer: popup in-race bets for one spectated racer. Deterministic per
// (race, focusIdx). Outcomes are drawn at the model probability the popup is
// priced from (RTP-consistent), then choreographed into the gap curves; the
// settlement of record is what actually plays out on screen.
// ---------------------------------------------------------------------------

const focusCache = new Map();

export function getFocusLayer(race, focusIdx) {
  const key = `${race.key}@${focusIdx}`;
  if (focusCache.has(key)) return focusCache.get(key);
  if (focusCache.size > 40) focusCache.clear();

  const script = getScript(race);
  const rand = rngFor('focus-v1', race.key, String(focusIdx));
  const n = race.field.length;
  const T = script.T;
  const impulses = []; // {i, s0, s1, amp}
  const adj = (i, s) => {
    let g = 0;
    for (const im of impulses) if (im.i === i) g += im.amp * bump(s, im.s0, im.sp, im.s1);
    return g;
  };

  const wSelf = race.weights[focusIdx];
  const popups = [];
  // Three windows through the race, the first once the field is up to speed.
  const slots = [Math.max(0.16, script.upToSpeed + 0.05) + rand() * 0.08, 0.42 + rand() * 0.1, 0.64 + rand() * 0.08];
  // The pit stop: an over/under on the stationary time, offered as the car
  // heads for the lane. Popup windows that would overlap the stop move past it.
  const pitInfo = script.pit ? script.pitFor(focusIdx, adj) : null;
  if (pitInfo) {
    const sIn = pitInfo.tEnter / T, sOut = pitInfo.tCruise / T;
    // a slot that would overlap the stop moves ahead of it if there is room
    // once the field is up to speed, else past it
    let before = 0, after = 0;
    for (let k = 0; k < slots.length; k++) {
      const s0 = slots[k], s1 = s0 + 0.24;
      if (!(s1 > sIn - 0.04 && s0 < sOut + 0.04)) continue;
      const early = sIn - 0.06 - 0.24 - before * 0.12;
      if (early >= Math.max(0.16, script.upToSpeed + 0.05)) { slots[k] = early; before++; }
      else { slots[k] = Math.min(0.72, sOut + 0.05 + after * 0.12); after++; }
    }
    const P = script.pit;
    const pOver = 1 - normCdf(Math.log(P.line / P.median) / P.sigma);
    popups.push({
      id: `${key}#pit`, kind: 'pit', p: pOver, pUnder: 1 - pOver, sides: true, focusIdx,
      line: P.line, D: pitInfo.D,
      text: (f) => `${f.short} pits: stop time over ${P.line.toFixed(1)}s?`,
      offerS: Math.max(0.05, sIn - 8 / T), s0: sIn, s1: pitInfo.tLeave / T,
      result: pitInfo.D > P.line,
    });
  }

  for (let sI = 0; sI < slots.length; sI++) {
    const s0 = slots[sI];
    const order = script.standings(s0, adj);
    const rank = order.indexOf(focusIdx) + 1;
    // Only offer what the choreography can actually deliver: a surge that
    // would have to be steeper than the rate limit allows is not on the menu.
    const kinds = [];
    if (rank > 1) {
      const target = order[rank - 2];
      const gap = script.gapSec(focusIdx, s0, adj) - script.gapSec(target, s0, adj);
      if ((gap + 0.3) * 1.2 <= script.maxAmp((s0 + Math.min(0.9, s0 + 0.1) + 0.14) / 2)) kinds.push('overtake');
    }
    if (rank > 3) {
      const sm = s0 + 0.11;
      const need = script.gapSec(focusIdx, sm, adj) - script.gapSec(order[Math.max(1, rank - 2) - 1], sm, adj);
      if ((need + 0.35) * 1.25 <= script.maxAmp((s0 + Math.min(0.9, s0 + 0.22) + 0.1) / 2)) kinds.push('reach');
    }
    if (rank < n) {
      const chaser = order[rank];
      const gapBehind = script.gapSec(chaser, s0, adj) - script.gapSec(focusIdx, s0, adj);
      if ((gapBehind + 0.35) * 1.2 <= script.maxAmp((s0 + Math.min(0.92, Math.min(0.9, s0 + 0.22) + 0.12)) / 2)) kinds.push('hold');
    }
    if (!kinds.length) continue; // nothing deliverable from here: no popup this slot
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const winS = [s0, Math.min(0.9, s0 + (kind === 'overtake' ? 0.1 : 0.22))];

    let popup = null;
    if (kind === 'overtake') {
      const targetIdx = order[rank - 2]; // car directly ahead
      const gapNow = script.gapSec(focusIdx, s0, adj) - script.gapSec(targetIdx, s0, adj);
      const pw = wSelf / (wSelf + race.weights[targetIdx]);
      const p = clamp(0.62 * pw + 0.28 - gapNow * 0.16, 0.07, 0.72);
      const yes = rand() < p;
      if (yes) impulses.push({ i: focusIdx, ...script.shape(winS[0], winS[1] + 0.14, -(gapNow + 0.3) * 1.2) });
      else impulses.push({ i: focusIdx, ...script.shape(winS[0], winS[1], Math.max(0.1, 0.5 - gapNow)) });
      popup = {
        kind, p, targetIdx,
        text: (f, t) => `${f.short} to overtake ${t.short} in the next ${Math.round((winS[1] - winS[0]) * T)}s?`,
      };
    } else if (kind === 'reach') {
      const targetRank = Math.max(1, rank - 2);
      const aheadIdx = order[targetRank - 1];
      const deficit = script.gapSec(focusIdx, (winS[0] + winS[1]) / 2, adj) - script.gapSec(aheadIdx, (winS[0] + winS[1]) / 2, adj);
      const p = clamp(0.5 - deficit * 0.12 - (rank - targetRank) * 0.05, 0.06, 0.6);
      const yes = rand() < p;
      if (yes) {
        const sm = (winS[0] + winS[1]) / 2;
        const need = script.gapSec(focusIdx, sm, adj) - script.gapSec(order[targetRank - 1], sm, adj);
        impulses.push({ i: focusIdx, ...script.shape(winS[0], winS[1] + 0.1, -(need + 0.35) * 1.25) });
      }
      popup = {
        kind, p, targetRank,
        text: (f) => `${f.short} to reach P${targetRank} in the next ${Math.round((winS[1] - winS[0]) * T)}s?`,
      };
    } else {
      const p = clamp(0.62 - (n - rank) * 0.008, 0.35, 0.68);
      const yes = rand() < p;
      if (!yes && rank < n) {
        const chaser = order[rank]; // car directly behind mugs the focus racer
        const gapBehind = script.gapSec(chaser, s0, adj) - script.gapSec(focusIdx, s0, adj);
        impulses.push({ i: chaser, ...script.shape(winS[0], Math.min(0.92, winS[1] + 0.12), -(gapBehind + 0.35) * 1.2) });
      }
      popup = {
        kind, p, rankToHold: rank,
        text: (f) => `${f.short} to hold P${rank} for the next ${Math.round((winS[1] - winS[0]) * T)}s?`,
      };
    }

    popups.push({
      id: `${key}#${sI}`,
      ...popup,
      focusIdx,
      offerS: Math.max(0.05, s0 - 7 / T), // popup appears ~7s before the window
      s0: winS[0], s1: winS[1],
    });
  }

  // Settle each popup from the final choreography (ground truth = pixels).
  for (const pu of popups) {
    if (pu.kind === 'pit') continue;
    let happened = false;
    const steps = 60;
    if (pu.kind === 'hold') {
      happened = true;
      for (let k = 0; k <= steps; k++) {
        const s = lerp(pu.s0, pu.s1, k / steps);
        if (script.standings(s, adj).indexOf(pu.focusIdx) + 1 > pu.rankToHold) { happened = false; break; }
      }
    } else {
      for (let k = 0; k <= steps; k++) {
        const s = lerp(pu.s0, pu.s1 + (pu.kind === 'overtake' ? 0.1 : 0.06), k / steps);
        const rk = script.standings(s, adj).indexOf(pu.focusIdx) + 1;
        if (pu.kind === 'overtake' && script.standings(s, adj).indexOf(pu.targetIdx) > script.standings(s, adj).indexOf(pu.focusIdx)) { happened = true; break; }
        if (pu.kind === 'reach' && rk <= pu.targetRank) { happened = true; break; }
      }
    }
    pu.result = happened;
  }

  // The pit timings cached against this adjustment were resolved while its
  // impulses were still being added; drop them so they resolve on the final curve.
  script.pitReset(adj);
  const layer = { focusIdx, popups, adj };
  focusCache.set(key, layer);
  return layer;
}
