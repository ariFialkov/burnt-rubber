// Trackside structures: tiered grandstands with a cheering crowd, and the
// start/finish gantry with an LED screen.
//
// A grandstand is one stepped concrete tier (an extruded profile), seat
// strips, an advertising board along the front, a back wall, and a roof on
// columns. The crowd is one InstancedMesh per stand: a low-poly figure per
// seat, coloured per instance, animated entirely in the vertex shader (a
// per-instance phase drives a bounce and an arm sway), so a thousand
// spectators cost one draw call and no CPU work per frame.
//
// The gantry's screen is a dot-matrix canvas texture: the text is drawn
// small, read back, and lit as LED dots, with a chasing border. The scene
// sets its text (START, LAP 2/3, FINISH) and ticks it a few times a second.

import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

const SHIRTS = [0xe63946, 0xf4a261, 0xffd166, 0x06d6a0, 0x118ab2, 0x8338ec, 0xff006e, 0xffffff, 0x222831, 0x2a9d8f, 0xf1faee, 0xff7b00];

// Shared clock for every crowd in the scene.
const crowdUniforms = { uTime: { value: 0 } };

function paint(geo, color, fn = null) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(color), cc = new THREE.Color(), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    cc.copy(c); if (fn) fn(p, cc);
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return geo;
}
const merge = (parts) => { const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false); g.computeVertexNormals(); return g; };

// --- the spectator ------------------------------------------------------------
// Built once: torso (takes the instance colour), legs, head and raised arms.
// aShirt marks the torso, aArm the arms (1 = left, -1 = right).
let figureGeo = null;
function figure() {
  if (figureGeo) return figureGeo;
  const tag = (geo, shirt, arm) => {
    const n = geo.attributes.position.count;
    geo.setAttribute('aShirt', new THREE.BufferAttribute(new Float32Array(n).fill(shirt), 1));
    geo.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(n).fill(arm), 1));
    return geo;
  };
  const parts = [];
  parts.push(tag(paint(new THREE.BoxGeometry(0.3, 0.72, 0.2).translate(0, 0.36, 0), 0x2b3140), 0, 0));          // legs
  parts.push(tag(paint(new THREE.BoxGeometry(0.4, 0.56, 0.24).translate(0, 1.0, 0), 0xffffff), 1, 0));          // torso
  parts.push(tag(paint(new THREE.SphereGeometry(0.14, 6, 5).translate(0, 1.44, 0), 0xd9a882), 0, 0));            // head
  parts.push(tag(paint(new THREE.BoxGeometry(0.09, 0.5, 0.09).translate(0.3, 1.5, 0), 0xd9a882), 0, 1));          // left arm, up
  parts.push(tag(paint(new THREE.BoxGeometry(0.09, 0.5, 0.09).translate(-0.3, 1.5, 0), 0xd9a882), 0, -1));        // right arm, up
  figureGeo = merge(parts);
  return figureGeo;
}

let crowdMat = null;
function crowdMaterial() {
  if (crowdMat) return crowdMat;
  crowdMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  crowdMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = crowdUniforms.uTime;
    shader.vertexShader = `attribute float aPhase; attribute float aBounce; attribute float aArm; attribute float aShirt; uniform float uTime;\n` + shader.vertexShader
      .replace('#include <color_vertex>', `
        vColor = color;
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = mix(vColor.rgb, instanceColor.rgb, aShirt);
        #endif`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float w = sin(uTime * 5.2 + aPhase);
        transformed.y += 0.17 * max(0.0, w) * aBounce;
        float sway = sin(uTime * 3.4 + aPhase * 1.7) * aArm;
        transformed.x += 0.16 * sway * step(1.2, position.y);
        transformed.y += 0.04 * abs(sway) * step(1.2, position.y);`);
  };
  crowdMat.customProgramCacheKey = () => 'crowd-v1';
  return crowdMat;
}

// --- the grandstand -------------------------------------------------------------
// Local frame: x along the stand, z away from the track, y up. Front row at z=0.
export function buildGrandstand(len, accent, rand) {
  const ROWS = 9, RISE = 0.42, TREAD = 0.85;
  const g = new THREE.Group();
  const parts = [];
  // stepped tier: a profile in (z, y), extruded along x
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let r = 0; r < ROWS; r++) { shape.lineTo(r * TREAD, (r + 1) * RISE); shape.lineTo((r + 1) * TREAD, (r + 1) * RISE); }
  shape.lineTo(ROWS * TREAD, 0); shape.lineTo(0, 0);
  const tier = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  tier.rotateY(-Math.PI / 2).translate(len / 2, 0, 0); // extrusion along x, profile x -> z
  parts.push(paint(tier, 0x8e9096, (p, c) => { if (Math.abs(((p.x + len / 2 + 6) % 12) - 6) < 0.5) c.multiplyScalar(0.8); }));
  // seat strips per row
  for (let r = 0; r < ROWS; r++) {
    const y = (r + 1) * RISE, z = r * TREAD + TREAD * 0.55;
    parts.push(paint(new THREE.BoxGeometry(len - 0.6, 0.06, 0.4).translate(0, y + 0.42, z), accent, (p, c) => c.multiplyScalar(0.85)));
    parts.push(paint(new THREE.BoxGeometry(len - 0.6, 0.36, 0.06).translate(0, y + 0.6, z + 0.2), accent));
  }
  // advertising boards along the front, back wall, roof on columns
  parts.push(paint(new THREE.BoxGeometry(len + 0.4, 1.1, 0.12).translate(0, 0.55, -0.4), accent, (p, c) => { if (Math.abs(p.y - 0.55) < 0.35 && Math.abs(((p.x + len / 2) % 8) - 4) < 3) c.set(0xf4f4f4); }));
  const backZ = ROWS * TREAD, topY = ROWS * RISE;
  parts.push(paint(new THREE.BoxGeometry(len + 0.4, topY + 3.2, 0.35).translate(0, (topY + 3.2) / 2, backZ + 0.17), 0x6d7078));
  const roofY = topY + 6.5;
  parts.push(paint(new THREE.BoxGeometry(len + 2, 0.3, backZ + 3.5).translate(0, roofY, backZ / 2 - 0.6), 0xd8dce4, (p, c) => { if (p.y < roofY) c.multiplyScalar(0.7); }));
  parts.push(paint(new THREE.BoxGeometry(len + 2, 0.5, 0.25).translate(0, roofY - 0.35, -2.2), 0x4c5058));
  for (let x = -len / 2 + 1; x <= len / 2; x += 10) {
    parts.push(paint(new THREE.CylinderGeometry(0.22, 0.26, roofY, 7).translate(x, roofY / 2, backZ + 0.6), 0x4c5058));
    parts.push(paint(new THREE.BoxGeometry(0.3, 0.3, backZ + 3).translate(x, roofY - 0.3, backZ / 2 - 0.6), 0x4c5058));
  }
  // side walls closing the tier
  const sideShape = new THREE.Shape();
  sideShape.moveTo(0, 0); sideShape.lineTo(0, topY + 3.2); sideShape.lineTo(backZ, topY + 3.2); sideShape.lineTo(backZ, 0); sideShape.lineTo(0, 0);
  for (const s of [-1, 1]) {
    const wall = new THREE.ExtrudeGeometry(sideShape, { depth: 0.3, bevelEnabled: false });
    wall.rotateY(-Math.PI / 2).translate(s * len / 2 + (s > 0 ? 0 : 0.3), 0, 0);
    parts.push(paint(wall, 0x7a7d85));
  }
  const structure = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(structure);

  // the crowd
  const spots = [];
  for (let r = 0; r < ROWS; r++) {
    const y = (r + 1) * RISE, z = r * TREAD + TREAD * 0.5;
    for (let x = -len / 2 + 0.6; x < len / 2 - 0.4; x += 0.66) {
      if (rand() < 0.18) continue;
      spots.push({ x: x + (rand() - 0.5) * 0.12, y, z: z + (rand() - 0.5) * 0.1 });
    }
  }
  const crowd = new THREE.InstancedMesh(figure(), crowdMaterial(), Math.max(1, spots.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const phase = new Float32Array(spots.length), bounce = new Float32Array(spots.length);
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + (rand() - 0.5) * 0.5); // facing the track (-z)
    const sc = 0.9 + rand() * 0.2;
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(sc, sc, sc));
    crowd.setMatrixAt(i, m);
    crowd.setColorAt(i, col.set(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
    phase[i] = rand() * Math.PI * 2;
    bounce[i] = rand() < 0.55 ? 0.4 + rand() * 0.6 : 0.08;
  });
  crowd.geometry = figure().clone();
  crowd.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  crowd.geometry.setAttribute('aBounce', new THREE.InstancedBufferAttribute(bounce, 1));
  crowd.count = spots.length;
  crowd.frustumCulled = false;
  g.add(crowd);
  return g;
}

// Advance every crowd's clock.
export function tickCrowds(t) { crowdUniforms.uTime.value = t; }

// --- the LED gantry -------------------------------------------------------------
const W = 512, H = 64, DOT = 4;
function makeScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const small = document.createElement('canvas');
  small.width = W / DOT; small.height = H / DOT;
  const sg = small.getContext('2d', { willReadFrequently: true });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const state = { text: '', color: '#ffb703', lit: null, frame: -1 };
  const rasterise = () => {
    sg.clearRect(0, 0, small.width, small.height);
    sg.fillStyle = '#fff'; sg.font = 'bold 13px sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle';
    sg.fillText(state.text, small.width / 2, small.height / 2 + 1);
    state.lit = sg.getImageData(0, 0, small.width, small.height).data;
  };
  const draw = (frame) => {
    g.fillStyle = '#0a0b0e'; g.fillRect(0, 0, W, H);
    const cols = small.width, rows = small.height;
    // dim unlit dots
    g.fillStyle = '#16181d';
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) g.fillRect(x * DOT + 1, y * DOT + 1, 2, 2);
    // the text
    g.fillStyle = state.color;
    const lit = state.lit;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (lit[(y * cols + x) * 4 + 3] > 110) { g.beginPath(); g.arc(x * DOT + 2, y * DOT + 2, 1.7, 0, Math.PI * 2); g.fill(); }
    }
    // chasing border
    for (let x = 0; x < cols; x++) for (const y of [0, rows - 1]) {
      const on = ((x + frame + (y === 0 ? 0 : 2)) % 4) === 0;
      g.fillStyle = on ? state.color : '#2a2d35';
      g.beginPath(); g.arc(x * DOT + 2, y * DOT + 2, 1.7, 0, Math.PI * 2); g.fill();
    }
    tex.needsUpdate = true;
  };
  const screen = {
    texture: tex,
    set(text, color) {
      if (text === state.text && (!color || color === state.color)) return;
      state.text = text; if (color) state.color = color;
      rasterise(); draw(state.frame < 0 ? 0 : state.frame);
    },
    tick(t) {
      const frame = Math.floor(t * 8);
      if (frame === state.frame || !state.lit) return;
      state.frame = frame; draw(frame);
    },
  };
  screen.set('START', '#2ee6a8');
  return screen;
}

// The gantry over the line: posts, a beam, and the LED screen facing the
// cars as they come. `frame` has p (on the road), tangent and normal.
export function buildGantry(frame, width, accent) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x22252c });
  const post = new THREE.BoxGeometry(0.8, 9, 0.8);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(post, mat);
    m.position.copy(frame.p).addScaledVector(frame.normal, side * (width / 2 + 2));
    m.position.y += 4.5;
    g.add(m);
  }
  const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), frame.normal);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 5, 2.0, 1.0), new THREE.MeshLambertMaterial({ color: 0x2c3038 }));
  beam.position.copy(frame.p).y += 8.4;
  beam.quaternion.copy(rot);
  g.add(beam);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 5.2, 0.25, 1.1), new THREE.MeshLambertMaterial({ color: accent }));
  trim.position.copy(frame.p).y += 9.5;
  trim.quaternion.copy(rot);
  g.add(trim);
  const screen = makeScreen();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width + 4.2, 1.6), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
  // the plane faces +z by default; turn it to face the oncoming cars (-tangent)
  panel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.tangent.clone().negate());
  panel.position.copy(frame.p).addScaledVector(frame.tangent, -0.52).y += 8.4;
  g.add(panel);
  return { group: g, screen };
}
