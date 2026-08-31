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

const scriptCache = new Map();

const drawFrom = (rand, probs) => {
  let r = rand();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
};

// Smooth bump: 0 at s0 and s1, peak 1 midway.
const bump = (s, s0, s1) => (s <= s0 || s >= s1 ? 0 : 0.5 * (1 - Math.cos((2 * Math.PI * (s - s0)) / (s1 - s0))));

// Drama window: no chaos on the grid, everything settled by the flag.
function dramaWindow(s) {
  const up = clamp(s / 0.12, 0, 1);
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
  const lap1S = (1 / race.tour.laps) * 0.9;

  // Base gap curve (seconds behind the virtual pace car) before enforcement.
  function rawGap(i, s) {
    const ease = s * s * (3 - 2 * s);
    let g = lerp(gridGap[i], finalGap[i], ease);
    const w = dramaWindow(s);
    for (const h of harmonics[i]) g += w * h.a * Math.sin(2 * Math.PI * h.f * s + h.ph);
    return g;
  }

  // Make the drawn holeshot racer actually lead at the lap-1 mark.
  {
    let minOther = Infinity;
    for (let i = 0; i < n; i++) if (i !== holeshotIdx) minOther = Math.min(minOther, rawGap(i, lap1S));
    const need = rawGap(holeshotIdx, lap1S) - minOther + 0.25;
    if (need > 0) enforce.push({ i: holeshotIdx, s0: Math.max(0.02, lap1S - 0.16), s1: Math.min(0.9, lap1S + 0.2), amp: -need });
  }

  function gapSec(i, s, adj) {
    let g = rawGap(i, s);
    for (const e of enforce) if (e.i === i) g += e.amp * bump(s, e.s0, e.s1);
    if (adj) g += adj(i, s);
    return g;
  }

  const T = LEADER_FINISH_S;
  const lapLen = { formula: 1050, stock: 900, rally: 1150, baja: 1400, moto: 1000 }[race.tour.vehicle] || 1000;
  const totalDist = lapLen * race.tour.laps;
  const paceMps = totalDist / T;

  const script = {
    race, T, lapLen, totalDist, paceMps,
    grid, finishOrder, finalGap, margin,
    holeshotIdx, fastestLapIdx, fastestLapS,
    gapSec,
    // Distance along the track in meters at race-time t (seconds). After the
    // flag (s=1) gaps freeze and everyone cruises home at pace.
    distance(i, t, adj) {
      const s = clamp(t / T, 0, 1);
      return paceMps * (t - gapSec(i, s, adj));
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
    for (const im of impulses) if (im.i === i) g += im.amp * bump(s, im.s0, im.s1);
    return g;
  };

  const wSelf = race.weights[focusIdx];
  const popups = [];
  const slots = [0.16 + rand() * 0.08, 0.42 + rand() * 0.1, 0.64 + rand() * 0.08];

  for (let sI = 0; sI < slots.length; sI++) {
    const s0 = slots[sI];
    const order = script.standings(s0, adj);
    const rank = order.indexOf(focusIdx) + 1;
    const kinds = [];
    if (rank > 1) kinds.push('overtake');
    if (rank > 3) kinds.push('reach');
    if (rank < n) kinds.push('hold');
    const kind = kinds[Math.floor(rand() * kinds.length)] || 'hold';
    const winS = [s0, Math.min(0.9, s0 + (kind === 'overtake' ? 0.1 : 0.22))];

    let popup = null;
    if (kind === 'overtake') {
      const targetIdx = order[rank - 2]; // car directly ahead
      const gapNow = script.gapSec(focusIdx, s0, adj) - script.gapSec(targetIdx, s0, adj);
      const pw = wSelf / (wSelf + race.weights[targetIdx]);
      const p = clamp(0.62 * pw + 0.28 - gapNow * 0.16, 0.07, 0.72);
      const yes = rand() < p;
      if (yes) impulses.push({ i: focusIdx, s0: winS[0], s1: winS[1] + 0.14, amp: -(gapNow + 0.3) * 1.2 });
      else impulses.push({ i: focusIdx, s0: winS[0], s1: winS[1], amp: Math.max(0.1, 0.5 - gapNow) });
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
        impulses.push({ i: focusIdx, s0: winS[0], s1: winS[1] + 0.1, amp: -(need + 0.35) * 1.25 });
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
        impulses.push({ i: chaser, s0: winS[0], s1: Math.min(0.92, winS[1] + 0.12), amp: -(gapBehind + 0.35) * 1.2 });
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
