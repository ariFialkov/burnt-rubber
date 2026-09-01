// Low-poly vehicles, one silhouette per tour, liveried in team colors.

import * as THREE from 'three';

// Collision footprints in track space: half-extents along the track (len) and
// across it (width), in metres. Kept a touch tighter than the visual mesh so
// cars can run genuinely door-to-door without the separation looking springy.
export const COLLIDERS = {
  formula: { len: 2.4, width: 1.05 },
  stock: { len: 2.5, width: 1.15 },
  rally: { len: 2.2, width: 1.0 },
  baja: { len: 2.4, width: 1.3 },
  moto: { len: 1.2, width: 0.5 },
};

const lam = (color) => new THREE.MeshLambertMaterial({ color });
const dark = () => lam(0x14161a);

function wheel(r, w) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 10), dark());
  m.rotation.z = Math.PI / 2;
  return m;
}

function addWheels(g, r, w, xOff, zFront, zRear, y) {
  const list = [];
  for (const [x, z] of [[-xOff, zFront], [xOff, zFront], [-xOff, zRear], [xOff, zRear]]) {
    const wh = wheel(r, w);
    wh.position.set(x, y, z);
    g.add(wh);
    list.push(wh);
  }
  return list;
}

export function buildCar(vehicle, colors) {
  const [primary, secondary] = colors.map((c) => new THREE.Color(c));
  const g = new THREE.Group();
  let wheels = [];

  if (vehicle === 'formula') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 4.6), lam(primary));
    body.position.y = 0.45;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 6), lam(primary));
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.42, 2.9);
    const fWing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.7), lam(secondary));
    fWing.position.set(0, 0.25, 2.7);
    const rWing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.6), lam(secondary));
    rWing.position.set(0, 1.0, -2.1);
    const rWingPost = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.4), dark());
    rWingPost.position.set(0, 0.75, -2.1);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), lam(secondary));
    helmet.position.set(0, 0.85, -0.4);
    g.add(body, nose, fWing, rWing, rWingPost, helmet);
    wheels = addWheels(g, 0.42, 0.4, 1.0, 1.55, -1.6, 0.42);
  } else if (vehicle === 'stock') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 4.9), lam(primary));
    body.position.y = 0.7;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 2.4), lam(secondary));
    cabin.position.set(0, 1.35, -0.3);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 0.12), lam(secondary));
    spoiler.position.set(0, 1.35, -2.4);
    g.add(body, cabin, spoiler);
    wheels = addWheels(g, 0.45, 0.35, 1.05, 1.7, -1.7, 0.45);
  } else if (vehicle === 'rally') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 4.2), lam(primary));
    body.position.y = 0.75;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.6, 1.9), lam(secondary));
    cabin.position.set(0, 1.4, 0.1);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), lam(secondary));
    wing.position.set(0, 1.5, -2.0);
    const lights = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.15), lam(0xfff3b0));
    lights.position.set(0, 1.05, 2.1);
    g.add(body, cabin, wing, lights);
    wheels = addWheels(g, 0.48, 0.4, 0.95, 1.45, -1.45, 0.48);
  } else if (vehicle === 'baja') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.9, 4.6), lam(primary));
    body.position.y = 1.25;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 1.6), lam(secondary));
    bed.position.set(0, 1.75, -1.3);
    const cage = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.6), new THREE.MeshLambertMaterial({ color: 0x14161a, wireframe: true }));
    cage.position.set(0, 2.1, 0.4);
    g.add(body, bed, cage);
    wheels = addWheels(g, 0.75, 0.6, 1.25, 1.6, -1.6, 0.75);
  } else { // moto
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 2.2), lam(primary));
    body.position.y = 0.75;
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.8), lam(secondary));
    tank.position.set(0, 1.15, 0.3);
    const rider = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 1.1), lam(secondary));
    rider.position.set(0, 1.45, -0.35);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lam(primary));
    helmet.position.set(0, 1.95, 0.05);
    g.add(body, tank, rider, helmet);
    const f = wheel(0.5, 0.22); f.position.set(0, 0.5, 1.1);
    const r = wheel(0.5, 0.28); r.position.set(0, 0.5, -1.0);
    g.add(f, r);
    wheels = [f, r];
  }

  // Number board: tiny sprite above the car so packs are readable.
  return { group: g, wheels };
}

export function numberSprite(number, accent) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,12,16,0.85)';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 32, 34);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, opacity: 0.9 }));
  sprite.scale.set(1.3, 1.3, 1);
  return sprite;
}
