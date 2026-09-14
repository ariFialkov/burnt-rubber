// Race script generation. A race is fully determined the moment betting
// opens: finish order and scripted facts are drawn from the same seeded
// probability model the odds were priced from (that's the whole RTP story).
// What stays "alive" is the choreography — smooth gap curves with drama
// harmonics create overtakes and swings all race while converging to the
// scripted result. A per-focus-racer "director" layer bakes popup-bet
// events (drawn at their priced probability) into the choreography.

import { rngFor, sampleOrder, clamp, lerp } from '../core/rng.js';
import { scriptWeights } from './odds.js';
import { RACE_S } from './schedule.js';

export const LEADER_FINISH_S = 40; // leader completes the distance at t=40s

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

  const T = LEADER_FINISH_S;
  const pace = PACE[race.tour.vehicle] || PACE.formula;
  const { accel, cruise } = pace;
  // Pace-car profile: v = cruise·tanh(accel·t/cruise) starts at `accel` and
  // eases into `cruise` with no knee; its integral is the distance.
  const paceSpeed = (t) => cruise * Math.tanh((accel * t) / cruise);
  const paceDist = (t) => ((cruise * cruise) / accel) * Math.log(Math.cosh((accel * t) / cruise));
  const totalDist = paceDist(T);
  const lapLen = totalDist / race.tour.laps;
  const paceMps = cruise;

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
  // the first lap the longest).
  const lap1S = (() => {
    let lo = 0, hi = T;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (paceDist(mid) - GRID_OFFSET < lapLen * 0.9) lo = mid; else hi = mid; }
    return lo / T;
  })();

  // Base gap curve (seconds behind the virtual pace car) before enforcement.
  function rawGap(i, s) {
    const ease = s * s * (3 - 2 * s);
    let g = lerp(gridGap[i], finalGap[i], ease);
    const w = dramaWindow(s, paceSpeed(s * T) / cruise);
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
      sh.sp = lap1S;
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

  const script = {
    race, T, lapLen, totalDist, paceMps, pace, pitch,
    paceSpeed, paceDist, gapScale,
    shape, upToSpeed, maxAmp,
    grid, gridSlotOf, finishOrder, finalGap, margin,
    holeshotIdx, fastestLapIdx, fastestLapS,
    gapSec,
    // Distance along the track in metres at race-time t (seconds), with the
    // start line at 0. At t=0 every car sits in its grid slot; after the flag
    // (s=1) gaps freeze and everyone cruises home at pace.
    distance(i, t, adj) {
      const s = clamp(t / T, 0, 1);
      const tt = Math.max(0, t);
      return paceDist(tt) - gapSec(i, s, adj) * gapScale(tt) - GRID_OFFSET;
    },
    // Ranked indices at normalized time s (lowest gap = P1).
    standings(s, adj) {
      const idx = race.field.map((_, i) => i);
      const g = idx.map((i) => gapSec(i, clamp(s, 0, 1), adj));
      return idx.sort((a, b) => g[a] - g[b]);
    },
    rankOf(i, s, adj) {
      return this.standings(s, adj).indexOf(i) + 1;
    },
    finished(t) { return t >= T + (this.maxGap ?? 10) + 1; },
  };
  script.maxGap = Math.max(...finalGap);
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

  const layer = { focusIdx, popups, adj };
  focusCache.set(key, layer);
  return layer;
}
