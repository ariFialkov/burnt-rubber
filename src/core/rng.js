// Deterministic seeded RNG (mulberry32) + string hashing.
// Everything in the game world (schedules, fields, odds, race outcomes) derives
// from these so any client at the same wall-clock time sees the same "live" races.

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...parts) {
  return mulberry32(hashString(parts.join('|')));
}

export function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

export function shuffled(rand, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Weighted sample of a full ordering (Plackett–Luce): heavier weights tend to
// finish ahead, but any order is possible. Returns array of indices.
export function sampleOrder(rand, weights) {
  const idx = weights.map((_, i) => i);
  const w = weights.slice();
  const order = [];
  while (idx.length) {
    let total = 0;
    for (let i = 0; i < idx.length; i++) total += w[idx[i]];
    let r = rand() * total;
    let chosen = idx.length - 1;
    for (let i = 0; i < idx.length; i++) {
      r -= w[idx[i]];
      if (r <= 0) { chosen = i; break; }
    }
    order.push(idx[chosen]);
    idx.splice(chosen, 1);
  }
  return order;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
