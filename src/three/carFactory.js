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

// Labels over each car: a pill with the number, flag and name, and a separate
// position badge that redraws when the rank changes. Both are sprites, so
// they face the camera; the badge is anchored through `center` so it always
// sits to the pill's left on screen, whatever the camera does.
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function carLabel(racer, accent) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  roundRect(g, 6, 18, 500, 92, 46);
  g.fillStyle = 'rgba(10,12,16,0.86)';
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = accent;
  g.beginPath(); g.arc(64, 64, 38, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0b0d12';
  g.font = 'bold 42px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(racer.number), 64, 66);
  g.fillStyle = '#fff';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'left';
  g.fillText(`${racer.flag} ${racer.short}`, 116, 66, 380);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, opacity: 0.92 }));
  sprite.scale.set(4.0, 1.0, 1);
  return sprite;
}

export function positionBadge(accent) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, opacity: 0.95 }));
  sprite.scale.set(1.0, 1.0, 1);
  // The pill is 4.0 wide about its anchor; put this badge's right edge just
  // past the pill's left edge, in units of the badge's own width.
  sprite.center.set(1 + (2.0 + 0.1) / 1.0, 0.5);
  const set = (rank) => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = accent;
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0d12';
    g.font = `bold ${rank >= 10 ? 52 : 60}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`P${rank}`, 64, 68);
    tex.needsUpdate = true;
  };
  set(0);
  return { sprite, set };
}
