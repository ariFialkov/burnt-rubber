// Driver's-eye interiors. The car models are exteriors only — from inside,
// their back faces cull away and there is nothing to see — so each class gets
// a procedural cockpit kit: a cabin shell, dashboard, steering wheel, pillars
// and the class's own furniture (halo, roll cage). One kit per scene is built
// on demand and attached to whichever car the driver camera is riding, in
// that car's own frame (origin on the ground under the centre, +Z forward,
// +X the car's left).
//
// Every number here is in metres, measured against the models' part bounds
// (the windscreen glass gives the cabin's front; the roof its top).

import * as THREE from 'three';

// eye: where the driver camera sits. cabin: the shell. dash/wheel: the
// controls. Offsets in x put the driver on the left in the closed cars.
export const COCKPIT = {
  formula: {
    // The model already has its halo (underside at y 1.2–1.3) over a
    // cockpit opening around z 0 whose cowling ahead tops out near y 1.06,
    // so the eye sits between the two and only the wheel is added, down in
    // the opening.
    eye: { x: 0, y: 1.11, z: -0.10 }, look: { down: 0.08 },
    open: true,
    wheel: { x: 0, y: 0.93, z: 0.25, r: 0.12, tilt: 0.6, shape: 'formula' },
  },
  stock: {
    eye: { x: 0.34, y: 1.19, z: -0.28 }, look: { down: 0.06 },
    cabin: { halfW: 0.92, floorY: 0.42, roofY: 1.50, backZ: -0.95, frontZ: 0.25, screenTopZ: 0.22, screenBaseZ: 1.02, screenBaseY: 0.98 },
    dash: { y: 0.98, z: 0.62, depth: 0.5, h: 0.16, style: 'stock' },
    wheel: { x: 0.34, y: 0.98, z: 0.22, r: 0.19, tilt: 0.45 },
    cage: true,
  },
  rally: {
    eye: { x: 0.34, y: 1.28, z: -0.30 }, look: { down: 0.09 },
    cabin: { halfW: 0.88, floorY: 0.40, roofY: 1.58, backZ: -1.0, frontZ: 0.15, screenTopZ: 0.08, screenBaseZ: 0.62, screenBaseY: 0.98 },
    dash: { y: 0.97, z: 0.5, depth: 0.36, h: 0.16, style: 'rally' },
    wheel: { x: 0.34, y: 0.97, z: 0.18, r: 0.18, tilt: 0.42 },
    cage: true,
  },
  baja: {
    eye: { x: 0.34, y: 1.68, z: -0.30 }, look: { down: 0.14 },
    // The model's windscreen has a triangle wound inside-out that renders
    // opaque from within; clip the whole windscreen region away in this view.
    clip: { y0: 1.3, y1: 2.1, z0: 0.0, z1: 0.8 },
    cabin: { halfW: 0.98, floorY: 0.80, roofY: 1.98, backZ: -0.95, frontZ: 0.2, screenTopZ: 0.12, screenBaseZ: 0.6, screenBaseY: 1.38 },
    dash: { y: 1.34, z: 0.52, depth: 0.4, h: 0.18, style: 'baja' },
    wheel: { x: 0.34, y: 1.32, z: 0.18, r: 0.19, tilt: 0.35 },
    cage: true, cageBig: true,
  },
  moto: {
    eye: { x: 0, y: 1.30, z: 0.0 }, look: { down: 0.12 },
    open: true, bike: true,
  },
};

export function cockpitFor(vehicle) { return COCKPIT[vehicle] || COCKPIT.stock; }

const MAT = {
  shell: new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide }),
  trim: new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide }),
  tube: new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.5, metalness: 0.4 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.7, metalness: 0.1 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x8a1f2b, roughness: 0.85, metalness: 0.0 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }),
};

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// A tube between two points.
function bar(a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

// Dashboard face: dials and a display, drawn once per style.
function dashTexture(style) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#15171c'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#0d0e11'; g.fillRect(8, 8, 496, 112);
  const dial = (cx, cy, r, val, label) => {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#1d2027'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#4a5060'; g.stroke();
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); g.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
      g.strokeStyle = k >= 8 ? '#ff4d5e' : '#9aa3b5'; g.lineWidth = 2; g.stroke();
    }
    const a = Math.PI * 0.75 + val * Math.PI * 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    g.strokeStyle = '#ff8c1a'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#c9d0dc'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText(label, cx, cy + r * 0.55);
  };
  if (style === 'baja') {
    dial(70, 64, 42, 0.62, 'RPM'); dial(170, 64, 42, 0.48, 'MPH');
    g.fillStyle = '#0a1f16'; g.fillRect(230, 22, 200, 84); g.strokeStyle = '#2ee6a8'; g.lineWidth = 2; g.strokeRect(230, 22, 200, 84);
    g.strokeStyle = '#2ee6a8'; g.lineWidth = 2; g.beginPath(); g.moveTo(250, 90); g.lineTo(290, 60); g.lineTo(330, 70); g.lineTo(380, 34); g.lineTo(410, 50); g.stroke();
    g.fillStyle = '#2ee6a8'; g.font = 'bold 11px sans-serif'; g.textAlign = 'left'; g.fillText('GPS · STAGE 2', 238, 36);
    for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#ff4d5e' : '#ffd12a'; g.fillRect(446 + k * 14, 40, 9, 26); }
  } else {
    dial(90, 64, 48, style === 'rally' ? 0.7 : 0.82, 'RPM'); dial(200, 64, 40, 0.6, style === 'rally' ? 'KM/H' : 'MPH');
    dial(300, 64, 30, 0.55, 'OIL'); dial(370, 64, 30, 0.5, 'H2O');
    g.fillStyle = '#101b2c'; g.fillRect(414, 30, 88, 68); g.strokeStyle = '#38b6ff'; g.lineWidth = 2; g.strokeRect(414, 30, 88, 68);
    g.fillStyle = '#38b6ff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText(style === 'rally' ? '4' : 'P', 458, 74);
    g.font = 'bold 10px sans-serif'; g.fillText(style === 'rally' ? 'GEAR' : 'LAP', 458, 90);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Formula steering display: a small screen with a shift-light strip.
function wheelDisplayTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, 256, 128);
  const cols = ['#2ee6a8', '#2ee6a8', '#2ee6a8', '#ffd12a', '#ffd12a', '#ffd12a', '#ff4d5e', '#ff4d5e', '#38b6ff', '#38b6ff'];
  cols.forEach((col, k) => { g.fillStyle = k < 7 ? col : '#2a2d35'; g.beginPath(); g.arc(20 + k * 24, 18, 8, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = '#e8ecf4'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.fillText('7', 128, 88);
  g.font = 'bold 14px sans-serif'; g.fillStyle = '#8b94a7'; g.textAlign = 'left'; g.fillText('DIFF 6', 14, 110); g.textAlign = 'right'; g.fillText('BB 56.2', 242, 110);
  g.fillText('ERS', 242, 60); g.textAlign = 'left'; g.fillText('MODE 3', 14, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function steeringWheel(spec) {
  const g = new THREE.Group();
  const r = spec.r;
  if (spec.shape === 'formula') {
    // A squared-off wheel: two grips joined by a flat top and bottom, with
    // the display in the middle.
    const grip = (x) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, r * 1.1, 4, 8), MAT.grip); m.position.x = x; return m; };
    g.add(grip(-r * 1.15), grip(r * 1.15));
    g.add(box(r * 2.3, 0.05, 0.03, MAT.wheel, 0, r * 0.62, 0));
    g.add(box(r * 2.3, 0.05, 0.03, MAT.wheel, 0, -r * 0.62, 0));
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.7, r * 0.95), new THREE.MeshBasicMaterial({ map: wheelDisplayTexture() }));
    disp.position.z = -0.012; disp.rotation.y = Math.PI; // faces the driver (-Z)
    g.add(disp);
    g.add(box(r * 1.9, r * 1.1, 0.02, MAT.carbon, 0, 0, 0));
  } else {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 10, 36), MAT.wheel);
    g.add(rim);
    const mark = new THREE.Mesh(new THREE.TorusGeometry(r, 0.032, 8, 8, 0.35), MAT.grip); // top-centre marker
    mark.rotation.z = Math.PI / 2 - 0.175;
    g.add(mark);
    for (const a of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
      const s = box(r * 0.9, 0.035, 0.02, MAT.wheel, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0);
      s.rotation.z = a;
      g.add(s);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.04, 16), MAT.trim);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
  }
  g.position.set(spec.x, spec.y, spec.z);
  g.rotation.x = spec.tilt; // top of the wheel leans away from the driver
  return g;
}

export function buildCockpitKit(vehicle) {
  const C = cockpitFor(vehicle);
  const kit = new THREE.Group();
  kit.name = 'cockpit';
  kit.userData.vehicle = vehicle;

  if (C.cabin) {
    const { halfW, floorY, roofY, backZ, frontZ, screenTopZ, screenBaseZ, screenBaseY } = C.cabin;
    const len = frontZ - backZ;
    kit.add(box(halfW * 2, 0.02, len, MAT.shell, 0, floorY, (frontZ + backZ) / 2));            // floor
    kit.add(box(halfW * 2, 0.02, len + 0.1, MAT.shell, 0, roofY, (frontZ + backZ) / 2 - 0.05)); // roof lining
    kit.add(box(0.02, roofY - floorY, len, MAT.shell, -halfW, (roofY + floorY) / 2, (frontZ + backZ) / 2)); // doors
    kit.add(box(0.02, roofY - floorY, len, MAT.shell, halfW, (roofY + floorY) / 2, (frontZ + backZ) / 2));
    kit.add(box(halfW * 2, roofY - floorY, 0.02, MAT.shell, 0, (roofY + floorY) / 2, backZ));  // rear bulkhead
    // Windscreen frame: A-pillars from the dash corners up to the roof.
    for (const sx of [-1, 1]) {
      kit.add(bar([sx * halfW, screenBaseY, screenBaseZ], [sx * (halfW - 0.05), roofY, screenTopZ], 0.03, MAT.trim));
      kit.add(bar([sx * halfW, floorY, backZ + 0.05], [sx * halfW, roofY, backZ + 0.05], 0.04, MAT.trim)); // B-pillars
    }
    kit.add(bar([-halfW, roofY - 0.02, screenTopZ], [halfW, roofY - 0.02, screenTopZ], 0.04, MAT.trim));    // header rail
    // Cowl: the panel under the windscreen, from the dash top to the base.
    const cowl = box(halfW * 2, 0.02, screenBaseZ - C.dash.z + C.dash.depth / 2 + 0.05, MAT.trim, 0, C.dash.y + C.dash.h / 2, (screenBaseZ + C.dash.z + C.dash.depth / 2) / 2);
    kit.add(cowl);
    // Dashboard: a slab with the instrument face toward the driver.
    const D = C.dash;
    kit.add(box(halfW * 2 - 0.1, D.h, D.depth, MAT.trim, 0, D.y, D.z));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 1.1, D.h * 0.9), new THREE.MeshBasicMaterial({ map: dashTexture(D.style) }));
    face.position.set(C.wheel.x, D.y + 0.005, D.z - D.depth / 2 - 0.005);
    face.rotation.y = Math.PI; // toward -Z, the driver
    face.rotation.x = -0.25;
    kit.add(face);
    // Centre console between the seats, and a solid footwell under the dash
    // so the front wheels never show through the floor.
    kit.add(box(0.28, 0.32, 0.9, MAT.trim, 0, floorY + 0.16, backZ + 0.7));
    kit.add(box(halfW * 2, D.y - D.h / 2 - floorY, 0.9, MAT.shell, 0, (D.y - D.h / 2 + floorY) / 2, frontZ + 0.45));
    if (C.cage) {
      const r = C.cageBig ? 0.03 : 0.024;
      const z0 = backZ + 0.12, z1 = frontZ - 0.05, yT = roofY - 0.07;
      for (const sx of [-1, 1]) {
        kit.add(bar([sx * (halfW - 0.06), floorY, z0], [sx * (halfW - 0.06), yT, z0], r, MAT.tube));       // main hoop uprights
        kit.add(bar([sx * (halfW - 0.06), yT, z0], [sx * (halfW - 0.06), yT, z1], r, MAT.tube));            // roof rails
        kit.add(bar([sx * (halfW - 0.06), yT, z1], [sx * (halfW - 0.02), screenBaseY + 0.05, screenBaseZ - 0.1], r, MAT.tube)); // down the A-pillar
      }
      kit.add(bar([-(halfW - 0.06), yT, z0], [halfW - 0.06, yT, z0], r, MAT.tube)); // main hoop top
      kit.add(bar([-(halfW - 0.06), yT, z1], [halfW - 0.06, yT, z1], r, MAT.tube)); // front hoop top
      kit.add(bar([-(halfW - 0.06), yT, z0], [halfW - 0.06, floorY + 0.3, z0], r, MAT.tube)); // diagonal
    }
  }

  if (C.rim) {
    // Open cockpit: the padded surround of the opening, and the halo.
    const R = C.rim;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 10, 40), MAT.carbon);
    ring.scale.set(R.w / 2, R.l / 2, 1);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, R.y, R.z);
    kit.add(ring);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 10, 40), MAT.wheel);
    pad.scale.set(R.w / 2, R.l / 2, 1);
    pad.rotation.x = Math.PI / 2;
    pad.position.set(0, R.y - 0.05, R.z - 0.1);
    kit.add(pad);
    // Cockpit tub walls, so looking sideways shows the sides of the tub.
    kit.add(box(0.03, 0.45, R.l + 0.3, MAT.carbon, -R.w / 2 - 0.02, R.y - 0.22, R.z));
    kit.add(box(0.03, 0.45, R.l + 0.3, MAT.carbon, R.w / 2 + 0.02, R.y - 0.22, R.z));
    kit.add(box(R.w + 0.1, 0.02, 0.3, MAT.carbon, 0, R.y - 0.02, R.z + R.l / 2 + 0.1)); // scuttle ahead of the opening
  }
  if (C.halo) {
    const H = C.halo;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(H.r, 0.032, 10, 40, Math.PI), MAT.tube);
    arc.rotation.x = Math.PI / 2; // lies flat
    arc.rotation.z = 0;
    arc.position.set(0, H.y, H.z);
    // TorusGeometry's arc runs from +X through +Y; flat, that is +X through +Z... orient it to wrap around the back of the driver.
    arc.rotation.set(-Math.PI / 2, 0, Math.PI);
    kit.add(arc);
    kit.add(bar([0, H.y, H.z + H.r], [0, H.y - 0.32, H.noseZ], 0.03, MAT.tube)); // centre strut down to the nose
  }

  if (C.wheel) {
    const w = steeringWheel(C.wheel);
    w.name = 'wheel';
    kit.add(w);
    // Steering column.
    if (!C.open) kit.add(bar([C.wheel.x, C.wheel.y - 0.02, C.wheel.z], [C.wheel.x, C.dash.y - 0.05, C.dash.z - C.dash.depth / 2], 0.03, MAT.trim));
    else kit.add(bar([0, C.wheel.y - 0.04, C.wheel.z], [0, C.wheel.y - 0.14, C.wheel.z + 0.25], 0.03, MAT.trim));
  }
  return kit;
}
