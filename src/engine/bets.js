// Wallet, bet slip, sponsorships, and settlement. All play-money credits.
// Settlement is deterministic: any past race can be regenerated from its key,
// so bets settle correctly even if the app was closed during the race.

import { rngFor } from '../core/rng.js';
import { raceFor, raceTimes } from './schedule.js';
import { getScript, getFocusLayer } from './script.js';
import { SPONSOR_BONUS, SPONSOR_SELLBACK } from './odds.js';
import { racerById } from '../data/racers.js';

const SAVE_KEY = 'burnt-rubber-save-v2';
const START_BAL = 10000;

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fresh start */ }
  return { wallet: START_BAL, bets: [], sponsorships: {}, topUps: 0, nextBetId: 1 };
}

export const store = load();
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
  listeners.forEach((fn) => fn());
}

export function topUpIfBroke() {
  const openStake = store.bets.filter((b) => b.status === 'open').reduce((a, b) => a + b.stake, 0);
  if (store.wallet < 100 && openStake === 0) {
    store.wallet += START_BAL;
    store.topUps++;
    save();
    return true;
  }
  return false;
}

// --- Sponsorships ----------------------------------------------------------

export function isSponsored(racerId) { return !!store.sponsorships[racerId]; }

export function buyRacer(racer) {
  if (isSponsored(racer.id) || store.wallet < racer.price) return false;
  store.wallet -= racer.price;
  store.sponsorships[racer.id] = { paid: racer.price, at: Date.now() };
  save();
  return true;
}

export function sellRacer(racerId) {
  const s = store.sponsorships[racerId];
  if (!s) return false;
  store.wallet += Math.round(s.paid * SPONSOR_SELLBACK);
  delete store.sponsorships[racerId];
  save();
  return true;
}

// --- Placing bets ----------------------------------------------------------
// leg: { tourId, cycle, market, racerId?, bIdx?, line?, popupId?, focusIdx?, odds, label, raceLabel }

export function placeBet(legs, stake, kind = legs.length > 1 ? 'parlay' : 'single') {
  stake = Math.round(stake);
  if (!(stake > 0) || stake > store.wallet || !legs.length) return null;
  store.wallet -= stake;
  const bet = {
    id: store.nextBetId++,
    kind,
    legs,
    stake,
    odds: legs.reduce((a, l) => a * l.odds, 1),
    status: 'open',
    placedAt: Date.now(),
  };
  store.bets.unshift(bet);
  if (store.bets.length > 120) store.bets.length = 120;
  save();
  return bet;
}

function legRace(leg) { return raceFor(leg.tourId, leg.cycle); }

function legFinished(leg, now) {
  return now >= raceTimes(leg.tourId, leg.cycle).finish;
}

function legResult(leg) {
  const race = legRace(leg);
  const script = getScript(race);
  const fieldIdx = leg.racerId != null ? race.field.findIndex((r) => r.id === leg.racerId) : -1;
  const pos = fieldIdx >= 0 ? script.finishOrder.indexOf(fieldIdx) : -1;
  switch (leg.market) {
    case 'win': return pos === 0;
    case 'podium': return pos >= 0 && pos < 3;
    case 'topN': return pos >= 0 && pos < leg.n;
    case 'topHalf': return pos >= 0 && pos < race.field.length / 2;
    case 'h2h': {
      const bIdx = race.field.findIndex((r) => r.id === leg.vsRacerId);
      return pos >= 0 && pos < script.finishOrder.indexOf(bIdx);
    }
    case 'holeshot': return script.holeshotIdx === fieldIdx;
    case 'fastestLap': return script.fastestLapIdx === fieldIdx;
    case 'marginOver': return script.margin > leg.line;
    case 'marginUnder': return script.margin <= leg.line;
    case 'popup': {
      const layer = getFocusLayer(race, leg.focusIdx);
      const pu = layer.popups.find((p) => p.id === leg.popupId);
      return !!pu?.result;
    }
    default: return false;
  }
}

// Bonus: +25% winnings on winning WIN-market legs for sponsored racers.
function betPayout(bet) {
  let mult = 1;
  let bonus = 1;
  for (const leg of bet.legs) {
    mult *= leg.odds;
    if (leg.market === 'win' && leg.racerId && isSponsored(leg.racerId)) bonus += SPONSOR_BONUS;
  }
  const base = bet.stake * mult;
  const winnings = base - bet.stake;
  return Math.round(base + winnings * (bonus - 1));
}

export function settleDue(now = Date.now()) {
  const settled = [];
  for (const bet of store.bets) {
    if (bet.status !== 'open') continue;
    if (!bet.legs.every((l) => legFinished(l, now))) continue;
    const won = bet.legs.every((l) => legResult(l));
    bet.status = won ? 'won' : 'lost';
    bet.settledAt = now;
    bet.payout = won ? betPayout(bet) : 0;
    if (won) store.wallet += bet.payout;
    settled.push(bet);
  }
  if (settled.length) save();
  return settled;
}

// The racer the player is "watching" in a race: their biggest-stake leg's
// racer, else a seeded mid-pack pick so neutral spectating still gets popups.
export function focusRacerIdx(race) {
  let best = null;
  for (const bet of store.bets) {
    if (bet.status !== 'open') continue;
    for (const leg of bet.legs) {
      if (leg.tourId === race.tourId && leg.cycle === race.cycle && leg.racerId) {
        const idx = race.field.findIndex((r) => r.id === leg.racerId);
        if (idx >= 0 && (!best || bet.stake > best.stake)) best = { idx, stake: bet.stake };
      }
    }
  }
  if (best) return best.idx;
  const rand = rngFor('default-focus', race.key);
  return Math.floor(race.field.length * (0.3 + rand() * 0.4));
}

export function openBetsFor(race) {
  return store.bets.filter((b) => b.status === 'open' && b.legs.some((l) => l.tourId === race.tourId && l.cycle === race.cycle));
}

export function sponsoredRacers() {
  return Object.keys(store.sponsorships).map((id) => racerById(id)).filter(Boolean);
}
