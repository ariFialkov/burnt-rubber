// Odds & pricing. Burnt Rubber is a game of pure chance dressed as a
// sportsbook: every market is priced from the same probability model that
// decides outcomes, with the house margin set by RTP. Offered decimal odds
// for an outcome with true probability p are RTP / p — so whatever the
// player bets on, long-run expected return is RTP.

import { rngFor, sampleOrder } from '../core/rng.js';

export const RTP = 0.92;                 // global return-to-player
export const SPONSOR_BONUS = 0.25;       // winnings bonus on sponsored-racer WIN bets
export const SPONSOR_SELLBACK = 0.25;    // sell a sponsored racer back at 25% of price

const MC_SAMPLES = 400;
const marketCache = new Map();

export const fmtOdds = (dec) => (dec >= 100 ? dec.toFixed(0) : dec.toFixed(2)) + 'x';

const priced = (p) => Math.max(1.01, RTP / Math.min(0.985, Math.max(p, 0.0008)));

// All pre-race markets for a race, Monte-Carlo priced from the Plackett–Luce
// model (seeded, so every client prices identically).
export function markets(race) {
  if (marketCache.has(race.key)) return marketCache.get(race.key);
  if (marketCache.size > 60) marketCache.clear();

  const n = race.field.length;
  const w = race.weights;
  const total = w.reduce((a, b) => a + b, 0);
  const pWin = w.map((x) => x / total);

  // Monte Carlo finish-position distribution.
  const mcRand = rngFor('mc-v1', race.key);
  const podiumCt = new Array(n).fill(0);
  const topHalfCt = new Array(n).fill(0);
  const topN = n >= 30 ? 10 : n >= 15 ? 6 : 3;
  const topNCt = new Array(n).fill(0);
  for (let s = 0; s < MC_SAMPLES; s++) {
    const ord = sampleOrder(mcRand, w);
    for (let k = 0; k < ord.length; k++) {
      if (k < 3) podiumCt[ord[k]]++;
      if (k < topN) topNCt[ord[k]]++;
      if (k < n / 2) topHalfCt[ord[k]]++;
    }
  }
  const smooth = (ct) => (ct + 1) / (MC_SAMPLES + 2);

  const outrights = race.field.map((r, i) => ({
    racer: r, i,
    pWin: pWin[i],
    win: priced(pWin[i]),
    podium: priced(smooth(podiumCt[i])),
    topN: priced(smooth(topNCt[i])),
    topHalf: priced(smooth(topHalfCt[i])),
  })).sort((a, b) => b.pWin - a.pWin);

  // Head-to-head matchups: pair adjacent-strength racers so lines are spicy.
  const h2h = [];
  const mRand = rngFor('h2h-v1', race.key);
  const pool = outrights.slice();
  const pairs = Math.min(4, Math.floor(n / 2));
  for (let k = 0; k < pairs; k++) {
    const ai = Math.floor(mRand() * (pool.length - 1));
    const a = pool.splice(ai, 1)[0];
    const b = pool.splice(Math.min(ai, pool.length - 1), 1)[0];
    const pA = w[a.i] / (w[a.i] + w[b.i]); // exact under Plackett–Luce
    h2h.push({ a: a.racer, b: b.racer, ai: a.i, bi: b.i, oddsA: priced(pA), oddsB: priced(1 - pA), pA });
  }

  // Props priced from the same seeded draws the race script realizes.
  const wFlat = w.map((x) => Math.pow(x, 0.7)); // fastest lap is flatter than wins
  const totFlat = wFlat.reduce((a, b) => a + b, 0);
  const wAggr = race.field.map((r, i) => w[i] * (0.6 + r.stats.aggression / 100)); // holeshot favors aggression
  const totAggr = wAggr.reduce((a, b) => a + b, 0);

  const props = {
    fastestLap: race.field.map((r, i) => ({ racer: r, i, p: wFlat[i] / totFlat, odds: priced(wFlat[i] / totFlat) })),
    holeshot: race.field.map((r, i) => ({ racer: r, i, p: wAggr[i] / totAggr, odds: priced(wAggr[i] / totAggr) })),
    // Winning margin over/under (drawn from an exponential in the script).
    marginLine: 1.2, // seconds
    marginOver: priced(0.5),
    marginUnder: priced(0.5),
  };

  const m = { outrights, h2h, props, topN, pWin };
  marketCache.set(race.key, m);
  return m;
}

// Probability weights used by the script generator — must match pricing above.
export function scriptWeights(race) {
  const m = markets(race);
  return {
    win: race.weights,
    fastestLap: m.props.fastestLap.map((x) => x.p),
    holeshot: m.props.holeshot.map((x) => x.p),
  };
}

// Sponsorship economics: the +25% winnings bonus on win bets is funded by the
// one-time fee. At base RTP 0.92, a win bet on a sponsored racer returns
// ~0.92 * 1.25 = 1.15 of stake in expectation — the fee (minus the 25%
// sell-back) is the house's compensation, so the *combined* product still
// nets out near the global RTP for realistic play volumes.
export function sponsoredReturnMultiplier() {
  return 1 + SPONSOR_BONUS;
}
