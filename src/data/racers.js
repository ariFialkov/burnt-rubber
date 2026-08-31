// Procedural racer banks: each tour carries 4x its field size in fictional
// racers, generated deterministically (same bank for every player, forever).

import { rngFor, pick } from '../core/rng.js';
import { NATIONS, TEAM_WORDS_A, TEAM_WORDS_B, TEAM_COLORS } from './names.js';
import { TOURS } from './tours.js';

function buildBank(tour) {
  const rand = rngFor('racer-bank-v1', tour.id);
  const count = tour.fieldSize * 4;
  const racers = [];
  const usedNames = new Set();
  const usedNumbers = new Set();

  // Teams: pairs of racers share a team/livery, like real outfits.
  const teams = [];
  const teamCount = Math.ceil(count / 2);
  const usedTeamNames = new Set();
  for (let i = 0; i < teamCount; i++) {
    let name;
    do {
      name = `${pick(rand, TEAM_WORDS_A)} ${pick(rand, TEAM_WORDS_B)}`;
    } while (usedTeamNames.has(name));
    usedTeamNames.add(name);
    teams.push({ name, colors: TEAM_COLORS[i % TEAM_COLORS.length] });
  }

  for (let i = 0; i < count; i++) {
    const nation = pick(rand, NATIONS);
    let first, last;
    do {
      first = pick(rand, nation.first);
      last = pick(rand, nation.last);
    } while (usedNames.has(first + last));
    usedNames.add(first + last);

    let number;
    const numRange = Math.max(99, count * 2);
    do {
      number = 1 + Math.floor(rand() * numRange);
    } while (usedNumbers.has(number));
    usedNumbers.add(number);

    const team = teams[Math.floor(i / 2)];
    // Stats are flavor for the odds market only — they feed the pricing model,
    // never a skill mechanic. 40..99 scale.
    const stat = () => 40 + Math.floor(rand() * 60);
    const pace = stat(), consistency = stat(), aggression = stat(), craft = stat();

    racers.push({
      id: `${tour.id}-${i}`,
      tourId: tour.id,
      idx: i,
      first,
      last,
      name: `${first} ${last}`,
      short: `${first[0]}. ${last}`,
      code: (last.replace(/[^A-Za-z]/g, '') + 'XXX').slice(0, 3).toUpperCase(),
      nation: nation.code,
      flag: nation.flag,
      age: 19 + Math.floor(rand() * 22),
      number,
      team: team.name,
      colors: team.colors,
      stats: { pace, consistency, aggression, craft },
      // Overall strength drives the odds model. Exponential-ish spread makes a
      // real odds landscape: clear favorites, mid-pack, and longshots.
      strength: Math.exp((pace * 0.5 + consistency * 0.25 + craft * 0.15 + aggression * 0.1) / 14),
      portraitSeed: Math.floor(rand() * 1e9),
      price: 0, // sponsorship price, filled below once strength is known
    });
  }

  // Sponsorship price scales with how good the racer's odds tend to be.
  const maxS = Math.max(...racers.map((r) => r.strength));
  for (const r of racers) {
    r.price = Math.round((400 + 4600 * (r.strength / maxS) ** 1.5) / 25) * 25;
  }
  return racers;
}

export const RACER_BANKS = Object.fromEntries(TOURS.map((t) => [t.id, buildBank(t)]));

export function racerById(id) {
  const tourId = id.slice(0, id.lastIndexOf('-'));
  const idx = Number(id.slice(id.lastIndexOf('-') + 1));
  return RACER_BANKS[tourId]?.[idx] || null;
}
