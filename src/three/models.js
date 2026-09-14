// Vehicle models. Each tour's car ships as a GLB produced by
// tools/convert-models.mjs from the FBX sources: nose to +Z, floor at y=0,
// centred, real-world scale, split into role parts — `primary` and
// `secondary` bodywork that take the team livery, `glass`, `dark` trim, and
// `wheel_N` nodes pivoted at their axles so they can spin.
//
// Templates are loaded once; every car on track shares the geometry and only
// the two livery materials are per car.

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';

export const MODEL_FILES = {
  formula: 'assets/models/formula.glb',
  stock: 'assets/models/stock.glb',
  rally: 'assets/models/rally.glb',
  baja: 'assets/models/baja.glb',
  moto: 'assets/models/moto.glb',
  rider: 'assets/models/rider.glb', // seated on every bike
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
  dark: new THREE.MeshStandardMaterial({ color: 0x23262c, metalness: 0.25, roughness: 0.65 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x141618, metalness: 0.05, roughness: 0.9 }),
};

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
  const wheels = [];
  let meta = null;
  gltf.scene.traverse((o) => {
    if (o.userData && o.userData.vehicle) meta = o.userData;
    if (!o.isMesh) return;
    if (/^wheel_\d+$/.test(o.name)) {
      wheels.push({ geometry: o.geometry, position: o.position.clone(), radius: meta?.wheelRadius || 0.4 });
    } else {
      parts[o.name] = o.geometry;
    }
  });
  if (!meta) throw new Error(`model ${vehicle}: metadata missing`);
  for (const w of wheels) w.radius = meta.wheelRadius || w.radius;
  templates.set(vehicle, { meta, parts, wheels });
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
`;

export function liveryMaterial(vehicle, colors) {
  const l = liveries.get(vehicle);
  if (!l) return null;
  if (!l.accents) refreshAccents(vehicle);
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
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uPrimHue, uSecHue; uniform vec3 uPrim, uSec;${RECOLOR}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = br_recolor(diffuseColor.rgb, uPrimHue, uPrim);
        diffuseColor.rgb = br_recolor(diffuseColor.rgb, uSecHue, uSec);`);
  };
  m.customProgramCacheKey = () => 'br-livery'; // one program for the whole field
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
export function buildModelCar(vehicle, colors) {
  const t = templates.get(vehicle);
  if (!t) return null;
  const [primary, secondary] = colors;
  const group = new THREE.Group();
  const livery = hasLivery(vehicle) ? liveryMaterial(vehicle, colors) : null;
  const paint = livery || new THREE.MeshStandardMaterial({ color: primary, metalness: 0.35, roughness: 0.32, envMap });
  const trim = livery || new THREE.MeshStandardMaterial({ color: secondary, metalness: 0.3, roughness: 0.4, envMap });
  const mats = livery
    ? { primary: livery, secondary: livery, glass: livery, dark: livery } // the atlas paints everything
    : { primary: paint, secondary: trim, glass: SHARED.glass, dark: SHARED.dark };
  for (const [role, geometry] of Object.entries(t.parts)) {
    const m = new THREE.Mesh(geometry, mats[role] || SHARED.dark);
    m.name = role;
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
      const r = new THREE.Mesh(rt.parts.body, mat);
      r.name = 'rider';
      group.add(placeRider(r, t.meta));
    } else {
      group.add(rider(primary, secondary, t.meta));
    }
  }
  group.add(shadowBlob(t.meta.width, t.meta.length));
  return { group, wheels, meta: t.meta };
}
