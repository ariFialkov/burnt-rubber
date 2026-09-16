// Pit crew figures on their skeletons.
//
// The rigs are Mixamo-style (hips, a three-bone spine, neck and head,
// shoulder / upper arm / forearm / hand, thigh / shin / foot / toes) and
// come with one clip, a run. Everything else is posed here: a pose is a set
// of directions, in the figure's own frame (+Z ahead, +Y up, +X its left),
// that each bone should point along — thigh straight down, forearm out to
// the wheel — plus where the hips sit. Aiming bones by direction rather than
// by joint angle keeps the poses readable and independent of how any one
// rig's bind pose happens to be stored (these are stored mid-stride).
//
// Motion between poses is a per-bone chase of the target directions at a
// rate that differs by body part (hands quick, spine slow), with a little
// breathing and sway on top, so the figures settle into a pose the way a
// person does rather than snapping. The run clip is layered under all of
// that: when a figure moves, the clip drives the bones and the pose fades
// out; when it arrives, the pose fades back in.

import * as THREE from 'three';
import { buildCrewFigure } from './models.js';
import { crewBadge } from './numbers.js';
import { clamp, lerp } from '../core/rng.js';

const RUN_SPEED = 4.6;   // m/s the run clip is paced for
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

// Bones that are aimed (the direction is toward the named child), in
// parent-first order. Anything not listed keeps its bind rotation.
const CHAINS = [
  ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head'], ['Head', 'HeadTop_End'],
  ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['LeftHand', 'LeftHandMiddle4'],
  ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'], ['RightHand', 'RightHandMiddle4'],
  ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['LeftFoot', 'LeftToeBase'],
  ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'], ['RightFoot', 'RightToeBase'],
];
// How quickly each part follows its target (1/s).
const RATE = { Spine: 5, Spine1: 5, Spine2: 6, Neck: 7, Head: 7, LeftArm: 9, LeftForeArm: 11, LeftHand: 13, RightArm: 9, RightForeArm: 11, RightHand: 13, LeftUpLeg: 7, LeftLeg: 8, LeftFoot: 9, RightUpLeg: 7, RightLeg: 8, RightFoot: 9 };

const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const mirror = (d) => new THREE.Vector3(-d.x, d.y, d.z);

// Standing, arms hanging; everything else is a delta on this.
const STAND = {
  hips: [0, 0.98, 0], lean: 0, // lean: torso pitch forward (rad)
  Spine: v(0, 1, 0.02), Spine1: v(0, 1, 0), Spine2: v(0, 1, -0.02), Neck: v(0, 1, 0.05), Head: v(0, 1, 0.08),
  LeftArm: v(0.18, -1, 0.05), LeftForeArm: v(0.08, -1, 0.22), LeftHand: v(0.05, -1, 0.35),
  RightArm: v(-0.18, -1, 0.05), RightForeArm: v(-0.08, -1, 0.22), RightHand: v(-0.05, -1, 0.35),
  LeftUpLeg: v(0.05, -1, 0), LeftLeg: v(0.02, -1, -0.02), LeftFoot: v(0, -0.35, 1),
  RightUpLeg: v(-0.05, -1, 0), RightLeg: v(-0.02, -1, -0.02), RightFoot: v(0, -0.35, 1),
};

// The pose book. Each is built on STAND; hands are aimed at the work in
// the figure's frame, so the crew's placement puts the work where the
// hands are.
export const POSES = {
  stand: STAND,
  // ready: knees soft, leaning in, hands up in front
  ready: { ...STAND, hips: [0, 0.92, 0.02], lean: 0.18,
    LeftArm: v(0.22, -0.8, 0.5), LeftForeArm: v(0.05, -0.2, 1), LeftHand: v(0, -0.1, 1),
    RightArm: v(-0.22, -0.8, 0.5), RightForeArm: v(-0.05, -0.2, 1), RightHand: v(0, -0.1, 1),
    LeftUpLeg: v(0.06, -1, 0.25), LeftLeg: v(0.02, -1, -0.2), RightUpLeg: v(-0.06, -1, 0.25), RightLeg: v(-0.02, -1, -0.2) },
  // down on the right knee at a wheel hub, the gun out ahead at hub height
  gun: { ...STAND, hips: [0, 0.5, -0.05], lean: 0.55,
    Spine: v(0, 1, 0.5), Spine1: v(0, 1, 0.55), Spine2: v(0, 1, 0.5), Neck: v(0, 0.7, 0.8), Head: v(0, 0.6, 0.85),
    LeftArm: v(0.2, -0.9, 0.55), LeftForeArm: v(-0.1, -0.6, 0.8), LeftHand: v(-0.1, -0.5, 0.85),
    RightArm: v(-0.2, -0.9, 0.55), RightForeArm: v(0.1, -0.6, 0.8), RightHand: v(0.1, -0.5, 0.85),
    LeftUpLeg: v(0.1, -0.15, 1), LeftLeg: v(0.05, -1, -0.05), LeftFoot: v(0, -0.3, 1),       // left leg up, foot planted ahead
    RightUpLeg: v(-0.15, -1, 0.1), RightLeg: v(-0.05, -0.05, -1), RightFoot: v(0, -0.6, -1) }, // right knee down, shin back along the ground
  // the gun raised off the hub while the wheel is swapped
  gunUp: { ...STAND, hips: [0, 0.54, -0.05], lean: 0.42,
    Spine: v(0, 1, 0.38), Spine1: v(0, 1, 0.42), Spine2: v(0, 1, 0.38), Neck: v(0, 0.85, 0.6), Head: v(0, 0.8, 0.7),
    LeftArm: v(0.3, -0.6, 0.8), LeftForeArm: v(-0.1, -0.05, 1), LeftHand: v(-0.15, 0, 1),
    RightArm: v(-0.3, -0.6, 0.8), RightForeArm: v(0.1, -0.05, 1), RightHand: v(0.15, 0, 1),
    LeftUpLeg: v(0.1, -0.15, 1), LeftLeg: v(0.05, -1, -0.05), LeftFoot: v(0, -0.3, 1),
    RightUpLeg: v(-0.15, -1, 0.1), RightLeg: v(-0.05, -0.05, -1), RightFoot: v(0, -0.6, -1) },
  // crouched square to the car, both hands out and low: on a wheel being pulled or pushed
  wheel: { ...STAND, hips: [0, 0.62, -0.02], lean: 0.55,
    Spine: v(0, 1, 0.55), Spine1: v(0, 1, 0.6), Spine2: v(0, 1, 0.5), Neck: v(0, 0.75, 0.75), Head: v(0, 0.7, 0.8),
    LeftArm: v(0.35, -0.6, 0.9), LeftForeArm: v(-0.05, -0.35, 1), LeftHand: v(-0.1, -0.2, 1),
    RightArm: v(-0.35, -0.6, 0.9), RightForeArm: v(0.05, -0.35, 1), RightHand: v(0.1, -0.2, 1),
    LeftUpLeg: v(0.2, -0.45, 1), LeftLeg: v(0.05, -1, -0.35), LeftFoot: v(0.1, -0.3, 1),
    RightUpLeg: v(-0.2, -0.45, 1), RightLeg: v(-0.05, -1, -0.35), RightFoot: v(-0.1, -0.3, 1) },
  // carrying a tyre against the chest, both arms wrapped ahead
  carry: { ...STAND, hips: [0, 0.96, 0], lean: 0.06,
    LeftArm: v(0.3, -0.7, 0.75), LeftForeArm: v(-0.6, -0.1, 0.8), LeftHand: v(-0.9, 0, 0.4),
    RightArm: v(-0.3, -0.7, 0.75), RightForeArm: v(0.6, -0.1, 0.8), RightHand: v(0.9, 0, 0.4) },
  // the fuel man: standing braced, the can held at hip height into the tank door
  fuel: { ...STAND, hips: [0, 0.88, 0.03], lean: 0.3,
    Spine: v(0, 1, 0.3), Spine1: v(0, 1, 0.3), Spine2: v(0, 1, 0.25), Neck: v(0, 0.85, 0.55), Head: v(0, 0.8, 0.6),
    LeftArm: v(0.25, -0.75, 0.6), LeftForeArm: v(-0.2, -0.3, 1), LeftHand: v(-0.2, -0.3, 1),
    RightArm: v(-0.2, -0.85, 0.45), RightForeArm: v(0.2, -0.4, 1), RightHand: v(0.2, -0.3, 1),
    LeftUpLeg: v(0.15, -1, 0.35), LeftLeg: v(0.05, -1, -0.25), RightUpLeg: v(-0.2, -1, -0.15), RightLeg: v(-0.05, -1, 0.05) },
  // the chief: feet apart, the board held up in the right hand
  chief: { ...STAND, hips: [0, 0.97, 0], lean: -0.04,
    RightArm: v(-0.3, 0.9, 0.35), RightForeArm: v(-0.1, 1, 0.15), RightHand: v(0, 1, 0.05),
    LeftArm: v(0.25, -1, 0.1), LeftForeArm: v(0.15, -1, 0.25),
    LeftUpLeg: v(0.16, -1, 0), RightUpLeg: v(-0.16, -1, 0) },
  // the chief once the car is gone: board down, arm across the chest
  chiefDown: { ...STAND, hips: [0, 0.97, 0],
    RightArm: v(-0.25, -0.95, 0.25), RightForeArm: v(0.3, -0.6, 0.75), RightHand: v(0.4, -0.3, 0.8),
    LeftUpLeg: v(0.16, -1, 0), RightUpLeg: v(-0.16, -1, 0) },
  // both arms up: the wheel is done / the car is released
  release: { ...STAND, hips: [0, 0.96, 0], lean: -0.05,
    LeftArm: v(0.45, 0.85, 0.2), LeftForeArm: v(0.25, 1, 0.1), LeftHand: v(0.15, 1, 0),
    RightArm: v(-0.45, 0.85, 0.2), RightForeArm: v(-0.25, 1, 0.1), RightHand: v(-0.15, 1, 0) },
  // one arm up, waving the car away
  wave: { ...STAND, hips: [0, 0.97, 0],
    RightArm: v(-0.4, 0.85, 0.3), RightForeArm: v(-0.2, 1, 0.2), RightHand: v(-0.1, 1, 0.1) },
  // hands on hips, watching
  watch: { ...STAND, hips: [0, 0.97, 0], lean: -0.03,
    LeftArm: v(0.6, -0.8, 0), LeftForeArm: v(-0.9, -0.3, 0.3), LeftHand: v(-1, 0, 0.2),
    RightArm: v(-0.6, -0.8, 0), RightForeArm: v(0.9, -0.3, 0.3), RightHand: v(1, 0, 0.2) },
};

// The chest badge, per rig, in the Spine2 bone's frame: where the baked
// number sits on the left breast, the surface normal there, and up.
const BADGE = {
  mechanic: { p: [0.092, -0.043, 0.040], n: [0.312, 0.056, 0.948], up: [0, 1, 0.008] },
  engineer: { p: [0.024, -0.034, 0.112], n: [0.544, 0.474, 0.692], up: [0, 1, 0.016] },
  chief:    { p: [0.040, -0.0623, 0.140], n: [0.229, 0.353, 0.907], up: [0, 1, 0.008] },
};

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class CrewRig {
  constructor(role, colors, number = null) {
    this.role = role;
    this.root = buildCrewFigure(role, colors);
    this.ok = !!this.root;
    if (!this.ok) return;
    const { bones, body, clips } = this.root.userData;
    this.bones = bones;
    this.body = body;
    this.number = number;
    // the skeleton's parent chain above the hips (the rig's own root
    // rotation), so aiming can work in the figure's frame
    const hips = bones.Hips;
    this.preRot = new THREE.Quaternion();
    { let o = hips.parent; const q = new THREE.Quaternion(); while (o && o !== this.root) { q.premultiply(o.quaternion); o = o.parent; } this.preRot.copy(q); }
    this.preRotInv = this.preRot.clone().invert();
    // per aimed bone: its bind rotation and the local axis toward its child
    this.aim = [];
    for (const [name, childName] of CHAINS) {
      const b = bones[name], c = bones[childName];
      if (!b || !c) continue;
      this.aim.push({ name, bone: b, q0: b.quaternion.clone(), axis: c.position.clone().normalize(), cur: null, rate: RATE[name] || 8 });
    }
    this.bind = new Map();
    for (const b of Object.values(bones)) this.bind.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
    // hips: bind rotation and the local axes we steer by (up = toward the spine, forward = the figure's +Z at bind)
    this.hips = { bone: hips, q0: hips.quaternion.clone(), p0: hips.position.clone(), scale: 1 };
    // the fixed transform between the figure's frame (this.root) and the
    // hips' parent: figure-frame positions go through its inverse
    this.root.updateWorldMatrix(true, true);
    this.preMat = hips.parent.matrixWorld.clone();
    this.preMatInv = this.preMat.clone().invert();
    { const s = new THREE.Vector3(); this.preMat.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); this.hips.scale = s.x; }
    this.hips.up = bones.Spine.position.clone().normalize();
    const hipsWorld0 = this.preRot.clone().multiply(hips.quaternion);
    this.hips.fwd = FWD.clone().applyQuaternion(hipsWorld0.clone().invert()); // the figure's forward, in the hips' bind frame
    // the run clip
    this.mixer = new THREE.AnimationMixer(this.root);
    const run = clips.find((c) => c.name === 'run') || clips[0];
    this.run = run ? this.mixer.clipAction(run) : null;
    if (this.run) { this.run.play(); this.run.setEffectiveWeight(1); }
    this.runW = 0;           // how much the clip shows through
    this.runPhase = Math.random() * 10;
    this.pose = POSES.stand;
    this.prevPose = null;
    this.poseT = 1;          // blend progress into this.pose
    this.hipsCur = new THREE.Vector3(...STAND.hips);
    this.leanCur = 0;
    this.sway = Math.random() * 6.28;
    this.noise = 1;          // how much idle motion (0 while working precisely)
    this.work = null;        // { lugs } while the gun is on the hub
    this.props = {};
    // the shirt number: a badge on the left breast, riding on the chest bone
    { const B = BADGE[role]; const spine = bones.Spine2;
      if (B && spine) {
        const sc = 1 / this.hips.scale;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.112 * sc, 0.072 * sc), new THREE.MeshStandardMaterial({ map: crewBadge(number ?? ''), roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
        const n = new THREE.Vector3(...B.n), up = new THREE.Vector3(...B.up);
        plane.position.set(...B.p).addScaledVector(n, 0.010 * sc);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), n.clone().negate(), up); // a plane faces +Z; lookAt points -Z at the target
        plane.quaternion.setFromRotationMatrix(m);
        plane.name = 'badge';
        spine.add(plane);
        this.badge = plane;
      } }
    // seed the direction state from the stand pose
    for (const a of this.aim) a.cur = (STAND[a.name] || v(0, 1, 0)).clone();
    this.apply(0, 0, true);
  }

  setNumber(n) {
    if (n === this.number || !this.badge) return;
    this.number = n;
    const old = this.badge.material.map;
    this.badge.material.map = crewBadge(n);
    this.badge.material.needsUpdate = true;
    if (old) old.dispose();
  }

  // Switch pose; blending is per bone at each part's own rate.
  setPose(name) {
    const p = POSES[name] || POSES.stand;
    if (p === this.pose) return;
    this.pose = p;
  }

  // A prop attached to a bone; built by the caller. With `aimBone` the prop's
  // +Z is kept along that bone's aimed direction (a gun down the forearm,
  // a pole up the raised arm) whatever the hand's own twist.
  attach(kind, mesh, boneName, offset, euler, aimBone = null) {
    const b = this.bones[boneName];
    if (!b) return;
    mesh.position.copy(offset);
    mesh.rotation.copy(euler);
    // bones sit under the rig's unit scale: counter it so the prop is in metres
    const s = 1 / this.hips.scale;
    mesh.scale.multiplyScalar(s);
    mesh.position.multiplyScalar(s);
    b.add(mesh);
    this.props[kind] = mesh;
    if (aimBone) this.aimedProps = [...(this.aimedProps || []), { mesh, bone: b, aim: aimBone }];
  }
  showProp(kind, on) { const p = this.props[kind]; if (p) p.visible = on; }

  // Advance: `speed` is how fast the figure is moving over the ground (the
  // run clip fades in with it); `t` is the clock for the idle motion.
  update(dt, t, speed = 0) {
    if (!this.ok) return;
    const wantRun = clamp((speed - 0.25) / 1.0, 0, 1);
    this.runW += (wantRun - this.runW) * (1 - Math.exp(-8 * dt));
    if (this.run) {
      this.run.timeScale = clamp(Math.max(speed, 1.2) / RUN_SPEED, 0.45, 1.5);
      this.mixer.update(this.runW > 0.001 ? dt : 0);
    }
    this.apply(dt, t, false);
  }

  apply(dt, t, snap) {
    const P = this.pose;
    const k = (rate) => (snap ? 1 : 1 - Math.exp(-rate * dt));
    // hips and lean chase their targets
    _v.set(P.hips[0], P.hips[1], P.hips[2]);
    this.hipsCur.lerp(_v, k(6));
    this.leanCur = lerp(this.leanCur, P.lean || 0, k(5));
    // idle: breathing in the spine, a slow sway of the hips
    const n = this.noise;
    const breathe = Math.sin(t * 1.9 + this.sway) * 0.012 * n;
    const swayX = Math.sin(t * 0.7 + this.sway) * 0.012 * n, swayZ = Math.cos(t * 0.53 + this.sway * 1.3) * 0.008 * n;
    // --- the procedural pose, parent-first, in the figure's frame
    const world = new Map(); // bone -> world (figure-frame) rotation of the procedural pose
    const hips = this.hips;
    // hips: up axis leaning ahead by `lean`, forward axis along +Z
    const upT = _v.set(swayX, 1, Math.sin(this.leanCur)).normalize();
    const qUp = _q.setFromUnitVectors(hips.up.clone().applyQuaternion(this.preRot.clone().multiply(hips.q0)), upT); // world adjust to bring the bind up-axis onto the target
    let hipsW = qUp.clone().multiply(this.preRot).multiply(hips.q0);
    // twist about the new up axis so the hips face +Z
    const f = hips.fwd.clone().applyQuaternion(hipsW); f.addScaledVector(upT, -f.dot(upT)).normalize();
    const fT = FWD.clone().addScaledVector(upT, -FWD.dot(upT)).normalize();
    const tw = _q2.setFromUnitVectors(f, fT);
    hipsW = tw.multiply(hipsW);
    const hipsLocal = this.preRotInv.clone().multiply(hipsW);
    const hipsPos = this.hipsCur.clone(); hipsPos.x += swayX * 0.5; hipsPos.z += swayZ; hipsPos.y += breathe * 0.3;
    world.set(hips.bone, hipsW);
    const pending = { hips: { q: hipsLocal, p: hipsPos.applyMatrix4(this.preMatInv) }, bones: [] };
    // working the gun: the hands walk round the lug pattern and buzz
    const W = this.work;
    let lug = null;
    if (W) {
      const step = Math.floor(t / 0.3);
      const ang = W.lugs > 1 ? (step % W.lugs) * (Math.PI * 2 / W.lugs) : 0;
      const r = W.lugs > 1 ? 0.07 : 0.0;
      const buzz = Math.sin(t * 43) * 0.012;
      lug = new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, buzz);
    }
    for (const a of this.aim) {
      const target = P[a.name] || STAND[a.name];
      a.cur.lerp(target, k(a.rate)).normalize();
      let d = a.cur;
      if (lug && /ForeArm|Hand$/.test(a.name)) d = _v2.copy(d).add(lug).normalize();
      if (n > 0 && (a.name === 'Spine1' || a.name === 'Spine2')) d = _v2.copy(d).addScaledVector(FWD, breathe).normalize();
      if (n > 0 && a.name === 'Head') d = _v2.copy(d).add(new THREE.Vector3(Math.sin(t * 0.45 + this.sway) * 0.08 * n, 0, 0)).normalize();
      const parentW = world.get(a.bone.parent) || this.chainRot(a.bone.parent, world);
      // current axis direction with the bind rotation, then the shortest
      // turn that brings it onto the target
      const cur = a.axis.clone().applyQuaternion(_q.copy(parentW).multiply(a.q0));
      const adj = new THREE.Quaternion().setFromUnitVectors(cur, d);
      const w = adj.multiply(parentW).multiply(a.q0);
      world.set(a.bone, w);
      const local = parentW.clone().invert().multiply(w);
      pending.bones.push([a.bone, local]);
    }
    // --- blend under the run clip
    const wp = 1 - this.runW;
    const H = hips.bone;
    if (wp >= 0.999 || snap) { H.quaternion.copy(pending.hips.q); H.position.copy(pending.hips.p); }
    else { H.quaternion.slerp(pending.hips.q, wp); H.position.lerp(pending.hips.p, wp); }
    for (const [b, q] of pending.bones) {
      if (wp >= 0.999 || snap) b.quaternion.copy(q); else b.quaternion.slerp(q, wp);
    }
    // aimed props: +Z along the aimed bone's direction, in the figure's frame
    if (this.aimedProps) {
      for (const pr of this.aimedProps) {
        const a = this.aim.find((x) => x.name === pr.aim);
        const bw = world.get(pr.bone);
        if (!a || !bw) continue;
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), a.cur.clone().negate(), Math.abs(a.cur.y) > 0.9 ? FWD : UP);
        const qAim = new THREE.Quaternion().setFromRotationMatrix(m);
        pr.mesh.quaternion.copy(bw.clone().invert().multiply(qAim));
      }
    }
  }

  // World (figure-frame) rotation of an un-aimed bone under the procedural pose: its bind rotation under its parent's.
  chainRot(bone, world) {
    if (!bone || !bone.isBone) return this.preRot.clone();
    const parentW = world.get(bone.parent) || this.chainRot(bone.parent, world);
    const w = parentW.clone().multiply(bone.quaternion);
    world.set(bone, w);
    return w;
  }
}

// --- props --------------------------------------------------------------------
const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.3 });
const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.95 });

export function wheelGun(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 }));
  body.rotation.x = Math.PI / 2; body.position.z = 0.1; g.add(body);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 8), steel); socket.rotation.x = Math.PI / 2; socket.position.z = 0.3; g.add(socket);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), dark); grip.position.set(0, -0.08, 0.02); g.add(grip);
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), rubber); hose.position.set(0, -0.2, -0.15); hose.rotation.x = 0.5; g.add(hose);
  return g;
}
// The can lies along +Z (the aimed hand direction), neck ahead, handle on top.
export function fuelCan(color) {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.4, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.5 })); can.rotation.x = Math.PI / 2; can.position.z = 0.1; g.add(can);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 8), steel); neck.rotation.x = Math.PI / 2; neck.position.set(0, -0.04, 0.4); g.add(neck);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12), dark); handle.position.set(0, 0.15, 0.05); handle.rotation.y = Math.PI / 2; g.add(handle);
  return g;
}
export function tyre(radius = 0.33, width = 0.28) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), rubber); t.rotation.z = Math.PI / 2; g.add(t);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, width + 0.01, 12), steel); rim.rotation.z = Math.PI / 2; g.add(rim);
  return g;
}
// The lollipop runs along +Z (the aimed hand direction), board at the far end.
export function lollipop(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.5, 6), steel); pole.rotation.x = Math.PI / 2; pole.position.z = 0.6; g.add(pole);
  const board = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.6 })); board.rotation.z = Math.PI / 2; board.position.z = 1.4; g.add(board);
  return g;
}
