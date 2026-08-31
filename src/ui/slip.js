// Floating bet slip. Legs from different races combine into a parlay
// (odds multiply); legs sharing a race are placed as separate singles.

import { fmtOdds } from '../engine/odds.js';
import { placeBet, store } from '../engine/bets.js';
import { tourState } from '../engine/schedule.js';

const $ = (id) => document.getElementById(id);
export const slip = { legs: [] };

let ctxRef = null;

export function initSlip(ctx) {
  ctxRef = ctx;
  $('slip-head').addEventListener('click', () => $('slip').classList.toggle('collapsed'));
  $('quick-stakes').innerHTML = [50, 100, 250, 1000]
    .map((v) => `<button data-st="${v}">${v}</button>`).join('');
  $('quick-stakes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (b) { $('stake-input').value = b.dataset.st; renderSlip(); }
  });
  $('stake-input').addEventListener('input', renderSlip);
  $('slip-legs').addEventListener('click', (e) => {
    const x = e.target.closest('[data-rm]');
    if (x) removeLeg(x.dataset.rm);
  });
  $('place-btn').addEventListener('click', place);
}

export function legKey(l) {
  return [l.tourId, l.cycle, l.market, l.racerId || '', l.vsRacerId || '', l.line || ''].join('#');
}

export function hasLeg(l) {
  return slip.legs.some((x) => legKey(x) === legKey(l));
}

export function toggleLeg(l) {
  const k = legKey(l);
  const i = slip.legs.findIndex((x) => legKey(x) === k);
  if (i >= 0) slip.legs.splice(i, 1);
  else {
    if (slip.legs.length >= 8) { ctxRef.toast('Max 8 legs on a slip', 'lose'); return; }
    slip.legs.push(l);
    $('slip').classList.remove('collapsed');
  }
  renderSlip();
}

function removeLeg(k) {
  slip.legs = slip.legs.filter((x) => legKey(x) !== k);
  renderSlip();
  ctxRef.refreshBoard?.();
}

function grouping() {
  const races = new Set(slip.legs.map((l) => `${l.tourId}#${l.cycle}`));
  const isParlay = slip.legs.length > 1 && races.size === slip.legs.length;
  return { isParlay, singles: !isParlay && slip.legs.length > 1 };
}

export function renderSlip() {
  const el = $('slip');
  if (!slip.legs.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('slip-count').textContent = slip.legs.length;
  const { isParlay } = grouping();
  const totOdds = slip.legs.reduce((a, l) => a * l.odds, 1);
  $('slip-odds-mini').textContent = isParlay ? fmtOdds(totOdds) : slip.legs.length === 1 ? fmtOdds(totOdds) : '';
  $('slip-legs').innerHTML = slip.legs.map((l) => `
    <div class="slip-leg">
      <div><b>${l.label}</b><span class="sub">${l.sub}</span></div>
      <span class="lo">${fmtOdds(l.odds)}</span>
      <button class="lx" data-rm="${legKey(l)}">✕</button>
    </div>`).join('');

  const stake = Number($('stake-input').value) || 0;
  const btn = $('place-btn');
  if (isParlay) {
    btn.textContent = stake > 0
      ? `PLACE PARLAY @ ${fmtOdds(totOdds)} → ${Math.round(stake * totOdds).toLocaleString()} ◈`
      : `PLACE PARLAY @ ${fmtOdds(totOdds)}`;
  } else if (slip.legs.length > 1) {
    btn.textContent = `PLACE ${slip.legs.length} SINGLES (${stake || '—'} ◈ each)`;
  } else {
    btn.textContent = stake > 0
      ? `PLACE BET → ${Math.round(stake * totOdds).toLocaleString()} ◈`
      : 'PLACE BET';
  }
  const cost = slip.legs.length > 1 && !isParlay ? stake * slip.legs.length : stake;
  btn.disabled = !(stake > 0) || cost > store.wallet;
}

function place() {
  const stake = Number($('stake-input').value) || 0;
  if (!(stake > 0)) return;
  // Drop legs whose race left the betting window while the slip sat open.
  const valid = slip.legs.filter((l) => {
    const st = tourState(l.tourId);
    return st.phase === 'betting' && st.cycle === l.cycle;
  });
  if (valid.length < slip.legs.length) ctxRef.toast('Some legs expired — betting closed', 'lose');
  slip.legs = valid;
  if (!valid.length) { renderSlip(); ctxRef.refreshBoard?.(); return; }

  const { isParlay } = grouping();
  let ok = false;
  if (isParlay || valid.length === 1) {
    ok = !!placeBet(valid, stake);
  } else {
    ok = valid.every((l) => placeBet([l], stake));
  }
  if (ok) {
    ctxRef.toast(isParlay && valid.length > 1 ? 'Parlay placed! 🎟️' : 'Bet placed! 🎟️', 'win');
    slip.legs = [];
    renderSlip();
    ctxRef.refreshBoard?.();
    ctxRef.updateWallet();
  } else {
    ctxRef.toast('Not enough credits', 'lose');
  }
}
