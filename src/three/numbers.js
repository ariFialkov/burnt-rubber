// Racing numbers on the bodywork.
//
// The livery atlases have numbers baked in. Each vehicle lists where they
// are (atlas pixel rectangles, 1024 space, y down) and how the baked glyph
// is oriented there. Per car, a small overlay texture is drawn — one tile
// per rectangle, a plate with the driver's real number in the same
// orientation — and the livery shader paints those tiles over the atlas, so
// every number on a car is that driver's, at a fraction of the cost of a
// per-car atlas (a 128 px tile per plate instead of a megabyte of texture).
//
// The formula car has no baked number, so it carries decals instead: small
// planes seated on the nose and the sidepods by raycast.

import * as THREE from 'three';

const TILE = 128, TILES = 4;

// rect: [x0, y0, x1, y1] atlas pixels (1024, y down). rot: degrees the
// upright glyph is turned clockwise on the atlas; mirror: flipped left to
// right before turning. plate: 'light' (white plate, dark digits) or
// 'dark' (black plate, white digits). size: digit height as a fraction of
// the rect's shorter side.
export const NUMBER_RECTS = {
  rally: [
    { rect: [440, 796, 506, 876], rot: 270, mirror: false, plate: 'light', size: 0.62 },   // right door
    { rect: [524, 796, 590, 876], rot: 90, mirror: false, plate: 'light', size: 0.62 },    // left door
  ],
  stock: [
    { rect: [538, 690, 614, 804], rot: 90, mirror: false, plate: 'light', size: 0.62, outline: true },   // left door
    { rect: [722, 690, 798, 804], rot: 270, mirror: false, plate: 'light', size: 0.62, outline: true },  // right door
    { rect: [70, 732, 176, 840], rot: 180, mirror: false, plate: 'accent', size: 0.66, outline: true },   // roof
  ],
  moto: [
    { rect: [598, 412, 648, 474], rot: 180, mirror: false, plate: 'dark', size: 0.62 },   // tail (under the seat, barely seen)
    { rect: [626, 712, 672, 778], rot: 270, mirror: false, plate: 'light', size: 0.6 },  // front plate
  ],
  baja: [
    { rect: [508, 156, 570, 208], rot: 180, mirror: false, plate: 'light', size: 0.7 },  // right door
  ],
};

// The pit crew's shirt number is a badge decal on the chest (their atlases
// split the chest across islands, so no rectangle covers the baked
// number): a plate in the polo's own black with the driver's digits.
export function crewBadge(number, w = 256, h = 176) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#131518'; g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.06)'); grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const text = String(number ?? '');
  const size = Math.min(h * 0.78, (w * 0.92) / Math.max(1, text.length * 0.66));
  g.font = `900 italic ${size}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f2f2f2'; g.fillText(text, w / 2, h / 2 + size * 0.05);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const px = (n) => n / 1024;
// Rect as a UV vec4 (u0, v0, u1, v1); the atlas is flipped, so v = 1 - y/1024.
export function rectUV(r) { return new THREE.Vector4(px(r[0]), 1 - px(r[3]), px(r[2]), 1 - px(r[1])); }

const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };

// Colours for a plate given the team palette [primary, secondary, base].
function plateColors(style, colors, spec) {
  const [primary, , base] = colors;
  if (style === 'atlas') return { plate: spec.plateHex, ink: spec.inkHex || '#f4f4f4', edge: null }; // the atlas's own paint, recoloured with it
  if (style === 'dark') return { plate: '#101214', ink: '#f4f4f4', edge: null };
  if (style === 'accent') return { plate: primary, ink: lum(primary) > 0.5 ? '#111' : '#fff', edge: null };
  // light: the base colour when it is light, else white — always dark digits
  const plate = base && lum(base) > 0.6 ? base : '#f4f4f4';
  return { plate, ink: '#14161a', edge: primary };
}

// Draw one plate tile: fill, then the number turned to match the baked glyph.
function drawTile(g, x, y, w, h, spec, number, colors) {
  const { plate, ink, edge } = plateColors(spec.plate, colors, spec);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = plate; g.fillRect(x, y, w, h);
  // faint panel shading so the plate doesn't read as a sticker
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  // Work in atlas pixels: the tile is square but stands for a rect the
  // shader stretches it back to, so pre-squash by the same ratio; then turn
  // and mirror the upright glyph the way the baked one sits on the atlas.
  const rw = spec.rect[2] - spec.rect[0], rh = spec.rect[3] - spec.rect[1];
  g.translate(x + w / 2, y + h / 2);
  g.scale(w / rw, h / rh);
  g.rotate((spec.rot * Math.PI) / 180);
  if (spec.mirror) g.scale(-1, 1);
  const turned = spec.rot % 180 !== 0;
  const availW = turned ? rh : rw, availH = turned ? rw : rh;
  const text = String(number);
  const size = Math.min(availH * spec.size, availW / (text.length * 0.66));
  g.font = `900 ${size}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (spec.outline && edge) { g.lineWidth = size * 0.14; g.lineJoin = 'round'; g.strokeStyle = edge; g.strokeText(text, 0, size * 0.06); }
  g.fillStyle = ink; g.fillText(text, 0, size * 0.06);
  g.restore();
}

// The per-car overlay: tiles stacked so tile k occupies v in [k/4, (k+1)/4].
export function numberOverlay(vehicle, number, colors) {
  const specs = NUMBER_RECTS[vehicle];
  if (!specs || !specs.length) return null;
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE * TILES;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  specs.forEach((spec, k) => drawTile(g, 0, (TILES - 1 - k) * TILE, TILE, TILE, spec, number, colors));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const rects = [0, 1, 2, 3].map((k) => (specs[k] ? rectUV(specs[k].rect) : new THREE.Vector4(-1, -1, -1, -1)));
  return { texture: tex, rects, count: specs.length, pre: specs.some((q) => q.plate === 'atlas') };
}

// A decal texture: transparent, the number in the palette's contrast ink.
export function numberDecal(number, colors) {
  const [primary] = colors;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  const text = String(number);
  const size = text.length > 2 ? 78 : 96;
  g.font = `900 ${size}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const ink = lum(primary) > 0.55 ? '#111318' : '#f6f6f6';
  g.lineWidth = 10; g.lineJoin = 'round'; g.strokeStyle = ink === '#f6f6f6' ? '#111318' : '#f6f6f6';
  g.strokeText(text, 64, 70); g.fillStyle = ink; g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Debug: the atlas with the overlay tiles composited at their rects.
export function compositeDebug(image, vehicle, number, colors) {
  const specs = NUMBER_RECTS[vehicle] || [];
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, 1024, 1024);
  specs.forEach((spec) => {
    const [x0, y0, x1, y1] = spec.rect;
    drawTile(g, x0, y0, x1 - x0, y1 - y0, spec, number, colors);
  });
  return c;
}
