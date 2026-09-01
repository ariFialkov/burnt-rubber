// Burnt Rubber — app orchestrator: renderer, view routing, the world clock,
// scene cache, and the settle loop.

import * as THREE from 'three';
import { allTourStates, tourState } from './engine/schedule.js';
import { getScript } from './engine/script.js';
import { store, settleDue, topUpIfBroke, focusRacerIdx } from './engine/bets.js';
import { RaceScene } from './three/scene.js';
import { CameraRig } from './three/cameras.js';
import { initHub, updateHub } from './ui/hub.js';
import { initBoard, updateBoard, invalidateBoard } from './ui/board.js';
import { initSlip, renderSlip } from './ui/slip.js';
import { initLive, updateLive, enterLive } from './ui/live.js';
import { initGarage, renderGarage } from './ui/garage.js';
import { renderMyBets } from './ui/mybets.js';
import { initTickets, renderTickets } from './ui/tickets.js';
import { clamp } from './core/rng.js';

const $ = (id) => document.getElementById(id);

// --- Renderer ---------------------------------------------------------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const rig = new CameraRig(innerWidth / innerHeight);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  rig.resize(innerWidth / innerHeight);
}
addEventListener('resize', resize);
resize();

// --- Scene cache ------------------------------------------------------------
const sceneCache = new Map(); // race.key -> RaceScene
function sceneFor(race) {
  let s = sceneCache.get(race.key);
  if (!s) {
    s = new RaceScene(race);
    sceneCache.set(race.key, s);
    if (sceneCache.size > 3) {
      const oldest = sceneCache.keys().next().value;
      sceneCache.get(oldest).dispose();
      sceneCache.delete(oldest);
    }
  }
  return s;
}

// --- App context ------------------------------------------------------------
const ctx = {
  view: 'hub',
  hubIdx: 0,
  boardTourId: null,
  liveTourId: null,
  selectedCarIdx: 0,
  rig,
  currentScene: null,
  toast,
  updateWallet,
  showView,
  openTour,
  refreshBoard: () => { invalidateBoard(); },
  lapOf(st) {
    const script = getScript(st.race);
    const leadDist = script.distance(script.finishOrder[0], Math.min(st.tRace, script.T));
    return clamp(Math.floor(leadDist / script.lapLen) + 1, 1, st.race.tour.laps);
  },
};

function showView(name, tourId) {
  ctx.view = name;
  for (const v of document.querySelectorAll('.view')) v.classList.add('hidden');
  $(`view-${name}`).classList.remove('hidden');
  if (name === 'board') { ctx.boardTourId = tourId ?? ctx.boardTourId; invalidateBoard(); }
  if (name === 'live') {
    ctx.liveTourId = tourId ?? ctx.liveTourId;
    const st = tourState(ctx.liveTourId);
    ctx.selectedCarIdx = focusRacerIdx(st.race);
    enterLive(ctx);
  }
  if (name === 'garage') renderGarage();
  if (name === 'mybets') renderMyBets();
  if (name !== 'live') rig.setMode('chopper');
  renderSlip();
}

function openTour(tourId) {
  const st = tourState(tourId);
  showView(st.phase === 'betting' ? 'board' : 'live', tourId);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) showView('hub');
});

// --- Wallet + toasts --------------------------------------------------------
function updateWallet() {
  const amt = Math.round(store.wallet).toLocaleString();
  $('wallet-amt').textContent = amt;
  document.querySelectorAll('.wallet-amt-2').forEach((el) => { el.textContent = amt; });
  $('openbets-count').textContent = store.bets.filter((b) => b.status === 'open').length;
}

function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// --- Boot -------------------------------------------------------------------
initHub(ctx);
initSlip(ctx);
initBoard(ctx);
initLive(ctx);
initGarage(ctx);
initTickets(ctx);
updateWallet();
if (topUpIfBroke()) toast('Welcome bonus: +10,000 ◈', 'win');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// --- Main loop --------------------------------------------------------------
let last = performance.now();
let hubTimer = 0;
let settleTimer = 0;
let uiTimer = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = clamp((nowMs - last) / 1000, 0.001, 0.1);
  last = nowMs;
  const now = Date.now();
  const states = allTourStates(now);

  // Settle finished bets + broke check (every 2s)
  settleTimer += dt;
  if (settleTimer > 2) {
    settleTimer = 0;
    const settled = settleDue(now);
    for (const b of settled) {
      if (b.status === 'won') toast(`${b.kind === 'parlay' ? 'PARLAY' : 'BET'} WON +${b.payout.toLocaleString()} ◈ 🎉`, 'win');
      else toast(`Bet lost −${b.stake.toLocaleString()} ◈`, 'lose');
    }
    if (settled.length) updateWallet();
    if (topUpIfBroke()) toast('Bankroll refilled: +10,000 ◈', 'win');
  }

  // Which race is on the backdrop?
  let st;
  if (ctx.view === 'live') {
    st = tourState(ctx.liveTourId, now);
  } else if (ctx.view === 'board') {
    st = tourState(ctx.boardTourId, now);
  } else {
    hubTimer += dt;
    if (hubTimer > 9) {
      hubTimer = 0;
      ctx.hubIdx = (ctx.hubIdx + 1) % states.length;
      rig.snap = true;
    }
    // Prefer showing racing tours on the hub backdrop
    st = states[ctx.hubIdx];
  }

  const scene = sceneFor(st.race);
  ctx.currentScene = scene;
  const racing = st.phase !== 'betting';
  if (racing) scene.setFocus(focusRacerIdx(st.race));
  scene.update(racing ? 'race' : 'grid', st.tRace, dt, nowMs / 1000);

  if (ctx.view === 'live' && ctx.selectedCarIdx >= st.race.field.length) ctx.selectedCarIdx = 0;
  rig.carIdx = ctx.view === 'live' ? ctx.selectedCarIdx : scene.leaderIdx;
  rig.update(scene, dt);
  renderer.render(scene.scene, rig.camera);

  // UI updates (throttled)
  uiTimer += dt;
  if (uiTimer > 0.45) {
    uiTimer = 0;
    if (ctx.view === 'hub' || ctx.view === 'garage' || ctx.view === 'mybets') updateHub(ctx, states);
    if (ctx.view === 'hub') renderTickets(now);
    if (ctx.view === 'board') updateBoard(ctx);
  }
  if (ctx.view === 'live') updateLive(ctx);
}
requestAnimationFrame(frame);
