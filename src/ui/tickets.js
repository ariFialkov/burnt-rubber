// Hub bet tracker: every outstanding ticket with live progress, plus the
// most recent results — so switching between five tours never means losing
// sight of what you have riding.

import { clamp } from '../core/rng.js';
import { tourState, raceFor } from '../engine/schedule.js';
import { getScript, getFocusLayer } from '../engine/script.js';
import { fmtOdds } from '../engine/odds.js';
import { store, focusRacerIdx } from '../engine/bets.js';
import { TOUR_BY_ID } from '../data/tours.js';

const $ = (id) => document.getElementById(id);
let collapsed = false;
let lastHtml = '';
let ctxRef = null;

export function initTickets(ctx) {
  ctxRef = ctx;
  $('hub-tickets').addEventListener('click', (e) => {
    if (e.target.closest('.ht-head')) {
      collapsed = !collapsed;
      $('hub-tickets').classList.toggle('collapsed', collapsed);
      return;
    }
    const tk = e.target.closest('[data-jump]');
    if (!tk) return;
    if (tk.dataset.jump === 'mybets') ctx.showView('mybets');
    else ctx.openTour(tk.dataset.jump);
  });
}

// Live status chip for one leg of an open ticket.
function legChip(leg, now) {
  const tour = TOUR_BY_ID[leg.tourId];
  const tag = `<i style="color:${tour.accent}">${tour.tag}</i>`;
  const st = tourState(leg.tourId, now);
  const race = raceFor(leg.tourId, leg.cycle);
  const script = getScript(race);

  // Race over (settlement catches up within a couple of seconds).
  if (st.cycle > leg.cycle || (st.cycle === leg.cycle && st.phase === 'post')) {
    return `<span class="tk-chip">${tag} 🏁 finishing…</span>`;
  }
  // Still on the grid.
  if (st.phase === 'betting') {
    return `<span class="tk-chip">${tag} grid · ${Math.ceil(st.countdown)}s</span>`;
  }

  // Live: show where the pick is running, colored by whether it's landing.
  const s = clamp(st.tRace / script.T, 0, 1);
  const adj = getFocusLayer(race, focusRacerIdx(race)).adj;
  const lap = clamp(Math.floor(script.distance(script.finishOrder[0], Math.min(st.tRace, script.T)) / script.lapLen) + 1, 1, race.tour.laps);

  if (leg.market === 'popup') {
    return `<span class="tk-chip live">${tag} ⚡ in play</span>`;
  }
  const idx = leg.racerId ? race.field.findIndex((r) => r.id === leg.racerId) : -1;
  if (idx < 0) {
    return `<span class="tk-chip live">${tag} ● live · lap ${lap}</span>`;
  }
  const order = script.standings(s, adj);
  const p = order.indexOf(idx) + 1;
  let good = null;
  switch (leg.market) {
    case 'win': good = p === 1; break;
    case 'podium': good = p <= 3; break;
    case 'topN': good = p <= (leg.n || 3); break;
    case 'topHalf': good = p <= race.field.length / 2; break;
    case 'h2h': {
      const vs = race.field.findIndex((r) => r.id === leg.vsRacerId);
      good = vs >= 0 ? order.indexOf(idx) < order.indexOf(vs) : null;
      break;
    }
    default: break; // holeshot / fastest lap / margin: position isn't the story
  }
  const cls = good === null ? 'live' : good ? 'ok' : 'bad';
  return `<span class="tk-chip ${cls}">${tag} ● P${p} · lap ${lap}/${race.tour.laps}</span>`;
}

function jumpTarget(bet, now) {
  // Send the tap to the most urgent leg: a live race first, else the next grid.
  let grid = null;
  for (const leg of bet.legs) {
    const st = tourState(leg.tourId, now);
    if (st.cycle === leg.cycle && st.phase === 'racing') return leg.tourId;
    if (st.cycle === leg.cycle && st.phase === 'betting') grid = grid || leg.tourId;
  }
  return grid || bet.legs[0].tourId;
}

export function renderTickets(now = Date.now()) {
  const el = $('hub-tickets');
  const open = store.bets.filter((b) => b.status === 'open');
  const recent = store.bets
    .filter((b) => b.status !== 'open' && now - (b.settledAt || 0) < 30 * 60 * 1000)
    .slice(0, 3);

  if (!open.length && !recent.length) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.classList.toggle('collapsed', collapsed);

  const rows = [];
  rows.push(`<button class="ht-head">🎟 BET TRACKER<span class="ht-count">${open.length}</span><span class="ht-caret">${collapsed ? '▸' : '▾'}</span></button>`);

  for (const b of open.slice(0, 6)) {
    const title = b.kind === 'parlay'
      ? `🎰 ${b.legs.length}-leg parlay`
      : b.legs[0].market === 'popup' ? `⚡ ${b.legs[0].label}` : b.legs[0].label;
    rows.push(`
      <div class="tk" data-jump="${jumpTarget(b, now)}">
        <div class="tk-top"><b>${title}</b></div>
        <div class="tk-mid">${b.stake.toLocaleString()}◈ @ ${fmtOdds(b.odds)} → ${Math.round(b.stake * b.odds).toLocaleString()}◈</div>
        <div class="tk-legs">${b.legs.map((l) => legChip(l, now)).join('')}</div>
      </div>`);
  }
  if (open.length > 6) {
    rows.push(`<div class="tk more" data-jump="mybets">+${open.length - 6} more open — view all</div>`);
  }

  for (const b of recent) {
    const won = b.status === 'won';
    const title = b.kind === 'parlay' ? `🎰 ${b.legs.length}-leg parlay` : b.legs[0].label;
    rows.push(`
      <div class="tk settled" data-jump="mybets">
        <div class="tk-top"><b>${title}</b>
          <span class="tk-res ${b.status}">${won ? `WON +${b.payout.toLocaleString()}` : `LOST −${b.stake.toLocaleString()}`}</span>
        </div>
      </div>`);
  }

  const html = rows.join('');
  if (html !== lastHtml) { // avoid trashing the DOM (and taps) every tick
    lastHtml = html;
    el.innerHTML = html;
  }
}
