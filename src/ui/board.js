// Pre-race betting board for one tour's current race.

import { markets, fmtOdds } from '../engine/odds.js';
import { tourState } from '../engine/schedule.js';
import { isSponsored } from '../engine/bets.js';
import { portraitDataURI } from './avatars.js';
import { toggleLeg, hasLeg, renderSlip } from './slip.js';

const $ = (id) => document.getElementById(id);
const TABS = [
  { id: 'winner', label: '🏆 Winner' },
  { id: 'podium', label: '🥉 Podium' },
  { id: 'topn', label: 'Top Finish' },
  { id: 'specials', label: '✨ Specials' },
];

let tab = 'winner';
let renderedKey = '';
let ctxRef = null;

export function initBoard(ctx) {
  ctxRef = ctx;
  $('board-tabs').innerHTML = TABS.map((t) => `<button class="tab" data-tab="${t.id}">${t.label}</button>`).join('');
  $('board-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { tab = b.dataset.tab; renderedKey = ''; }
  });
  $('board-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-leg]');
    if (!b) return;
    toggleLeg(JSON.parse(b.dataset.leg));
    renderedKey = ''; // re-render selection state
  });
}

const legAttr = (leg) => `data-leg='${JSON.stringify(leg).replace(/'/g, '&#39;')}'`;

function oddsBtn(leg, tag) {
  const sel = hasLeg(leg) ? ' sel' : '';
  return `<button class="odds-btn${sel}" ${legAttr(leg)}><small>${tag}</small>${fmtOdds(leg.odds)}</button>`;
}

function statBars(r, accent) {
  const s = r.stats;
  return `<div class="statbars" style="--tc:${accent}">${[s.pace, s.consistency, s.aggression, s.craft]
    .map((v) => `<i><b style="width:${v}%"></b></i>`).join('')}</div>`;
}

export function updateBoard(ctx) {
  const st = tourState(ctx.boardTourId);
  const race = st.phase === 'betting' ? st.race : (st.next || null);

  if (st.phase !== 'betting') {
    // Race went green while browsing — jump to the broadcast.
    ctx.showView('live', ctx.boardTourId);
    return;
  }

  $('board-title').textContent = `${race.tour.name} — ${race.track.name}`;
  $('board-sub').textContent = `${race.track.loc} · ${race.field.length} racers · Purse ${race.purse}K · closes in ${Math.ceil(st.countdown)}s`;

  const key = `${race.key}|${tab}`;
  if (key === renderedKey) return;
  renderedKey = key;

  document.querySelectorAll('#board-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));

  const m = markets(race);
  const base = { tourId: race.tourId, cycle: race.cycle };
  const raceLabel = `${race.tour.name} · ${race.track.name}`;
  const rows = [];

  const racerRow = (o, btns) => `
    <div class="race-row">
      <img src="${portraitDataURI(o.racer)}" alt="" loading="lazy"/>
      <div class="rr-info">
        <div class="rr-name">${o.racer.flag} ${o.racer.name} ${isSponsored(o.racer.id) ? '⭐' : ''}</div>
        <div class="rr-meta"><span class="num">#${o.racer.number}</span> · ${o.racer.team}</div>
        ${statBars(o.racer, race.tour.accent)}
      </div>
      ${btns}
    </div>`;

  if (tab === 'winner') {
    for (const o of m.outrights) {
      rows.push(racerRow(o, oddsBtn({ ...base, market: 'win', racerId: o.racer.id, odds: o.win, label: `${o.racer.short} · Winner`, sub: raceLabel }, 'WIN')));
    }
  } else if (tab === 'podium') {
    for (const o of m.outrights) {
      rows.push(racerRow(o, oddsBtn({ ...base, market: 'podium', racerId: o.racer.id, odds: o.podium, label: `${o.racer.short} · Podium`, sub: raceLabel }, 'TOP 3')));
    }
  } else if (tab === 'topn') {
    for (const o of m.outrights) {
      rows.push(racerRow(o,
        oddsBtn({ ...base, market: 'topN', n: m.topN, racerId: o.racer.id, odds: o.topN, label: `${o.racer.short} · Top ${m.topN}`, sub: raceLabel }, `TOP ${m.topN}`) +
        oddsBtn({ ...base, market: 'topHalf', racerId: o.racer.id, odds: o.topHalf, label: `${o.racer.short} · Top Half`, sub: raceLabel }, 'TOP ½')));
    }
  } else {
    rows.push(`<div class="rr-meta" style="padding:10px 0 4px;font-weight:800;letter-spacing:.08em">HEAD-TO-HEAD — who finishes ahead?</div>`);
    for (const h of m.h2h) {
      rows.push(`
        <div class="race-row">
          <div class="rr-info"><div class="rr-name">${h.a.flag} ${h.a.short} vs ${h.b.flag} ${h.b.short}</div>
          <div class="rr-meta">#${h.a.number} ${h.a.team} · #${h.b.number} ${h.b.team}</div></div>
          ${oddsBtn({ ...base, market: 'h2h', racerId: h.a.id, vsRacerId: h.b.id, odds: h.oddsA, label: `${h.a.short} beats ${h.b.short}`, sub: raceLabel }, h.a.code)}
          ${oddsBtn({ ...base, market: 'h2h', racerId: h.b.id, vsRacerId: h.a.id, odds: h.oddsB, label: `${h.b.short} beats ${h.a.short}`, sub: raceLabel }, h.b.code)}
        </div>`);
    }
    rows.push(`<div class="rr-meta" style="padding:10px 0 4px;font-weight:800;letter-spacing:.08em">WINNING MARGIN</div>`);
    rows.push(`
      <div class="race-row">
        <div class="rr-info"><div class="rr-name">Winning margin vs ${m.props.marginLine.toFixed(1)}s</div>
        <div class="rr-meta">Gap from P1 to P2 at the flag</div></div>
        ${oddsBtn({ ...base, market: 'marginOver', line: m.props.marginLine, odds: m.props.marginOver, label: `Margin over ${m.props.marginLine.toFixed(1)}s`, sub: raceLabel }, 'OVER')}
        ${oddsBtn({ ...base, market: 'marginUnder', line: m.props.marginLine, odds: m.props.marginUnder, label: `Margin under ${m.props.marginLine.toFixed(1)}s`, sub: raceLabel }, 'UNDER')}
      </div>`);
    rows.push(`<div class="rr-meta" style="padding:10px 0 4px;font-weight:800;letter-spacing:.08em">HOLESHOT — leads the opening lap</div>`);
    for (const o of m.props.holeshot.slice().sort((a, b) => a.odds - b.odds).slice(0, 8)) {
      rows.push(racerRow({ racer: o.racer }, oddsBtn({ ...base, market: 'holeshot', racerId: o.racer.id, odds: o.odds, label: `${o.racer.short} · Holeshot`, sub: raceLabel }, 'LAP 1')));
    }
    rows.push(`<div class="rr-meta" style="padding:10px 0 4px;font-weight:800;letter-spacing:.08em">FASTEST LAP</div>`);
    for (const o of m.props.fastestLap.slice().sort((a, b) => a.odds - b.odds).slice(0, 8)) {
      rows.push(racerRow({ racer: o.racer }, oddsBtn({ ...base, market: 'fastestLap', racerId: o.racer.id, odds: o.odds, label: `${o.racer.short} · Fastest Lap`, sub: raceLabel }, 'F-LAP')));
    }
  }

  $('board-rows').innerHTML = rows.join('');
  renderSlip();
}

export function invalidateBoard() { renderedKey = ''; }
