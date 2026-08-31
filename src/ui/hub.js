// Hub screen: chyron over the rotating "news chopper" backdrop + the pull-up
// tour panel with live status and quick odds for all five tours.

import { markets, fmtOdds } from '../engine/odds.js';

const $ = (id) => document.getElementById(id);

export function initHub(ctx) {
  $('sheet-handle').addEventListener('click', () => $('tour-sheet').classList.toggle('open'));
  $('btn-garage').addEventListener('click', () => ctx.showView('garage'));
  $('btn-mybets').addEventListener('click', () => ctx.showView('mybets'));
  $('wallet-chip').addEventListener('click', () => ctx.showView('mybets'));

  $('tour-cards').addEventListener('click', (e) => {
    const card = e.target.closest('[data-tour]');
    if (!card) return;
    const tourId = card.dataset.tour;
    ctx.openTour(tourId);
  });
}

let lastCardsHtml = '';

export function updateHub(ctx, states) {
  // Chyron for the tour currently on the backdrop.
  const st = states[ctx.hubIdx % states.length];
  const title = `${st.tour.name} — ${st.race.track.name.toUpperCase()} · ${st.race.track.loc}`;
  if ($('chyron-title').textContent !== title) {
    $('chyron-title').textContent = title;
    const ch = $('chyron');
    ch.classList.remove('re');
    void ch.offsetWidth; // restart slide-in animation
  }
  $('chyron-sub').textContent =
    st.phase === 'betting' ? `Grid is set — betting closes in ${Math.ceil(st.countdown)}s · Purse ${st.race.purse}K`
    : st.phase === 'racing' ? `LAP ${ctx.lapOf(st)} — ${st.race.field.length} racers · Purse ${st.race.purse}K`
    : `Checkered flag! Next race soon · Purse ${st.race.purse}K`;

  // Tour cards (rebuild only when content changes meaningfully).
  const html = states.map((s) => {
    const m = markets(s.race);
    const top3 = m.outrights.slice(0, 3)
      .map((o) => `<span class="tc-odd">${o.racer.code} <b>${fmtOdds(o.win)}</b></span>`).join('');
    const status =
      s.phase === 'betting' ? `Betting open · closes <b>${Math.ceil(s.countdown)}s</b>`
      : s.phase === 'racing' ? `<b>● LIVE</b> — lap ${ctx.lapOf(s)}`
      : `Finished · next in <b>${Math.ceil(s.countdown)}s</b>`;
    const btn = s.phase === 'betting' ? 'BET BOARD' : s.phase === 'racing' ? 'WATCH LIVE' : 'RESULTS';
    return `
      <div class="tour-card" data-tour="${s.tour.id}" style="--tc:${s.tour.accent}">
        <div class="tc-name" style="color:${s.tour.accent}">${s.tour.name}</div>
        <div class="tc-race">${s.race.track.name} · ${s.race.track.loc}</div>
        <div class="tc-status">${status} · ${s.race.field.length} racers · Purse ${s.race.purse}K</div>
        <div class="tc-odds">${top3}</div>
        <div class="tc-btn">${btn}</div>
      </div>`;
  }).join('');
  if (html !== lastCardsHtml) {
    lastCardsHtml = html;
    $('tour-cards').innerHTML = html;
  }
}
