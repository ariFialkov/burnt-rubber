// Hub screen: chyron over the rotating "news chopper" backdrop + the five
// tour tabs along the bottom, each sliding up on hover to show its leaderboard.

import { markets, fmtOdds } from '../engine/odds.js';
import { getScript } from '../engine/script.js';
import { clamp } from '../core/rng.js';

const $ = (id) => document.getElementById(id);

export function initHub(ctx) {
  $('btn-garage').addEventListener('click', () => ctx.showView('garage'));
  $('btn-mybets').addEventListener('click', () => ctx.showView('mybets'));
  $('wallet-chip').addEventListener('click', () => ctx.showView('mybets'));

  $('tour-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tour]');
    if (!tab) return;
    ctx.openTour(tab.dataset.tour);
  });
}

// One tab per tour, built once and patched in place — rebuilding the DOM
// every tick would reset the hover slide-up mid-animation.
const tabs = new Map(); // tourId -> { el, fields: {name: el, ...}, last: {name: text, ...} }

function tabFor(s) {
  let t = tabs.get(s.tour.id);
  if (t) return t;
  const el = document.createElement('div');
  el.className = 'tour-tab';
  el.dataset.tour = s.tour.id;
  el.style.setProperty('--tc', s.tour.accent);
  el.innerHTML = `
    <div class="tt-board">
      <div class="tt-board-title"></div>
      <div class="tt-rows"></div>
    </div>
    <div class="tt-main">
      <div class="tt-name" style="color:${s.tour.accent}"><span class="tt-full">${s.tour.name}</span><span class="tt-short">${s.tour.tag}</span></div>
      <div class="tt-race"></div>
      <div class="tt-status"></div>
      <div class="tt-btn"></div>
    </div>`;
  $('tour-tabs').appendChild(el);
  t = {
    el,
    fields: Object.fromEntries(['tt-board-title', 'tt-rows', 'tt-race', 'tt-status', 'tt-btn'].map((c) => [c, el.querySelector('.' + c)])),
    last: {},
  };
  tabs.set(s.tour.id, t);
  return t;
}

function patch(t, field, html) {
  if (t.last[field] === html) return;
  t.last[field] = html;
  t.fields[field].innerHTML = html;
}

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

  // Tour tabs: status and button always showing; on hover the tab slides up
  // to reveal the top of the leaderboard — projected from the win odds before
  // the start, live standings once it is running — with each racer's odds.
  for (const s of states) {
    const t = tabFor(s);
    const m = markets(s.race);
    const winOdds = new Map(m.outrights.map((o) => [o.i, o.win]));
    let order, boardTitle;
    if (s.phase === 'betting') {
      order = m.outrights.map((o) => o.i);
      boardTitle = 'PROJECTED';
    } else if (s.phase === 'racing') {
      const script = getScript(s.race);
      order = script.standings(clamp(s.tRace / script.T, 0, 1), null);
      boardTitle = `LIVE · LAP ${ctx.lapOf(s)}`;
    } else {
      order = getScript(s.race).finishOrder;
      boardTitle = 'RESULT';
    }
    const rows = order.slice(0, 5).map((i, k) => {
      const r = s.race.field[i];
      return `<div class="tt-row"><span class="p">${k + 1}</span><span class="n">${r.flag} ${r.short}</span><b>${fmtOdds(winOdds.get(i))}</b></div>`;
    }).join('');
    patch(t, 'tt-board-title', boardTitle);
    patch(t, 'tt-rows', rows);
    patch(t, 'tt-race', `${s.race.track.name} · ${s.race.track.loc}`);
    // Long and short forms; the stylesheet picks one for the screen width.
    const two = (full, short) => `<span class="tt-full">${full}</span><span class="tt-short">${short}</span>`;
    patch(t, 'tt-status',
      s.phase === 'betting' ? two(`Betting · closes <b>${Math.ceil(s.countdown)}s</b>`, `closes <b>${Math.ceil(s.countdown)}s</b>`)
      : s.phase === 'racing' ? two(`<b>● LIVE</b> · lap ${ctx.lapOf(s)}`, `<b>● LIVE</b> L${ctx.lapOf(s)}`)
      : two(`Finished · next <b>${Math.ceil(s.countdown)}s</b>`, `next <b>${Math.ceil(s.countdown)}s</b>`));
    patch(t, 'tt-btn', s.phase === 'betting' ? two('BET BOARD', 'BET') : s.phase === 'racing' ? two('WATCH LIVE', 'LIVE') : two('RESULTS', 'RESULT'));
    t.el.classList.toggle('live', s.phase === 'racing');
  }
}
