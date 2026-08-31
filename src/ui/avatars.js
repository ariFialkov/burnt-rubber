// Procedural driver portraits: helmet-and-shoulders SVG in team livery,
// seeded per racer so every player sees the same faces.

import { mulberry32 } from '../core/rng.js';

const SKIN = ['#f1c9a5', '#e0ac7e', '#c68863', '#a56b46', '#7d4f31', '#5d3a24'];

export function portraitSVG(racer, size = 64) {
  const rand = mulberry32(racer.portraitSeed);
  const [primary, secondary] = racer.colors;
  const skin = SKIN[Math.floor(rand() * SKIN.length)];
  const visorUp = rand() > 0.45;
  const stripe = rand() > 0.5;
  const bg = `bg${racer.portraitSeed % 100000}`;
  return `
<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${bg}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${primary}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#101318"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="10" fill="url(#${bg})"/>
  <!-- shoulders / race suit -->
  <path d="M8 64 Q10 44 32 44 Q54 44 56 64 Z" fill="${secondary}"/>
  <path d="M8 64 Q10 44 32 44 L32 64 Z" fill="${primary}" opacity="0.55"/>
  <!-- neck -->
  <rect x="26" y="38" width="12" height="9" rx="3" fill="${skin}"/>
  <!-- helmet -->
  <path d="M14 30 Q14 8 32 8 Q50 8 50 30 L50 38 Q50 42 46 42 L18 42 Q14 42 14 38 Z" fill="${primary}"/>
  ${stripe ? `<path d="M29 8.2 L35 8.2 L35 42 L29 42 Z" fill="${secondary}"/>` : ''}
  <!-- visor opening -->
  ${visorUp
    ? `<rect x="19" y="22" width="26" height="11" rx="5" fill="${skin}"/>
       <rect x="19" y="22" width="26" height="4.5" rx="2" fill="#2a2e38"/>
       <circle cx="27" cy="28.6" r="1.4" fill="#1c1c22"/><circle cx="37" cy="28.6" r="1.4" fill="#1c1c22"/>`
    : `<rect x="18" y="21" width="28" height="12" rx="6" fill="#1d2430"/>
       <rect x="20" y="23" width="14" height="4" rx="2" fill="#5f7ea6" opacity="0.8"/>`}
  <!-- chin bar -->
  <path d="M18 36 L46 36 L46 40 Q46 42 44 42 L20 42 Q18 42 18 40 Z" fill="${secondary}" opacity="0.9"/>
</svg>`;
}

export function portraitDataURI(racer, size = 64) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(portraitSVG(racer, size))}`;
}
