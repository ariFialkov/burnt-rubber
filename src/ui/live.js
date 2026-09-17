// Live broadcast HUD: position tower, camera bar, event feed, in-race popup
// bets, live bet status, and the results overlay.

import * as THREE from 'three';
import { tourState } from '../engine/schedule.js';
import { getScript, getFocusLayer } from '../engine/script.js';
import { RTP, fmtOdds } from '../engine/odds.js';
import { placeBet, store, focusRacerIdx, liveBetsFor, isSponsored, settleDue } from '../engine/bets.js';
import { CAMERA_MODES } from '../three/cameras.js';
import { portraitDataURI } from './avatars.js';
import { clamp } from '../core/rng.js';

const $ = (id) => document.getElementById(id);

let ctxRef = null;
let ui = null; // per-race UI state

function freshState(race) {
  return {
    raceKey: race.key,
    shownPopups: new Set(),
    active: null,      // {popup, text, odds, stake, deadlineT}
    resultsShown: false,
    prevLeader: -1,
    prevRanks: null,
    lastEventT: 0,
    flAnnounced: false,
    holeshotAnnounced: false,
    towerBuiltFor: '',
    finishKey: '',
    crossT: new Map(), // racer idx -> the race time it crossed the line
  };
}

export function initLive(ctx) {
  ctxRef = ctx;
  $('cam-chips').innerHTML = CAMERA_MODES
    .map((m) => `<button class="cam-chip" data-cam="${m.id}">${m.icon} ${m.label}</button>`).join('');
  $('cam-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cam]');
    if (b) setCam(b.dataset.cam);
  });
  $('car-prev').addEventListener('click', () => cycleCar(-1));
  $('car-next').addEventListener('click', () => cycleCar(1));
  $('popup-bet').addEventListener('click', onPopupClick);
  $('results').addEventListener('click', (e) => {
    if (e.target.closest('.cont-btn')) ctxRef.showView('hub');
  });
  $('live-race').parentElement.addEventListener('click', () => {
    const st = tourState(ctxRef.liveTourId);
    if (st.phase === 'betting') ctxRef.showView('board', ctxRef.liveTourId);
  });
  initPicking(ctx);
}

// Click-to-follow: a tap on any car in view — its body or the label over it
// — puts the camera on that car. Onboard views keep their view and change
// the driver; the cinematic and chopper cameras cut to 3rd person.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmp = new THREE.Vector3();
let press = null;

function carAt(clientX, clientY) {
  const scene = ctxRef.currentScene;
  if (!scene) return -1;
  const cam = ctxRef.rig.camera;
  const rect = ctxRef.canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height;
  // The body or label under the pointer first. The car being ridden onboard
  // (its label is hidden) is not a target: its own body fills the frame.
  ndc.set(x * 2 - 1, -(y * 2 - 1));
  raycaster.setFromCamera(ndc, cam);
  const targets = scene.cars.filter((c) => c.sprite.visible).map((c) => c.group);
  for (const h of raycaster.intersectObjects(targets, true)) {
    let o = h.object;
    while (o && o.userData.carIdx === undefined) o = o.parent;
    if (o && (h.object.visible || h.object.isMesh)) return o.userData.carIdx;
  }
  // ...else the nearest label on screen within a thumb's reach, so a far car
  // under the chopper is still an easy target.
  let best = -1, bestD = 44 * 44;
  for (let i = 0; i < scene.cars.length; i++) {
    const c = scene.cars[i];
    if (!c.sprite.visible) continue;
    c.sprite.getWorldPosition(tmp).project(cam);
    if (tmp.z > 1) continue; // behind the camera
    const sx = (tmp.x + 1) / 2 * rect.width, sy = (1 - tmp.y) / 2 * rect.height;
    const d = (sx - (clientX - rect.left)) ** 2 + (sy - (clientY - rect.top)) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function followCar(idx) {
  ctxRef.selectedCarIdx = idx;
  const mode = ['chase', 'cockpit', 'hood'].includes(ctxRef.rig.mode) ? ctxRef.rig.mode : 'chase';
  setCam(mode);
}

function initPicking(ctx) {
  const canvas = ctx.canvas;
  ctx.pickCar = carAt; // for harnesses
  // The car is resolved at the moment of the press — cars keep moving under
  // a finger, and the press is where the eye was.
  canvas.addEventListener('pointerdown', (e) => {
    if (ctx.view !== 'live') return;
    press = { x: e.clientX, y: e.clientY, t: performance.now(), idx: carAt(e.clientX, e.clientY) };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!press || ctx.view !== 'live') { press = null; return; }
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    const held = performance.now() - press.t;
    const idx = press.idx;
    press = null;
    if (moved > 10 || held > 600) return; // a drag or a hold, not a tap
    if (idx >= 0) followCar(idx);
  });
  // Show a hand over a car so the mechanic is discoverable with a mouse.
  let hoverTick = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (ctx.view !== 'live' || e.pointerType === 'touch') return;
    if (performance.now() - hoverTick < 80) return;
    hoverTick = performance.now();
    canvas.style.cursor = carAt(e.clientX, e.clientY) >= 0 ? 'pointer' : '';
  });
}

function setCam(mode) {
  if (ui?.pitCam && mode !== 'pit') endPitScene(true); // the viewer took the camera back
  ctxRef.rig.setMode(mode, ctxRef.selectedCarIdx);
  document.querySelectorAll('.cam-chip').forEach((b) => b.classList.toggle('active', b.dataset.cam === mode));
  $('car-select').style.visibility = ['chase', 'cockpit', 'hood'].includes(mode) ? 'visible' : 'hidden';
}

function cycleCar(dir) {
  const scene = ctxRef.currentScene;
  if (!scene) return;
  const st = tourState(ctxRef.liveTourId);
  const order = scene.standingsNow(st.tRace);
  const pos = order.indexOf(ctxRef.selectedCarIdx);
  ctxRef.selectedCarIdx = order[(pos + dir + order.length) % order.length];
  ctxRef.rig.setMode(ctxRef.rig.mode, ctxRef.selectedCarIdx);
}

function onPopupClick(e) {
  if (!ui?.active) return;
  const st = tourState(ctxRef.liveTourId);
  const stakeBtn = e.target.closest('[data-pstake]');
  if (stakeBtn) {
    ui.active.stake = Number(stakeBtn.dataset.pstake);
    renderPopup(st);
    return;
  }
  if (e.target.closest('.pb-cam')) {
    ctxRef.selectedCarIdx = ui.active.popup.focusIdx;
    setCam('chase');
    return;
  }
  if (e.target.closest('.pb-skip')) {
    dismissPopup();
    return;
  }
  const accept = e.target.closest('.pb-accept');
  if (accept) {
    const a = ui.active;
    const race = st.race;
    const side = accept.dataset.side || null;
    const odds = side === 'under' ? a.oddsUnder : a.odds;
    const label = side ? `${race.field[a.popup.focusIdx].short} pit stop ${side.toUpperCase()} ${a.popup.line.toFixed(1)}s` : a.text;
    const bet = placeBet([{
      tourId: race.tourId, cycle: race.cycle, market: 'popup',
      popupId: a.popup.id, focusIdx: a.popup.focusIdx, side,
      racerId: race.field[a.popup.focusIdx].id,
      odds, label, sub: `${race.tour.name} · in-race`,
    }], a.stake);
    if (bet) {
      ctxRef.toast(`Live bet on! ${fmtOdds(odds)} 🎟️`, 'win');
      ctxRef.updateWallet();
    } else {
      ctxRef.toast('Not enough credits', 'lose');
    }
    dismissPopup();
  }
}

function dismissPopup() {
  ui.active = null;
  $('popup-bet').classList.add('hidden');
}

// Full render only on open/stake change; the per-frame path just updates the
// countdown so buttons keep their DOM identity (taps must land).
function tickPopup(st) {
  const a = ui.active;
  const el = $('popup-bet').querySelector('.pb-timer');
  if (el) el.textContent = `${Math.max(0, a.deadlineT - st.tRace).toFixed(0)}s`;
}

function renderPopup(st) {
  const a = ui.active;
  const left = Math.max(0, a.deadlineT - st.tRace);
  $('popup-bet').innerHTML = `
    <button class="pb-skip">✕</button>
    <div class="pb-head"><span class="pb-flash">⚡ LIVE BET</span><span class="pb-timer">${left.toFixed(0)}s</span></div>
    <div class="pb-text">${a.text} <span class="pb-odds">@ ${fmtOdds(a.odds)}</span></div>
    <div class="pb-row">${[50, 100, 250].map((v) =>
      `<button class="stake-opt${a.stake === v ? ' sel' : ''}" data-pstake="${v}">${v} ◈</button>`).join('')}</div>
    <div class="pb-actions">
      ${a.popup.sides
        ? `<button class="pb-accept" data-side="over">OVER ${a.popup.line.toFixed(1)}s @ ${fmtOdds(a.odds)}</button>
           <button class="pb-accept alt" data-side="under">UNDER @ ${fmtOdds(a.oddsUnder)}</button>`
        : `<button class="pb-accept">BET ${a.stake} ◈ → ${Math.round(a.stake * a.odds).toLocaleString()} ◈</button>
           <button class="pb-cam">📺 Best cam</button>`}
    </div>`;
  $('popup-bet').classList.remove('hidden');
}

function addEvent(text) {
  const feed = $('event-feed');
  const div = document.createElement('div');
  div.className = 'ev';
  div.textContent = text;
  feed.prepend(div);
  while (feed.children.length > 4) feed.lastChild.remove();
  setTimeout(() => div.remove(), 7000);
}

export function enterLive(ctx) {
  const st = tourState(ctx.liveTourId);
  ui = freshState(st.race);
  $('event-feed').innerHTML = '';
  $('results').classList.add('hidden');
  $('popup-bet').classList.add('hidden');
  $('finish-card').classList.add('hidden');
  $('pit-hud').classList.add('hidden');
  setCam(st.phase === 'racing' ? 'chopper' : 'chopper');
}

export function updateLive(ctx) {
  const st = tourState(ctx.liveTourId);
  const race = st.race;
  const script = getScript(race);
  if (!ui || ui.raceKey !== race.key) {
    ui = freshState(race);
    $('event-feed').innerHTML = '';
    $('results').classList.add('hidden');
    $('popup-bet').classList.add('hidden');
    $('finish-card').classList.add('hidden');
  }

  $('live-race').textContent = `${race.tour.name} — ${race.track.name} · ${race.track.loc}${race.wet ? ' · 🌧 WET' : ''}`;
  const selR = race.field[clamp(ctx.selectedCarIdx, 0, race.field.length - 1)];
  $('car-name').textContent = `#${selR.number} ${selR.short}`;

  if (st.phase === 'betting') {
    $('live-lap').textContent = `ON THE GRID · BETTING CLOSES ${Math.ceil(st.countdown)}s — TAP TO BET`;
    updateTower(ctx, st, script, true);
    return;
  }

  const t = st.tRace;
  const focusIdx = focusRacerIdx(race);
  const lap = clamp(Math.floor(script.distance(script.finishOrder[0] ?? 0, Math.min(t, script.T)) / script.lapLen) + 1, 1, race.tour.laps);
  const leadD = clamp(script.distance(script.finishOrder[0] ?? 0, Math.min(t, script.T)), 0, script.totalDist);
  $('live-lap').textContent = st.phase === 'post' || t >= script.T
    ? '🏁 CHECKERED FLAG'
    : race.tour.laps === 1
      ? `${(leadD / 1000).toFixed(1)} / ${(script.totalDist / 1000).toFixed(1)} KM · ${(Math.min(t, script.T)).toFixed(0)}s`
      : `LAP ${lap}/${race.tour.laps} · ${(Math.min(t, script.T)).toFixed(0)}s`;

  updateTower(ctx, st, script, false);
  updateLiveBets(ctx, st, script);

  if (st.phase === 'racing') {
    detectEvents(ctx, st, script, focusIdx);
    handlePopups(ctx, st, script, focusIdx);
    if (ui.active) tickPopup(st);
    updatePitScene(ctx, st, script, focusIdx);
  } else if (ui.pitCam) endPitScene(false);

  updateFinishCard(ctx, st, script);

  if (st.phase === 'post' && !ui.resultsShown) {
    ui.resultsShown = true;
    showResults(ctx, race, script);
  }
}

// When the car being ridden onboard crosses the line, say so — a dark card
// with the racer, their time and finishing position — while the camera bar
// stays usable underneath so the viewer can keep switching cars and cams.
function crossingTime(script, i, adj) {
  let lo = 0, hi = script.T + (script.maxGap ?? 10) + 5;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (script.distance(i, mid, adj) < script.totalDist) lo = mid; else hi = mid;
  }
  return hi;
}
const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;

function updateFinishCard(ctx, st, script) {
  const race = st.race;
  const scene = ctx.currentScene;
  const onboard = ['chase', 'cockpit', 'hood'].includes(ctx.rig.mode);
  const sel = clamp(ctx.selectedCarIdx, 0, race.field.length - 1);
  const car = scene?.cars[sel];
  const show = onboard && st.phase === 'racing' && !!car && car.dist >= script.totalDist && !ui.resultsShown;
  const key = show ? String(sel) : '';
  const el = $('finish-card');
  // Never trust the cached key alone: a fresh UI state (new race, re-entered
  // view) starts blank while the card may still be up from before.
  if (!show) { el.classList.add('hidden'); ui.finishKey = ''; return; }
  if (key === ui.finishKey && !el.classList.contains('hidden')) return;
  ui.finishKey = key;
  const r = race.field[sel];
  const pos = script.finishOrder.indexOf(sel) + 1;
  if (!ui.crossT.has(sel)) ui.crossT.set(sel, crossingTime(script, sel, scene.adj));
  const tCross = ui.crossT.get(sel);
  const suffix = pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th';
  el.innerHTML = `
    <div class="fc-card">
      <div class="fc-flag">🏁 CHECKERED FLAG</div>
      <div class="fc-title">FINISHED</div>
      <div class="fc-racer"><img src="${portraitDataURI(r)}" alt=""/><span>${r.flag} #${r.number} ${r.name}</span></div>
      <div class="fc-pos">P${pos}<small>${pos}${suffix} of ${race.field.length}${pos === 1 ? ' · WINNER' : ''}</small></div>
      <div class="fc-time">
        <div>${fmtTime(tCross)}<small>RACE TIME</small></div>
        <div>${pos === 1 ? '—' : `+${script.finalGap[sel].toFixed(3)}s`}<small>TO WINNER</small></div>
      </div>
      <div class="fc-hint">Cameras stay live — switch cars or views below</div>
    </div>`;
  el.classList.remove('hidden');
}

let towerTick = 0;
function updateTower(ctx, st, script, gridMode) {
  if (performance.now() - towerTick < 400) return;
  towerTick = performance.now();
  const race = st.race;
  const scene = ctx.currentScene;
  const order = gridMode ? script.grid : script.standings(clamp(st.tRace / script.T, 0, 1), scene?.adj ?? null);
  const focusIdx = focusRacerIdx(race);
  const betIds = new Set();
  // Infinity hold: a bet settling mid-race must not un-mark its racer.
  for (const b of liveBetsFor(race, Date.now(), Infinity)) for (const l of b.legs) if (l.racerId) betIds.add(l.racerId);

  const max = Math.min(order.length, 20);
  let html = '';
  for (let k = 0; k < max; k++) {
    const i = order[k];
    const r = race.field[i];
    const cls = ['tw-row', k === 0 ? 'p1' : '', i === focusIdx ? 'focus' : betIds.has(r.id) ? 'bet' : ''].join(' ');
    const gap = gridMode ? `#${r.number}` :
      k === 0 ? 'LEAD' : `+${(script.gapSec(i, clamp(st.tRace / script.T, 0, 1), scene?.adj ?? null) - script.gapSec(order[0], clamp(st.tRace / script.T, 0, 1), scene?.adj ?? null)).toFixed(1)}`;
    html += `<div class="${cls}"><span class="p">${k + 1}</span><span class="n">${r.flag} ${r.short}${isSponsored(r.id) ? '⭐' : ''}</span><span class="gap">${gap}</span></div>`;
  }
  if (order.length > max) html += `<div class="tw-row"><span class="p">…</span><span class="n">+${order.length - max} more</span></div>`;
  $('tower').innerHTML = html;
}

let liveBetsTick = 0;
function updateLiveBets(ctx, st, script) {
  if (performance.now() - liveBetsTick < 1000) return;
  liveBetsTick = performance.now();
  const race = st.race;
  const scene = ctx.currentScene;
  // Settled side bets stay on the rail briefly so a mid-race result is seen
  // landing, instead of the ticket just disappearing.
  const now = Date.now();
  const all = liveBetsFor(race, now);
  all.sort((a, b) => (a.status === 'open' ? 1 : 0) - (b.status === 'open' ? 1 : 0));
  const bets = all.slice(0, 3);
  const s = clamp(st.tRace / script.T, 0, 1);
  $('live-bets').innerHTML = bets.map((b) => {
    const leg = b.legs.find((l) => l.tourId === race.tourId && l.cycle === race.cycle);
    let status = '';
    if (b.status !== 'open') {
      status = b.status === 'won'
        ? ` — <span class="ok">WON +${b.payout.toLocaleString()} ◈</span>`
        : ' — <span class="bad">LOST</span>';
    } else if (leg?.racerId) {
      const idx = race.field.findIndex((r) => r.id === leg.racerId);
      if (idx >= 0) {
        const p = script.standings(s, scene?.adj ?? null).indexOf(idx) + 1;
        const good = (leg.market === 'win' && p === 1) || (leg.market === 'podium' && p <= 3) || (leg.market === 'topN' && p <= (leg.n || 3));
        status = ` — <span class="${good ? 'ok' : 'bad'}">now P${p}</span>`;
      }
    }
    const done = b.status === 'open' ? '' : ` lb-${b.status}`;
    return `<div class="lb${done}"><b>${leg?.label || b.kind}</b> · ${b.stake}◈ @ ${fmtOdds(b.odds)}${status}</div>`;
  }).join('');
}

function detectEvents(ctx, st, script, focusIdx) {
  const t = st.tRace;
  if (t - ui.lastEventT < 0.5) return;
  ui.lastEventT = t;
  const race = st.race;
  const scene = ctx.currentScene;
  const s = clamp(t / script.T, 0, 1);
  const order = script.standings(s, scene?.adj ?? null);

  if (!ui.holeshotAnnounced && s > (race.tour.laps === 1 ? 0.12 : 0.9 / race.tour.laps * 0.5) && s > 0.06) {
    ui.holeshotAnnounced = true;
    addEvent(`🚀 ${race.field[order[0]].short} wins the start!`);
  }
  if (!ui.flAnnounced && s >= script.fastestLapS) {
    ui.flAnnounced = true;
    addEvent(`⏱️ Fastest ${race.tour.laps === 1 ? 'split' : 'lap'} — ${race.field[script.fastestLapIdx].short}`);
  }
  if (ui.prevLeader >= 0 && order[0] !== ui.prevLeader && s < 0.97) {
    addEvent(`🔥 ${race.field[order[0]].short} takes the LEAD!`);
  }
  ui.prevLeader = order[0];

  // Focus racer position changes
  if (ui.prevRanks) {
    const prev = ui.prevRanks.indexOf(focusIdx);
    const now = order.indexOf(focusIdx);
    if (now < prev) addEvent(`▲ ${race.field[focusIdx].short} up to P${now + 1}`);
    else if (now > prev && s < 0.95) addEvent(`▼ ${race.field[focusIdx].short} drops to P${now + 1}`);
  }
  ui.prevRanks = order;
}

function handlePopups(ctx, st, script, focusIdx) {
  const race = st.race;
  const t = st.tRace;
  const layer = getFocusLayer(race, focusIdx);
  if (ui.active) {
    if (t >= ui.active.deadlineT) dismissPopup();
    return;
  }
  for (const pu of layer.popups) {
    if (ui.shownPopups.has(pu.id)) continue;
    const offerT = pu.offerS * script.T;
    const closeT = pu.s0 * script.T;
    if (t >= offerT && t < closeT - 1) {
      ui.shownPopups.add(pu.id);
      const focus = race.field[pu.focusIdx];
      const target = pu.targetIdx != null ? race.field[pu.targetIdx] : null;
      ui.active = {
        popup: pu,
        text: pu.text(focus, target),
        odds: Math.max(1.05, RTP / pu.p),
        oddsUnder: pu.sides ? Math.max(1.05, RTP / Math.max(0.02, 1 - pu.p)) : null,
        stake: 100,
        deadlineT: closeT,
      };
      renderPopup(st);
      break;
    }
  }
}

// The focus car's pit stop as a cutscene: the camera goes to the pit shot
// list and a stopwatch takes the screen, from a couple of seconds before
// the lane to a moment after the car rejoins.
function updatePitScene(ctx, st, script, focusIdx) {
  const race = st.race;
  if (!script.pit) return;
  const scene = ctx.currentScene;
  const ps = script.pitState(focusIdx, st.tRace, scene?.adj ?? null);
  if (!ps) return;
  const on = ps.tw >= ps.tEnter - 2.2 && ps.tw <= Math.min(ps.tCruise, ps.tExit + 2.5);
  if (!on) { if (ui.pitCam) endPitScene(false); return; }
  if (ui.pitSkipped === ps.tEnter) return;
  if (!ui.pitCam) {
    ui.pitCam = { prevMode: ctx.rig.mode, prevCar: ctx.selectedCarIdx };
    ctx.selectedCarIdx = focusIdx;
    ctx.rig.pitPhase = null;
    ctx.rig.setMode('pit', focusIdx);
    document.querySelectorAll('.cam-chip').forEach((b) => b.classList.remove('active'));
    $('pit-hud').classList.remove('hidden');
  }
  const r = race.field[focusIdx];
  const line = script.pit.line;
  const myLeg = store.bets.find((b) => b.status === 'open' && b.legs.some((l) => l.popupId === `${race.key}@${focusIdx}#pit`))?.legs.find((l) => l.popupId === `${race.key}@${focusIdx}#pit`);
  const stopT = ps.tw < ps.tBox ? 0 : Math.min(ps.tw - ps.tBox, ps.D);
  const done = ps.tw >= ps.tLeave;
  const phase = ps.tw < ps.tEnter ? 'PIT ENTRY' : ps.tw < ps.tBox ? 'IN THE LANE' : !done ? 'STATIONARY' : ps.tw < ps.tExit ? 'GO GO GO' : 'REJOINING';
  const over = stopT > line;
  const cls = ps.tw < ps.tBox ? '' : over ? 'over' : done ? 'under' : '';
  $('pit-hud').innerHTML = `
    <div class="ph-top"><span class="ph-team" style="--tp:${r.colors[0]};--tb:${r.colors[2] || '#fff'};--ink:${inkFor(r.colors[2] || '#fff')}">#${r.number} ${r.short} · ${r.team}</span><span class="ph-phase">${phase}</span></div>
    <div class="ph-clock ${cls}">${stopT.toFixed(2)}<small>s</small></div>
    <div class="ph-line">LINE ${line.toFixed(1)}s${myLeg ? ` · YOUR BET: <b>${myLeg.side ? myLeg.side.toUpperCase() : 'OVER'}</b>` : ''}${done ? ` · <b class="${cls}">${over ? 'OVER' : 'UNDER'}</b>` : ''}</div>`;
}
// Dark or light lettering for a swatch, by its luminance.
function inkFor(hex) {
  const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return l > 0.55 ? '#111' : '#f4f4f4';
}
function endPitScene(skipped) {
  if (!ui?.pitCam) return;
  const { prevMode, prevCar } = ui.pitCam;
  ui.pitCam = null;
  if (skipped) {
    const st = tourState(ctxRef.liveTourId);
    const ps = getScript(st.race).pitState(focusRacerIdx(st.race), st.tRace, ctxRef.currentScene?.adj ?? null);
    ui.pitSkipped = ps ? ps.tEnter : true;
  } else {
    ctxRef.selectedCarIdx = prevCar;
    ctxRef.rig.setMode(prevMode, prevCar);
    document.querySelectorAll('.cam-chip').forEach((b) => b.classList.toggle('active', b.dataset.cam === prevMode));
  }
  $('pit-hud').classList.add('hidden');
}

function showResults(ctx, race, script) {
  settleDue(); // make sure this race's bets are settled before we display them
  ctx.updateWallet();
  const podium = script.finishOrder.slice(0, 3).map((i) => race.field[i]);
  const myBets = store.bets.filter((b) =>
    b.legs.some((l) => l.tourId === race.tourId && l.cycle === race.cycle) && b.status !== 'open').slice(0, 8);
  $('results').innerHTML = `
    <div class="results-card">
      <h2>🏁 ${race.track.name.toUpperCase()}</h2>
      <div class="panel-sub">${race.tour.name} · ${race.track.loc}</div>
      <div class="podium">
        ${[podium[1], podium[0], podium[2]].map((r, k) => r ? `
          <div class="pod">
            <img src="${portraitDataURI(r)}" alt=""/>
            <div class="pp">P${k === 0 ? 2 : k === 1 ? 1 : 3}</div>
            <div class="pn">${r.flag} ${r.short}</div>
          </div>` : '').join('')}
      </div>
      ${myBets.length ? `<div class="res-bets">${myBets.map((b) => `
        <div class="res-bet">
          <span>${b.legs.map((l) => l.label).join(' + ')}</span>
          <span class="${b.status}">${b.status === 'won' ? `+${b.payout.toLocaleString()} ◈` : `−${b.stake.toLocaleString()} ◈`}</span>
        </div>`).join('')}</div>` : ''}
      <button class="cont-btn">BACK TO THE HUB</button>
    </div>`;
  $('results').classList.remove('hidden');
}
