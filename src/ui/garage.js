// Garage: sponsor (buy) racers for the winnings bonus, sell them back.

import { TOURS } from '../data/tours.js';
import { RACER_BANKS } from '../data/racers.js';
import { store, buyRacer, sellRacer, isSponsored } from '../engine/bets.js';
import { SPONSOR_SELLBACK } from '../engine/odds.js';
import { portraitDataURI } from './avatars.js';

const $ = (id) => document.getElementById(id);
let tab = TOURS[0].id;
let ctxRef = null;

export function initGarage(ctx) {
  ctxRef = ctx;
  $('garage-tabs').innerHTML = TOURS
    .map((t) => `<button class="tab" data-gtab="${t.id}">${t.name}</button>`).join('');
  $('garage-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gtab]');
    if (b) { tab = b.dataset.gtab; renderGarage(); }
  });
  $('garage-rows').addEventListener('click', (e) => {
    const buy = e.target.closest('[data-buy]');
    const sell = e.target.closest('[data-sell]');
    if (buy) {
      const racer = RACER_BANKS[tab].find((r) => r.id === buy.dataset.buy);
      if (buyRacer(racer)) ctxRef.toast(`You now sponsor ${racer.short}! ⭐ +25% on WIN bets`, 'win');
      else ctxRef.toast('Not enough credits', 'lose');
    } else if (sell) {
      const racer = RACER_BANKS[tab].find((r) => r.id === sell.dataset.sell);
      if (sellRacer(racer.id)) ctxRef.toast(`Sold ${racer.short} back`, '');
    } else return;
    ctxRef.updateWallet();
    renderGarage();
  });
}

export function renderGarage() {
  document.querySelectorAll('#garage-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.gtab === tab));
  const tour = TOURS.find((t) => t.id === tab);
  const bank = RACER_BANKS[tab].slice().sort((a, b) => (isSponsored(b.id) - isSponsored(a.id)) || b.strength - a.strength);
  $('garage-rows').innerHTML = bank.map((r) => {
    const owned = isSponsored(r.id);
    const sellVal = owned ? Math.round(store.sponsorships[r.id].paid * SPONSOR_SELLBACK) : 0;
    return `
    <div class="race-row">
      <img src="${portraitDataURI(r)}" alt="" loading="lazy"/>
      <div class="rr-info">
        <div class="rr-name">${r.flag} ${r.name} ${owned ? '⭐' : ''}</div>
        <div class="rr-meta"><span class="num">#${r.number}</span> · ${r.team} · age ${r.age}</div>
        <div class="statbars" style="--tc:${tour.accent}">${[r.stats.pace, r.stats.consistency, r.stats.aggression, r.stats.craft]
          .map((v) => `<i><b style="width:${v}%"></b></i>`).join('')}</div>
      </div>
      ${owned
        ? `<button class="odds-btn" data-sell="${r.id}"><small>SELL BACK</small>+${sellVal.toLocaleString()} ◈</button>`
        : `<button class="odds-btn" data-buy="${r.id}"><small>SPONSOR</small>${r.price.toLocaleString()} ◈</button>`}
    </div>`;
  }).join('');
}
