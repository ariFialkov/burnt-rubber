// My Bets: open tickets and settlement history.

import { store } from '../engine/bets.js';
import { fmtOdds } from '../engine/odds.js';

const $ = (id) => document.getElementById(id);

export function renderMyBets() {
  const open = store.bets.filter((b) => b.status === 'open');
  const settled = store.bets.filter((b) => b.status !== 'open');
  const staked = open.reduce((a, b) => a + b.stake, 0);
  $('mybets-sub').textContent = `${open.length} open (${staked.toLocaleString()} ◈ at risk) · ${settled.length} settled`;

  const row = (b) => `
    <div class="race-row">
      <div class="rr-info">
        <div class="rr-name">${b.kind === 'parlay' ? `🎰 ${b.legs.length}-leg parlay` : b.legs[0].market === 'popup' ? '⚡ Live bet' : '🎟️ Single'}</div>
        <div class="rr-meta">${b.legs.map((l) => `${l.label} <i>(${l.sub})</i>`).join(' + ')}</div>
        <div class="rr-meta">${b.stake.toLocaleString()} ◈ @ ${fmtOdds(b.odds)}</div>
      </div>
      <div class="odds-btn" style="pointer-events:none">
        ${b.status === 'open' ? '<small>OPEN</small>…'
          : b.status === 'won' ? `<small style="color:var(--green)">WON</small>+${b.payout.toLocaleString()}`
          : `<small style="color:var(--red)">LOST</small>−${b.stake.toLocaleString()}`}
      </div>
    </div>`;

  $('mybets-rows').innerHTML =
    (open.length ? open.map(row).join('') : '<div class="rr-meta" style="padding:16px 0">No open bets — hit a bet board!</div>') +
    (settled.length ? `<div class="rr-meta" style="padding:12px 0 4px;font-weight:800;letter-spacing:.08em">SETTLED</div>` + settled.slice(0, 30).map(row).join('') : '');
}
