// Surface effects: what the cars leave on the road and throw up behind them.
//
// Marks — tyre tracks and skid marks — are flat quads laid from each rear
// wheel's contact point into one ring-buffered mesh (a single draw call, only
// the new quads uploaded each frame). Dirt classes lay shallow tracks the
// whole way and deeper ones under braking and cornering load; tarmac classes
// only leave black rubber when they are braking or loading the tyres hard.
// The ring is sized to hold a whole race for the biggest dirt field, and if
// it ever does wrap, a mark fades out as the head approaches its slot rather
// than vanishing the frame it is overwritten.
//
// Particles — dust, mud, wet sand, gravel flecks — are point sprites with a
// per-particle world size, colour and fade, updated on the CPU in a ring
// buffer and drawn in one call. Rates, colours and ballistics depend on the
// class and the weather.

import * as THREE from 'three';

// Per class: how the surface behaves.
export const SURFACE = {
  formula: { kind: 'tarmac', mark: 0x0b0b0d, hardAlpha: 0.55, width: 0.34 },
  stock:   { kind: 'tarmac', mark: 0x0b0b0d, hardAlpha: 0.5, width: 0.28, gravel: true },
  moto:    { kind: 'tarmac', mark: 0x0b0b0d, hardAlpha: 0.5, width: 0.13 },
  rally:   { kind: 'dirt', mark: 0x3b3428, shallowAlpha: 0.07, hardAlpha: 0.3, width: 0.26, dust: 0xa89880, mud: 0x3a2a18 },
  baja:    { kind: 'dirt', mark: 0x5a4530, shallowAlpha: 0.09, hardAlpha: 0.32, width: 0.34, dust: 0xcdb289, mud: 0x5c4630, big: true },
};

const MAX_MARKS = 80000;      // quads in the ring (~57k laid in a 40-truck dirt race)
const MAX_PARTICLES = 6000;

let softTex = null;
function softSprite() {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

export class SurfaceFX {
  constructor(scene, vehicle, wet, fieldSize = 12) {
    this.spec = SURFACE[vehicle] || SURFACE.formula;
    this.wet = !!wet;
    this.vehicle = vehicle;
    // Big fields throw up proportionally less each, so the cloud stays in budget.
    this.rateScale = Math.min(1, Math.max(0.28, 12 / fieldSize));

    // --- marks -------------------------------------------------------------
    const mg = new THREE.BufferGeometry();
    this.mPos = new THREE.BufferAttribute(new Float32Array(MAX_MARKS * 4 * 3), 3);
    this.mCol = new THREE.BufferAttribute(new Float32Array(MAX_MARKS * 4 * 4), 4);
    this.mPos.setUsage(THREE.DynamicDrawUsage);
    this.mCol.setUsage(THREE.DynamicDrawUsage);
    // Each vertex knows its quad's ring slot (static): the shader fades a mark
    // out over the last quarter of its ring life, measured from the head.
    const slot = new Float32Array(MAX_MARKS * 4);
    const idx = new Uint32Array(MAX_MARKS * 6);
    for (let q = 0; q < MAX_MARKS; q++) {
      const v = q * 4, i = q * 6;
      slot[v] = slot[v + 1] = slot[v + 2] = slot[v + 3] = q;
      // wound to face up (+Y): the road is seen from above
      idx[i] = v; idx[i + 1] = v + 2; idx[i + 2] = v + 1; idx[i + 3] = v; idx[i + 4] = v + 3; idx[i + 5] = v + 2;
    }
    mg.setIndex(new THREE.BufferAttribute(idx, 1));
    mg.setAttribute('position', this.mPos);
    mg.setAttribute('aCol', this.mCol);
    mg.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
    mg.setDrawRange(0, 0);
    this.mMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHead: { value: 0 } }]),
      vertexShader: `
        attribute vec4 aCol; attribute float aSlot; uniform float uHead; varying vec4 vCol;
        #include <fog_pars_vertex>
        void main() {
          float rem = mod(aSlot - uHead + ${MAX_MARKS}.0, ${MAX_MARKS}.0) / ${MAX_MARKS}.0;
          vCol = vec4(aCol.rgb, aCol.a * smoothstep(0.0, 0.25, rem));
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec4 vCol;
        #include <fog_pars_fragment>
        void main() {
          gl_FragColor = vCol;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      fog: true, transparent: true, depthWrite: false,
      // pulled toward the camera in depth-buffer units, so a mark a few
      // centimetres above the road still wins the depth test far away
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    });
    // Never culled: the bounding sphere would have to grow with every quad.
    const marks = new THREE.Mesh(mg, this.mMat);
    marks.frustumCulled = false;
    marks.renderOrder = 1;
    scene.add(marks);
    this.marks = marks;
    this.mHead = 0;      // next quad slot
    this.mCount = 0;     // quads written so far (saturates at MAX)
    this.mDirty = [];    // [start quad, count] ranges to upload
    this.markColor = new THREE.Color(this.spec.mark);

    // --- particles -----------------------------------------------------------
    const pg = new THREE.BufferGeometry();
    this.pPos = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.pCol = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4);
    this.pSize = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    for (const a of [this.pPos, this.pCol, this.pSize]) a.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.pPos);
    pg.setAttribute('aColor', this.pCol);
    pg.setAttribute('aSize', this.pSize);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);   // seconds left
    this.pAge = new Float32Array(MAX_PARTICLES);
    this.pSpan = new Float32Array(MAX_PARTICLES);   // total life
    this.pGrow = new Float32Array(MAX_PARTICLES);   // size growth per second
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pAlpha0 = new Float32Array(MAX_PARTICLES);
    this.pHead = 0;
    this.pAlive = 0;
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 }, uMap: { value: softSprite() } },
      vertexShader: `
        attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
          if (gl_FragColor.a < 0.01) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(pg, this.pMat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    scene.add(points);
    this.points = points;
    this.scene = scene;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
  }

  // Perspective point sizing: world metres -> pixels needs the viewport and fov.
  setCamera(camera, viewportHeight) {
    this.pMat.uniforms.uScale.value = (0.5 * viewportHeight) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  }

  // Lay one quad from a to b, `w` metres wide, with the given colour/alpha.
  lay(a, b, w, alpha) {
    const q = this.mHead;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const lx = -dz / len * w, lz = dx / len * w; // left of travel, half width
    const P = this.mPos.array, C = this.mCol.array;
    const v = q * 4;
    const corners = [[a.x + lx, a.y, a.z + lz], [a.x - lx, a.y, a.z - lz], [b.x - lx, b.y, b.z - lz], [b.x + lx, b.y, b.z + lz]];
    const { r, g, b: bb } = this.markColor;
    for (let k = 0; k < 4; k++) {
      P[(v + k) * 3] = corners[k][0]; P[(v + k) * 3 + 1] = corners[k][1]; P[(v + k) * 3 + 2] = corners[k][2];
      C[(v + k) * 4] = r; C[(v + k) * 4 + 1] = g; C[(v + k) * 4 + 2] = bb; C[(v + k) * 4 + 3] = alpha;
    }
    this.mDirty.push(q);
    this.mHead = (q + 1) % MAX_MARKS;
    this.mCount = Math.min(MAX_MARKS, this.mCount + 1);
  }

  // A wheel's contact point this frame. `track` is that wheel's own memory
  // ({ last, lastHard }); `hard` says the tyre is loaded (braking, cornering,
  // sliding). Returns nothing; lays quads when the wheel has travelled far
  // enough since the last one.
  wheel(track, p, hard, jumped) {
    const S = this.spec;
    if (jumped || !track.last) { track.last = p.clone(); track.lastHard = hard; return; }
    const d = Math.hypot(p.x - track.last.x, p.z - track.last.z);
    // Quads are laid end to end, so spacing only sets how faithfully a curve
    // is followed (a 2.4 m chord on a 40 m corner is 2 cm off, under the width).
    const spacing = S.kind === 'dirt' ? (hard ? 1.6 : 2.4) : 1.2;
    if (d < spacing) return;
    if (d > 25) { track.last.copy(p); return; } // teleport (lap wrap, reset)
    if (S.kind === 'dirt') {
      // Shallow track always; a deeper, wider one when loaded. Wet dirt marks darker.
      const alpha = (hard ? S.hardAlpha : S.shallowAlpha) * (this.wet ? 1.35 : 1);
      this.lay(track.last, p, S.width / 2 * (hard ? 1.25 : 1), alpha);
    } else if (hard) {
      // Rubber only under load, and less on a wet track.
      this.lay(track.last, p, S.width / 2, S.hardAlpha * (this.wet ? 0.5 : 1));
    }
    track.last.copy(p);
    track.lastHard = hard;
  }

  // Spawn one particle.
  spawn(p, vel, size, grow, life, color, alpha, grav) {
    const i = this.pHead;
    this.pHead = (i + 1) % MAX_PARTICLES;
    this.pAlive = Math.min(MAX_PARTICLES, this.pAlive + 1);
    this.pPos.setXYZ(i, p.x, p.y, p.z);
    this.pVel[i * 3] = vel.x; this.pVel[i * 3 + 1] = vel.y; this.pVel[i * 3 + 2] = vel.z;
    this.pLife[i] = life; this.pSpan[i] = life; this.pAge[i] = 0;
    this.pSize.setX(i, size);
    this.pGrow[i] = grow; this.pGrav[i] = grav; this.pAlpha0[i] = alpha;
    this.pCol.setXYZW(i, color.r, color.g, color.b, alpha);
  }

  // What a rear wheel throws up this frame. `tangent` is the car's direction,
  // `left` its left, `v` its speed, `cruise` the class's cruise speed.
  emit(p, tangent, left, v, cruise, hard, dt, rng) {
    const S = this.spec;
    if (v < 3) return;
    const f = v / cruise;
    const vel = this.tmp, pos = this.tmp2;
    if (S.kind === 'dirt') {
      if (!this.wet) {
        // Dust: many, soft, growing, drifting back and up.
        const rate = ((S.big ? 22 : 16) + (S.big ? 40 : 30) * f + (hard ? 14 : 0)) * this.rateScale;
        let n = rate * dt; n = Math.floor(n) + (rng() < n % 1 ? 1 : 0);
        const col = new THREE.Color(S.dust);
        for (let k = 0; k < n; k++) {
          pos.copy(p).addScaledVector(left, (rng() - 0.5) * 0.6).addScaledVector(tangent, -(rng() * 0.8)); pos.y += 0.15 + rng() * 0.25;
          vel.copy(tangent).multiplyScalar(-(0.12 + 0.1 * rng()) * v).addScaledVector(left, (rng() - 0.5) * 1.6); vel.y = 0.6 + rng() * 1.2 + (S.big ? 0.6 : 0);
          const life = (S.big ? 1.6 : 1.2) + rng() * 0.8;
          this.spawn(pos, vel, (S.big ? 0.8 : 0.55) + rng() * 0.4, (S.big ? 1.7 : 1.2), life, col, (S.big ? 0.3 : 0.26) * (hard ? 1.3 : 1), -0.15);
        }
      } else {
        // Mud / wet sand: fewer, small, thrown up and back on a ballistic arc.
        const rate = (10 + 26 * f + (hard ? 12 : 0)) * this.rateScale;
        let n = rate * dt; n = Math.floor(n) + (rng() < n % 1 ? 1 : 0);
        const col = new THREE.Color(S.mud);
        for (let k = 0; k < n; k++) {
          pos.copy(p).addScaledVector(left, (rng() - 0.5) * 0.4); pos.y += 0.1;
          vel.copy(tangent).multiplyScalar(-(0.25 + 0.2 * rng()) * v).addScaledVector(left, (rng() - 0.5) * 2.5); vel.y = 2.5 + rng() * 4;
          this.spawn(pos, vel, (S.big ? 0.16 : 0.12) + rng() * 0.2, 0.08, 0.55 + rng() * 0.35, col, 0.95, -9.8);
        }
      }
    } else if (S.gravel) {
      // The odd fleck of gravel off a dusty oval.
      const rate = 1.2 + 1.5 * f;
      let n = rate * dt; n = Math.floor(n) + (rng() < n % 1 ? 1 : 0);
      const col = new THREE.Color(0x5a5650);
      for (let k = 0; k < n; k++) {
        pos.copy(p).addScaledVector(left, (rng() - 0.5) * 0.3); pos.y += 0.08;
        vel.copy(tangent).multiplyScalar(-(0.2 + 0.2 * rng()) * v).addScaledVector(left, (rng() - 0.5) * 3); vel.y = 1.5 + rng() * 3;
        this.spawn(pos, vel, 0.06 + rng() * 0.05, 0, 0.5 + rng() * 0.3, col, 0.95, -9.8);
      }
    } else if (hard && !this.wet) {
      // A wisp of tyre smoke off a locked or loaded tyre on tarmac.
      const rate = 6;
      let n = rate * dt; n = Math.floor(n) + (rng() < n % 1 ? 1 : 0);
      const col = new THREE.Color(0xbfc2c8);
      for (let k = 0; k < n; k++) {
        pos.copy(p).addScaledVector(tangent, -0.3); pos.y += 0.15;
        vel.copy(tangent).multiplyScalar(-0.1 * v).addScaledVector(left, (rng() - 0.5) * 0.8); vel.y = 0.8 + rng();
        this.spawn(pos, vel, 0.35 + rng() * 0.2, 1.4, 0.6 + rng() * 0.4, col, 0.22, -0.1);
      }
    }
  }

  update(dt) {
    // Marks: upload only what changed.
    if (this.mDirty.length) {
      this.mPos.clearUpdateRanges(); this.mCol.clearUpdateRanges();
      // Coalesce into contiguous runs (the ring may wrap once).
      this.mDirty.sort((a, b) => a - b);
      let start = this.mDirty[0], prev = start;
      const flush = (s, e) => { this.mPos.addUpdateRange(s * 12, (e - s + 1) * 12); this.mCol.addUpdateRange(s * 16, (e - s + 1) * 16); };
      for (let k = 1; k < this.mDirty.length; k++) { const q = this.mDirty[k]; if (q !== prev + 1) { flush(start, prev); start = q; } prev = q; }
      flush(start, prev);
      this.mPos.needsUpdate = true; this.mCol.needsUpdate = true;
      this.marks.geometry.setDrawRange(0, this.mCount * 6);
      this.mDirty.length = 0;
    }
    this.mMat.uniforms.uHead.value = this.mHead;
    // Particles: integrate everything alive.
    const P = this.pPos.array, C = this.pCol.array, Sz = this.pSize.array;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt; this.pAge[i] += dt;
      if (this.pLife[i] <= 0) { C[i * 4 + 3] = 0; Sz[i] = 0; continue; }
      const k = i * 3;
      this.pVel[k + 1] += this.pGrav[i] * dt;
      // air drag on dust, none worth modelling on a clod
      if (this.pGrav[i] > -1) { this.pVel[k] *= 1 - 1.4 * dt; this.pVel[k + 2] *= 1 - 1.4 * dt; }
      P[k] += this.pVel[k] * dt; P[k + 1] += this.pVel[k + 1] * dt; P[k + 2] += this.pVel[k + 2] * dt;
      if (P[k + 1] < 0.02 && this.pGrav[i] < -1) { this.pLife[i] = 0; C[i * 4 + 3] = 0; Sz[i] = 0; continue; } // hit the ground
      Sz[i] += this.pGrow[i] * dt;
      const u = this.pAge[i] / this.pSpan[i];
      C[i * 4 + 3] = this.pAlpha0[i] * (1 - u) * (1 - u);
    }
    this.pPos.needsUpdate = true; this.pCol.needsUpdate = true; this.pSize.needsUpdate = true;
  }

  dispose() {
    this.marks.geometry.dispose(); this.mMat.dispose();
    this.points.geometry.dispose(); this.pMat.dispose();
  }
}
