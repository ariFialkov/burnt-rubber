// Global race scheduler. Purely a function of wall-clock time, so every
// client sees the same "live" races: each tour runs endless cycles of
// betting -> race -> post, staggered so something is always about to start.

import { rngFor, shuffled, pick } from '../core/rng.js';
import { TOURS, TOUR_BY_ID } from '../data/tours.js';
import { RACER_BANKS } from '../data/racers.js';

export const EPOCH0 = Date.UTC(2026, 0, 1); // world time zero
export const BET_S = 72;   // betting window
export const RACE_S = 102; // the longest race (~85s over four laps with a pit stop each) plus the tail of a 40-truck field
export const POST_S = 15;  // results / cooldown
export const CYCLE_S = BET_S + RACE_S + POST_S; // 189s
const STAGGER_S = 35;      // tour offsets: a race goes green every ~35s somewhere

const PURSES = [120, 180, 250, 400, 600, 750, 1000]; // display "purse" in K

const raceCache = new Map();

export function raceFor(tourId, cycle) {
  const key = `${tourId}#${cycle}`;
  if (raceCache.has(key)) return raceCache.get(key);
  if (raceCache.size > 300) raceCache.clear();

  const tour = TOUR_BY_ID[tourId];
  const rand = rngFor('race-v1', tourId, String(cycle));
  const bank = RACER_BANKS[tourId];

  // Rotate through the track bank in seeded "seasons" so the same map never
  // repeats back-to-back and the mix feels curated.
  const season = Math.floor(cycle / tour.tracks.length);
  const seasonOrder = shuffled(rngFor('season-v1', tourId, String(season)), tour.tracks);
  const track = seasonOrder[((cycle % tour.tracks.length) + tour.tracks.length) % tour.tracks.length];

  // Field: fieldSize racers drawn from the 4x bank, whole teams at a time
  // (an outfit enters both its cars), the pairs then shuffled into the
  // line-up. An odd field size gets one lone entry.
  const byTeam = new Map();
  for (const r of bank) { if (!byTeam.has(r.team)) byTeam.set(r.team, []); byTeam.get(r.team).push(r); }
  const teamsIn = shuffled(rand, [...byTeam.values()]);
  const picked = [];
  for (const members of teamsIn) { if (picked.length >= tour.fieldSize) break; for (const r of members) if (picked.length < tour.fieldSize) picked.push(r); }
  const field = shuffled(rand, picked);

  // Per-race form: strength jittered so the same racer isn't priced
  // identically every time out.
  const weights = field.map((r) => r.strength * (0.75 + rand() * 0.5));

  // Weather: a share of races run wet (rain lights on, a darker day); the
  // desert tour rarely sees it.
  const wet = rngFor('weather-v1', tourId, String(cycle))() < (tour.vehicle === 'baja' ? 0.08 : 0.24);

  const race = {
    key,
    tourId,
    tour,
    cycle,
    track,
    field,
    weights,
    wet,
    purse: pick(rand, PURSES),
    trackSeed: `${tourId}-${track.name}`,
    label: `${track.name} · ${track.loc}`,
  };
  raceCache.set(key, race);
  return race;
}

const tourOffset = (tourId) => TOURS.findIndex((t) => t.id === tourId) * STAGGER_S;

// Phase of a tour at time `now` (ms). tRace = seconds into the race.
export function tourState(tourId, now = Date.now()) {
  const t = (now - EPOCH0) / 1000 + tourOffset(tourId);
  const cycle = Math.floor(t / CYCLE_S);
  const inCycle = t - cycle * CYCLE_S;
  const race = raceFor(tourId, cycle);
  if (inCycle < BET_S) {
    return { phase: 'betting', race, countdown: BET_S - inCycle, tRace: 0, cycle };
  }
  if (inCycle < BET_S + RACE_S) {
    return { phase: 'racing', race, countdown: 0, tRace: inCycle - BET_S, cycle };
  }
  return {
    phase: 'post', race, cycle,
    countdown: CYCLE_S - inCycle, // until next betting window opens
    tRace: RACE_S,
    next: raceFor(tourId, cycle + 1),
  };
}

// Absolute ms timestamps for a given race's window (for settling old bets).
export function raceTimes(tourId, cycle) {
  const startS = cycle * CYCLE_S - tourOffset(tourId);
  return {
    betOpen: EPOCH0 + startS * 1000,
    green: EPOCH0 + (startS + BET_S) * 1000,
    finish: EPOCH0 + (startS + BET_S + RACE_S) * 1000,
  };
}

export function allTourStates(now = Date.now()) {
  return TOURS.map((t) => ({ tour: t, ...tourState(t.id, now) }));
}
