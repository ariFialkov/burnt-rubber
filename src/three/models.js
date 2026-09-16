// Vehicle models. Each tour's car ships as a GLB produced by
// tools/convert-models.mjs from the FBX sources: nose to +Z, floor at y=0,
// centred, real-world scale, split into role parts — `primary` and
// `secondary` bodywork that take the team livery, `glass`, `dark` trim, and
// `wheel_N` nodes pivoted at their axles so they can spin.
//
// Templates are loaded once; every car on track shares the geometry and only
// the two livery materials are per car.

import * as THREE from 'three';
import { numberOverlay, numberDecal } from './numbers.js';
import { cockpitFor } from './cockpit.js';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';

export const MODEL_FILES = {
  formula: 'assets/models/formula.glb',
  stock: 'assets/models/stock.glb',
  rally: 'assets/models/rally.glb',
  baja: 'assets/models/baja.glb',
  moto: 'assets/models/moto.glb',
  rider: 'assets/models/rider.glb', // seated on every bike
  driver: 'assets/models/driver.glb', // the same figure, seated in every car
};

const templates = new Map(); // vehicle -> { meta, parts: {role: geometry}, wheels: [{geometry, position, radius}] }
const liveries = new Map();  // vehicle -> { texture, accents: [hue, hue] }
let envMap = null;

// Livery atlases. One painted template per vehicle (base colour, normal,
// and roughness/metalness packed G/B); each team gets its own palette by
// remapping the template's accent hues in the shader, so the painted shapes,
// numbers and shading stay and only the colours change.
export const LIVERY_DIR = 'assets/liveries/';
export const LIVERY_VEHICLES = ['formula', 'stock', 'rally', 'baja', 'moto', 'rider'];

// Shared, look-alike materials: one each for the whole field.
const SHARED = {
  glass: new THREE.MeshStandardMaterial({ color: 0x0e141c, metalness: 0.7, roughness: 0.12 }),
  // Glazing you can see through: a dark tint on the cars (the driver shows
  // through it), a barely-there screen on the bikes.
  tint: new THREE.MeshStandardMaterial({ color: 0x33475c, metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  screen: new THREE.MeshStandardMaterial({ color: 0xc4d9ec, metalness: 0.5, roughness: 0.08, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
  interior: new THREE.MeshStandardMaterial({ color: 0x0f1115, metalness: 0.1, roughness: 0.95 }),
  suit: new THREE.MeshStandardMaterial({ color: 0x1c1e24, metalness: 0.05, roughness: 0.85 }),
  // Tail lights: a domed lens, dark when off and blazing when lit (swapped
  // per car, so every car shares these), plus an additive glow behind it.
  lampOff: new THREE.MeshStandardMaterial({ color: 0x2a0508, emissive: 0x3a0a0e, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.1 }),
  lampOn: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1a1a, emissiveIntensity: 2.5, roughness: 0.3, metalness: 0.1, toneMapped: false }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23262c, metalness: 0.25, roughness: 0.65 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x141618, metalness: 0.05, roughness: 0.9 }),
};

export const LAMP = { on: SHARED.lampOn, off: SHARED.lampOff };

// Radial glow for a lit lamp, drawn once.
let glowMat = null;
function lampGlow() {
  if (!glowMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,120,110,1)');
    grad.addColorStop(0.35, 'rgba(255,40,40,0.55)');
    grad.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    glowMat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false });
  }
  return glowMat;
}

// Reflections for the paint. Set once from the renderer (PMREM of a room).
export function setCarEnvironment(tex) {
  envMap = tex;
  for (const m of Object.values(SHARED)) { m.envMap = tex; m.needsUpdate = true; }
}

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function ingest(vehicle, gltf) {
  const parts = {};
  const pivots = {}; // parts built around a hinge (the bike's stand, the driver's joints) sit at it
  const parents = {}; // a part nested under another (a forearm on its upper arm)
  const wheels = [];
  let meta = null;
  gltf.scene.traverse((o) => {
    if (o.userData && o.userData.vehicle) meta = o.userData;
    if (!o.isMesh) return;
    if (/^wheel_\d+$/.test(o.name)) {
      wheels.push({ geometry: o.geometry, position: o.position.clone(), radius: meta?.wheelRadius || 0.4 });
    } else {
      parts[o.name] = o.geometry;
      if (o.position.lengthSq() > 0) pivots[o.name] = o.position.clone();
      if (o.parent && o.parent.isMesh) parents[o.name] = o.parent.name;
    }
  });
  if (!meta) throw new Error(`model ${vehicle}: metadata missing`);
  for (const w of wheels) w.radius = meta.wheelRadius || w.radius;
  templates.set(vehicle, { meta, parts, pivots, parents, wheels });
}

// Load every vehicle. `inline` (vehicle -> base64 GLB) is used by the
// single-file bundle, which cannot fetch anything.
export async function loadCarModels(inline = globalThis.__BR_MODELS__) {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(MODEL_FILES).map(async ([vehicle, url]) => {
    const gltf = inline && inline[vehicle]
      ? await loader.parseAsync(b64ToBuffer(inline[vehicle]), '')
      : await loader.loadAsync(url);
    ingest(vehicle, gltf);
  }));
}

export const hasModel = (vehicle) => templates.has(vehicle);
export const hasLivery = (vehicle) => liveries.has(vehicle) && !!templates.get(vehicle)?.meta.hasUV;

// The two most common saturated hues *on the car's surface* are its accent
// colours — what a team's primary and secondary replace. Weighting by
// surface area matters: an atlas can spend more texels on a colour that
// covers little of the actual body (the truck's blue vs its orange), so the
// histogram samples each triangle at its UV centroid, weighted by 3D area.
// Without geometry it falls back to a plain texel histogram.
function accentHues(image, geometries) {
  const c = document.createElement('canvas');
  const w = c.width = 256, h = c.height = 256;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const bins = new Float32Array(36);
  const tally = (i, weight) => {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    if (sat < 0.35 || mx < 0.15) return; // neutrals never count
    let hue;
    if (mx === r) hue = ((gg - b) / (mx - mn) + 6) % 6;
    else if (mx === gg) hue = (b - r) / (mx - mn) + 2;
    else hue = (r - gg) / (mx - mn) + 4;
    bins[Math.floor(hue * 6) % 36] += sat * weight;
  };
  const withUV = geometries?.filter((geo) => geo.attributes.uv);
  if (withUV?.length) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
    for (const geo of withUV) {
      const pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); cc.fromBufferAttribute(pos, i2);
        const nrm = b.sub(a).cross(cc.sub(a));
        const area = nrm.length() * 0.5;
        // Undersides and chassis are never what a livery reads as — a face
        // pointing at the road doesn't vote.
        if (area > 0 && nrm.y / (area * 2) < -0.35) continue;
        const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
        const v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
        // texture flipY: v=0 is the bottom row of the image
        const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
        const py = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
        tally((py * w + px) * 4, area);
      }
    }
  } else {
    for (let i = 0; i < d.length; i += 4) tally(i, 1);
  }
  const order = [...bins.keys()].sort((a, b) => bins[b] - bins[a]);
  const first = order[0];
  // second accent must be a genuinely different hue (> 60° away)
  const second = order.find((k) => Math.min(Math.abs(k - first), 36 - Math.abs(k - first)) > 6);
  const toHue = (k) => (k + 0.5) / 36;
  const strong = second !== undefined && bins[second] >= bins[first] * 0.12;
  return [toHue(first), strong ? toHue(second) : -1];
}

// Loads whatever assets/liveries/index.json lists (kept in sync by
// `npm run models`), so a vehicle without an atlas costs no request at all.
// `inline` (vehicle -> {base, normal, rm} data URLs) serves the single-file
// bundle, which cannot fetch.
export async function loadLiveries(inline = globalThis.__BR_LIVERIES__) {
  const loader = new THREE.TextureLoader();
  let available;
  if (inline) available = Object.keys(inline);
  else {
    try { available = await (await fetch(LIVERY_DIR + 'index.json')).json(); } catch { available = []; }
  }
  const load = async (url, srgb) => {
    if (!url) return null;
    const t = await loader.loadAsync(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    // The models' UVs came straight through from FBX (origin bottom-left),
    // which is three's own convention: leave flipY on.
    t.flipY = true;
    t.anisotropy = 4;
    return t;
  };
  await Promise.all(available.filter((v) => LIVERY_VEHICLES.includes(v)).map(async (vehicle) => {
    const src = inline?.[vehicle] || { base: `${LIVERY_DIR}${vehicle}.jpg`, normal: `${LIVERY_DIR}${vehicle}_normal.jpg`, rm: `${LIVERY_DIR}${vehicle}_rm.jpg` };
    try {
      const base = await load(src.base, true);
      const [normal, rm] = await Promise.all([load(src.normal, false).catch(() => null), load(src.rm, false).catch(() => null)]);
      liveries.set(vehicle, { base, normal, rm, accents: null });
    } catch { /* no livery for this vehicle */ }
  }));
}

// Compute (or recompute) a vehicle's accent hues against its real surface.
// Called once models and liveries are both in; the geometries default to the
// loaded template's body parts.
export function refreshAccents(vehicle, geometries) {
  const l = liveries.get(vehicle);
  if (!l) return null;
  const t = templates.get(vehicle);
  const geos = geometries || (t ? Object.values(t.parts) : null);
  l.accents = accentHues(l.base.image, geos);
  return l.accents;
}

// Paint material driven by the atlas: pixels near an accent hue are recoloured
// to the team colour while keeping the atlas's own shading; everything else
// (whites, blacks, greys, decals) is left as painted.
const RECOLOR = `
  vec3 br_rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-5)), d / (q.x + 1e-5), q.x);
  }
  float br_hueDist(float a, float b) { float d = abs(a - b); return min(d, 1.0 - d); }
  vec3 br_recolor(vec3 c, float hue, vec3 team) {
    if (hue < 0.0) return c;
    vec3 hsv = br_rgb2hsv(c);
    float w = (1.0 - smoothstep(0.05, 0.11, br_hueDist(hsv.x, hue))) * smoothstep(0.25, 0.45, hsv.y);
    // Keep the atlas's baked shading: the team colour scaled by how bright
    // this pixel is relative to the accent at full strength.
    vec3 shaded = team * clamp(hsv.z * 1.15, 0.0, 1.0);
    return mix(c, shaded, w);
  }
  // The light neutrals — the atlas's white bodywork — take the base colour,
  // keeping the baked shading and a touch of highlight so a dark base still
  // reads its panel lines.
  vec3 br_rebase(vec3 c, vec3 base, float on) {
    if (on < 0.5) return c;
    vec3 hsv = br_rgb2hsv(c);
    float w = (1.0 - smoothstep(0.10, 0.22, hsv.y)) * smoothstep(0.50, 0.72, hsv.z);
    vec3 shaded = base * clamp(hsv.z * 1.05, 0.0, 1.0) + vec3(0.10) * max(0.0, hsv.z - 0.86) * 6.0;
    return mix(c, shaded, w);
  }
`;

export function liveryMaterial(vehicle, colors, number = null) {
  const l = liveries.get(vehicle);
  if (!l) return null;
  if (!l.accents) refreshAccents(vehicle);
  const overlay = number != null ? numberOverlay(vehicle, number, colors) : null;
  const m = new THREE.MeshStandardMaterial({
    map: l.base,
    normalMap: l.normal || null, normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: l.rm || null, metalnessMap: l.rm || null,
    roughness: l.rm ? 1 : 0.4, metalness: l.rm ? 1 : 0.25,
    envMap,
  });
  const u = {
    uPrimHue: { value: l.accents[0] }, uSecHue: { value: l.accents[1] },
    uPrim: { value: new THREE.Color(colors[0]) }, uSec: { value: new THREE.Color(colors[1]) },
    // the base bodywork (what the atlas paints white) takes the palette's third colour
    uBase: { value: new THREE.Color(colors[2] || '#ffffff') }, uBaseOn: { value: colors[2] ? 1 : 0 },
    uNumMap: { value: overlay ? overlay.texture : null },
    uRects: { value: overlay ? overlay.rects : [0, 1, 2, 3].map(() => new THREE.Vector4(-1, -1, -1, -1)) },
    uRectN: { value: overlay ? overlay.count : 0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uPrimHue, uSecHue, uBaseOn, uRectN; uniform vec3 uPrim, uSec, uBase; uniform sampler2D uNumMap; uniform vec4 uRects[4];${RECOLOR}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float br_atlasV = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        diffuseColor.rgb = br_recolor(diffuseColor.rgb, uPrimHue, uPrim);
        diffuseColor.rgb = br_recolor(diffuseColor.rgb, uSecHue, uSec);
        diffuseColor.rgb = br_rebase(diffuseColor.rgb, uBase, uBaseOn);
        for (int k = 0; k < 4; k++) {
          if (float(k) >= uRectN) break;
          vec4 rc = uRects[k];
          if (vMapUv.x >= rc.x && vMapUv.x <= rc.z && vMapUv.y >= rc.y && vMapUv.y <= rc.w) {
            vec2 l = (vMapUv - rc.xy) / (rc.zw - rc.xy);
            vec4 n = texture2D(uNumMap, vec2(l.x, (float(k) + l.y) / 4.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, n.rgb, n.a); // a clean plate: the baked digits must not ghost through
          }
        }`);
  };
  m.customProgramCacheKey = () => 'br-livery-v2'; // one program for the whole field
  return m;
}

// Onboard eye as fractions of (height, length from centre, +Z forward). The
// open cockpit sits ahead of the airbox and the rider above the tank; the
// closed cars use a roof-mounted camera, as real broadcasts do — from inside
// a single-shell body the view is nothing but clipped panels.
const EYE = { formula: [0.72, 0.14], stock: [1.08, 0.0], rally: [1.08, 0.0], baja: [1.06, 0.05], moto: [0.9, -0.05] };
export function eyeFor(vehicle, height, length) {
  const [hy, lz] = EYE[vehicle] || [0.75, 0.05];
  return { y: height * hy, z: length * lz };
}
export const modelMeta = (vehicle) => templates.get(vehicle)?.meta || null;

// Soft contact shadow under the car: a radial-gradient sprite on the ground.
let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export function shadowBlob(width, length) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.25, length * 1.1),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.09; // just above the road ribbon (y = 0.05), never under it
  m.renderOrder = -1;
  return m;
}

// Where the rider's hips sit on the bike, as fractions of the bike's height
// and length (+Z forward), and the rider's standing height in metres.
export const RIDER_SEAT = { y: 0.58, z: -0.10, height: 1.72, lean: 0.0 };
// A figure from its template: the body, plus each arm as an upper arm
// pivoted at the shoulder carrying a forearm pivoted at the elbow, so the
// hands can be aimed at a wheel or grips. Joint fillers hide the bends.
const JOINT = new THREE.SphereGeometry(0.045, 10, 8);
function buildFigure(t, mat, name) {
  const root = new THREE.Group();
  root.name = name;
  const meshes = {};
  for (const [part, geometry] of Object.entries(t.parts)) {
    const m = new THREE.Mesh(geometry, mat);
    m.name = part;
    if (t.pivots[part]) m.position.copy(t.pivots[part]);
    meshes[part] = m;
  }
  for (const [part, m] of Object.entries(meshes)) (t.parents[part] ? meshes[t.parents[part]] : root).add(m);
  for (const side of ['l', 'r']) {
    const upper = meshes['arm_' + side], fore = meshes['fore_' + side];
    if (!upper || !fore) continue;
    upper.add(new THREE.Mesh(JOINT, SHARED.suit));
    const e = new THREE.Mesh(JOINT, SHARED.suit); e.position.copy(fore.position); upper.add(e);
  }
  root.userData.arms = t.meta.arms || null;
  return root;
}

// Seat the driver so the head lands on the driver camera's eye point.
export const DRIVER_HEIGHT = 1.72;
export function placeDriver(obj, C, meta) {
  const H = DRIVER_HEIGHT;
  const head = meta.head || [0, 0.42, 0.05];
  obj.scale.setScalar(H);
  obj.position.set(C.eye.x - head[0] * H, C.eye.y - head[1] * H, C.eye.z - head[2] * H);
  return obj;
}
export function placeRider(obj, motoMeta) {
  obj.scale.setScalar(RIDER_SEAT.height);
  obj.position.set(0, motoMeta.height * RIDER_SEAT.y, motoMeta.length * RIDER_SEAT.z);
  obj.rotation.x = RIDER_SEAT.lean;
  return obj;
}

// Fallback rider when the model isn't available: boxes leaning into the
// tank; suit takes the secondary colour, helmet the primary.
function rider(primary, secondary, meta) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: secondary, metalness: 0.1, roughness: 0.7, envMap });
  const lid = new THREE.MeshStandardMaterial({ color: primary, metalness: 0.4, roughness: 0.3, envMap });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.26), suit);
  torso.position.set(0, meta.height * 0.62, -0.05);
  torso.rotation.x = -0.75;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), lid);
  helmet.position.set(0, meta.height * 0.82, 0.26);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.14), suit);
  legL.position.set(-0.2, meta.height * 0.4, -0.02);
  legL.rotation.x = 0.9;
  const legR = legL.clone();
  legR.position.x = 0.2;
  g.add(torso, helmet, legL, legR);
  return g;
}

// Build a car from a loaded template. Returns null if the model isn't
// available so the caller can fall back to the procedural car.
export function buildModelCar(vehicle, colors, number = null) {
  const t = templates.get(vehicle);
  if (!t) return null;
  const [primary, secondary] = colors;
  const group = new THREE.Group();
  const livery = hasLivery(vehicle) ? liveryMaterial(vehicle, colors, number) : null;
  const paint = livery || new THREE.MeshStandardMaterial({ color: primary, metalness: 0.35, roughness: 0.32, envMap });
  const trim = livery || new THREE.MeshStandardMaterial({ color: secondary, metalness: 0.3, roughness: 0.4, envMap });
  const glazing = vehicle === 'moto' ? SHARED.screen : SHARED.tint;
  const mats = livery
    ? { primary: livery, secondary: livery, glass: glazing, dark: livery } // the atlas paints the bodywork
    : { primary: paint, secondary: trim, glass: glazing, dark: SHARED.dark };
  for (const [role, geometry] of Object.entries(t.parts)) {
    const m = new THREE.Mesh(geometry, mats[role] || SHARED.dark);
    m.name = role;
    if (t.pivots[role]) m.position.copy(t.pivots[role]);
    group.add(m);
  }
  const wheels = t.wheels.map((w) => {
    const m = new THREE.Mesh(w.geometry, livery || SHARED.wheel);
    m.position.copy(w.position);
    m.userData.radius = w.radius;
    group.add(m);
    return m;
  });
  if (vehicle === 'moto') {
    const rt = templates.get('rider');
    if (rt) {
      const mat = hasLivery('rider') ? liveryMaterial('rider', colors) : new THREE.MeshStandardMaterial({ color: secondary, metalness: 0.1, roughness: 0.7, envMap });
      const r = buildFigure(rt, mat, 'rider');
      group.add(placeRider(r, t.meta));
    } else {
      group.add(rider(primary, secondary, t.meta));
    }
  } else {
    // A driver in the seat, head at the driver camera's eye so the onboard
    // view looks out of the helmet with the arms on the wheel; behind the
    // tinted glass a dark interior mass so the cabin doesn't read hollow.
    const dt = templates.get('driver');
    const C = cockpitFor(vehicle);
    if (dt) {
      const mat = hasLivery('rider') ? liveryMaterial('rider', colors) : new THREE.MeshStandardMaterial({ color: secondary, metalness: 0.1, roughness: 0.7, envMap });
      const d = buildFigure(dt, mat, 'driver');
      placeDriver(d, C, dt.meta);
      group.add(d);
    }
    if (C.cabin) {
      const { halfW, floorY, backZ, frontZ } = C.cabin;
      const top = C.eye.y - 0.45;
      const block = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.8, top - floorY, frontZ - backZ - 0.1), SHARED.interior);
      block.name = 'interior';
      block.position.set(0, (top + floorY) / 2, (frontZ + backZ) / 2);
      group.add(block);
    }
  }
  // Tail lights, per class: brake lights on the rally car and truck (two
  // lenses at the rear corners), a single round rain light on the formula car
  // and the bike. The stock car has none.
  const L = t.meta.length / 2, Hh = t.meta.height, Wd = t.meta.width / 2;
  const lamps = [];
  // Each lamp is seated on the bodywork: a ray from behind the car finds the
  // rear surface at the lamp's (x, y), so the lens sits flush wherever that
  // panel actually is, not on the bounding box.
  group.updateMatrixWorld(true);
  const bodies = group.children.filter((o) => o.isMesh && ['primary', 'secondary', 'dark', 'glass'].includes(o.name));
  const ray = new THREE.Raycaster();
  const seat = (x, y, fallbackZ) => {
    ray.set(new THREE.Vector3(x, y, -L - 3), new THREE.Vector3(0, 0, 1));
    const h = ray.intersectObjects(bodies, false)[0];
    return h ? h.point.z : fallbackZ;
  };
  const lamp = (geometry, x, y, glowSize) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, seat(x, y, -L) + 0.004);
    const lens = new THREE.Mesh(geometry, SHARED.lampOff);
    lens.name = 'lamp';
    holder.add(lens);
    const glow = new THREE.Sprite(lampGlow());
    glow.scale.set(glowSize, glowSize, 1);
    glow.position.z = -0.03;
    glow.visible = false;
    holder.add(glow);
    group.add(holder);
    lamps.push({ lens, glow });
  };
  if (vehicle === 'rally' || vehicle === 'baja') {
    // A domed rectangular lens, its back face in the panel.
    const geo = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.rotateX(-Math.PI / 2); // dome toward -Z
    geo.scale(0.085, 0.04, 0.03);
    // Truck: on the tailgate panel; rally car: on the tail panel under the wing.
    const y = vehicle === 'baja' ? Hh * 0.6 : 0.78;
    lamp(geo, Wd * 0.62, y, 0.42);
    lamp(geo, -Wd * 0.62, y, 0.42);
  } else if (vehicle === 'formula' || vehicle === 'moto') {
    const r = vehicle === 'formula' ? 0.065 : 0.045;
    const geo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.rotateX(-Math.PI / 2);
    geo.scale(r, r, r * 0.55);
    // Formula: on the rear crash structure under the wing; bike: on the tail unit.
    lamp(geo, 0, vehicle === 'formula' ? 0.56 : Hh * 0.78, vehicle === 'formula' ? 0.36 : 0.26);
  }
  group.add(shadowBlob(t.meta.width, t.meta.length));
  // The formula car has no number painted into its atlas: decals seated on
  // the nose and both sidepods carry the driver's number instead.
  if (vehicle === 'formula' && number != null) {
    const tex = numberDecal(number, colors);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.15, roughness: 0.55, metalness: 0.1, envMap, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const decal = (origin, dir, size, upHint) => {
      ray.set(origin, dir);
      const h = ray.intersectObjects(bodies, false)[0];
      if (!h) return;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      const d = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      d.name = 'decal';
      d.position.copy(h.point).addScaledVector(n, 0.012);
      // face along the surface normal with the digits' top toward upHint
      const z = n, x = new THREE.Vector3().crossVectors(upHint, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
      d.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      group.add(d);
    };
    decal(new THREE.Vector3(0, Hh + 2, L * 0.62), new THREE.Vector3(0, -1, 0), 0.3, new THREE.Vector3(0, 0, -1));
    decal(new THREE.Vector3(Wd + 2, Hh * 0.5, -L * 0.02), new THREE.Vector3(-1, 0, 0), 0.34, new THREE.Vector3(0, 1, 0));
    decal(new THREE.Vector3(-Wd - 2, Hh * 0.5, -L * 0.02), new THREE.Vector3(1, 0, 0), 0.34, new THREE.Vector3(0, 1, 0));
  }

  return { group, wheels, lamps, meta: t.meta };
}
