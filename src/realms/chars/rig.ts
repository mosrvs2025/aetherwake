/**
 * REALMS — skeletal rig, automatic skinning, pose blending and IK.
 *
 * Characters are skinned meshes driven entirely by code: there are no imported
 * animation clips. Each state (idle, walk, sprint, jump, roll, three attack
 * swings, cast, hurt, death) is a function that writes weighted euler offsets
 * into a pose accumulator; the animator cross-fades between them, then additive
 * layers (look-at, torso twist, hit reactions) and two-bone leg IK run on top.
 *
 * This is also the seam for imported content: `Rig.fromSkinnedMesh` adopts a
 * GLB skeleton by bone-name mapping, so a Blender character with the same bone
 * names drops straight in and inherits all of the procedural animation.
 */

import * as THREE from 'three';
import { clamp01, lerp } from '../core/math';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Bind-pose position in model space. */
  head: [number, number, number];
}

export interface SkinSegment {
  bone: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
  /** Higher = tighter, less bleed onto neighbouring limbs. */
  falloff?: number;
}

export class Rig {
  bones: THREE.Bone[] = [];
  byName = new Map<string, THREE.Bone>();
  index = new Map<string, number>();
  skeleton!: THREE.Skeleton;
  root!: THREE.Bone;
  bindPos: THREE.Vector3[] = [];
  bindQuat: THREE.Quaternion[] = [];
  bindWorld: THREE.Vector3[] = [];

  constructor(defs: BoneDef[]) {
    const worldPos = new Map<string, THREE.Vector3>();
    for (const d of defs) {
      const b = new THREE.Bone();
      b.name = d.name;
      this.byName.set(d.name, b);
      this.index.set(d.name, this.bones.length);
      this.bones.push(b);
      worldPos.set(d.name, new THREE.Vector3(...d.head));
    }
    for (const d of defs) {
      const b = this.byName.get(d.name)!;
      const w = worldPos.get(d.name)!;
      if (d.parent) {
        const p = this.byName.get(d.parent);
        if (!p) throw new Error(`Rig: unknown parent ${d.parent}`);
        p.add(b);
        b.position.copy(w).sub(worldPos.get(d.parent)!);
      } else {
        this.root = b;
        b.position.copy(w);
      }
    }
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    for (const b of this.bones) {
      this.bindPos.push(b.position.clone());
      this.bindQuat.push(b.quaternion.clone());
      this.bindWorld.push(worldPos.get(b.name)!.clone());
    }
  }

  get(name: string) {
    const b = this.byName.get(name);
    if (!b) throw new Error(`Rig: no bone ${name}`);
    return b;
  }
  idx(name: string) {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`Rig: no bone ${name}`);
    return i;
  }
  worldOf(name: string) { return this.bindWorld[this.idx(name)]; }

  /** Reset every bone to its bind transform — called at the top of each frame. */
  resetPose() {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.copy(this.bindPos[i]);
      this.bones[i].quaternion.copy(this.bindQuat[i]);
      this.bones[i].scale.set(1, 1, 1);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Automatic skinning
 * ------------------------------------------------------------------ */

function segDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (l2 > 1e-9) t = clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2);
  const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
  return Math.hypot(p.x - cx, p.y - cy, p.z - cz);
}

/**
 * Assign up to four bone influences per vertex from distance to bone segments.
 * Weights use an inverse-power falloff clipped to each segment's radius, which
 * gives clean shoulders and hips without hand-painting anything.
 */
export function autoSkin(geo: THREE.BufferGeometry, rig: Rig, segments: SkinSegment[]) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const cand: Array<{ i: number; w: number }> = [];

  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(pos, v);
    cand.length = 0;
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const d = segDistance(p, seg.a, seg.b);
      const r = seg.radius;
      if (d > r) continue;
      const t = 1 - d / r;
      const w = Math.pow(t, seg.falloff ?? 2.4) + 1e-5;
      cand.push({ i: rig.idx(seg.bone), w });
    }
    if (cand.length === 0) {
      // fall back to the nearest segment however far away it is
      let best = 0, bestD = Infinity;
      for (let s = 0; s < segments.length; s++) {
        const d = segDistance(p, segments[s].a, segments[s].b);
        if (d < bestD) { bestD = d; best = s; }
      }
      cand.push({ i: rig.idx(segments[best].bone), w: 1 });
    }
    // merge duplicates by bone
    const merged = new Map<number, number>();
    for (const c of cand) merged.set(c.i, (merged.get(c.i) ?? 0) + c.w);
    const list = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0;
    for (const [, w] of list) sum += w;
    for (let k = 0; k < 4; k++) {
      if (k < list.length) {
        skinIndex[v * 4 + k] = list[k][0];
        skinWeight[v * 4 + k] = list[k][1] / sum;
      }
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  return geo;
}

/** Bind a whole geometry rigidly to one bone (armour plates, weapons). */
export function rigidSkin(geo: THREE.BufferGeometry, rig: Rig, bone: string) {
  const n = geo.getAttribute('position').count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const bi = rig.idx(bone);
  for (let v = 0; v < n; v++) { si[v * 4] = bi; sw[v * 4] = 1; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

/* ------------------------------------------------------------------ *
 * Pose accumulation
 * ------------------------------------------------------------------ */

export class Pose {
  rot: Float32Array;
  pos: Float32Array;
  wsum: Float32Array;
  private count: number;

  constructor(boneCount: number) {
    this.count = boneCount;
    this.rot = new Float32Array(boneCount * 3);
    this.pos = new Float32Array(boneCount * 3);
    this.wsum = new Float32Array(boneCount);
  }

  clear() {
    this.rot.fill(0);
    this.pos.fill(0);
    this.wsum.fill(0);
  }

  /** Weighted-average contribution (used by blended state animations). */
  add(bone: number, rx: number, ry: number, rz: number, w = 1) {
    const i = bone * 3;
    this.rot[i] += rx * w;
    this.rot[i + 1] += ry * w;
    this.rot[i + 2] += rz * w;
    this.wsum[bone] += w;
  }

  addPos(bone: number, x: number, y: number, z: number, w = 1) {
    const i = bone * 3;
    this.pos[i] += x * w;
    this.pos[i + 1] += y * w;
    this.pos[i + 2] += z * w;
  }

  /** Additive layer — bypasses the weight average entirely. */
  layer(bone: number, rx: number, ry: number, rz: number, w = 1) {
    const i = bone * 3;
    const s = this.wsum[bone] > 0 ? this.wsum[bone] : 1;
    this.rot[i] += rx * w * s;
    this.rot[i + 1] += ry * w * s;
    this.rot[i + 2] += rz * w * s;
  }

  normalize() {
    for (let b = 0; b < this.count; b++) {
      const w = this.wsum[b];
      if (w > 1e-5 && Math.abs(w - 1) > 1e-4) {
        this.rot[b * 3] /= w;
        this.rot[b * 3 + 1] /= w;
        this.rot[b * 3 + 2] /= w;
      }
    }
  }

  applyTo(rig: Rig) {
    const e = _euler;
    const q = _quat;
    for (let b = 0; b < this.count; b++) {
      const bone = rig.bones[b];
      const i = b * 3;
      e.set(this.rot[i], this.rot[i + 1], this.rot[i + 2], 'YXZ');
      q.setFromEuler(e);
      bone.quaternion.copy(rig.bindQuat[b]).multiply(q);
      bone.position.set(
        rig.bindPos[b].x + this.pos[i],
        rig.bindPos[b].y + this.pos[i + 1],
        rig.bindPos[b].z + this.pos[i + 2],
      );
    }
  }
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/* ------------------------------------------------------------------ *
 * Two-bone IK — used for foot planting and for the boss's grabbing arm.
 * ------------------------------------------------------------------ */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qq = new THREE.Quaternion();

/**
 * Rotate `upper` and `lower` so that `end` reaches `target` (world space).
 * `poleDir` biases the joint bend direction (knees forward, elbows back).
 */
export function twoBoneIK(
  upper: THREE.Bone, lower: THREE.Bone, end: THREE.Object3D,
  target: THREE.Vector3, poleDir: THREE.Vector3, weight = 1,
) {
  if (weight <= 0.001) return;
  upper.updateWorldMatrix(true, false);
  lower.updateWorldMatrix(false, false);
  end.updateWorldMatrix(false, false);
  _a.setFromMatrixPosition(upper.matrixWorld);
  _b.setFromMatrixPosition(lower.matrixWorld);
  _c.setFromMatrixPosition(end.matrixWorld);

  const lenA = _a.distanceTo(_b);
  const lenB = _b.distanceTo(_c);
  _t.copy(target).sub(_a);
  let dist = _t.length();
  const maxLen = (lenA + lenB) * 0.995;
  const minLen = Math.abs(lenA - lenB) * 1.02 + 1e-4;
  dist = Math.min(Math.max(dist, minLen), maxLen);
  _t.normalize();

  // --- aim the whole chain at the target ---
  const dirCur = _c.clone().sub(_a).normalize();
  _qq.setFromUnitVectors(dirCur, _t);
  applyWorldRotation(upper, _qq, weight);

  // --- bend the joint to reach ---
  upper.updateWorldMatrix(true, false);
  lower.updateWorldMatrix(false, false);
  end.updateWorldMatrix(false, false);
  _b.setFromMatrixPosition(lower.matrixWorld);
  _c.setFromMatrixPosition(end.matrixWorld);

  const cosA = THREE.MathUtils.clamp((lenA * lenA + dist * dist - lenB * lenB) / (2 * lenA * dist), -1, 1);
  const wantA = Math.acos(cosA);
  const curDirUpper = _b.clone().sub(_a).normalize();
  const curA = Math.acos(THREE.MathUtils.clamp(curDirUpper.dot(_t), -1, 1));
  _ax.crossVectors(_t, poleDir).normalize();
  if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0);
  _qq.setFromAxisAngle(_ax, -(wantA - curA) * weight);
  applyWorldRotation(upper, _qq, 1);

  upper.updateWorldMatrix(true, false);
  lower.updateWorldMatrix(false, false);
  end.updateWorldMatrix(false, false);
  _b.setFromMatrixPosition(lower.matrixWorld);
  _c.setFromMatrixPosition(end.matrixWorld);
  const targetWorld = _a.clone().addScaledVector(_t, dist);
  const dCur = _c.clone().sub(_b).normalize();
  const dWant = targetWorld.sub(_b).normalize();
  _qq.setFromUnitVectors(dCur, dWant);
  applyWorldRotation(lower, _qq, weight);
}

/** Compose a world-space rotation onto a bone's local quaternion. */
function applyWorldRotation(bone: THREE.Bone, qWorld: THREE.Quaternion, weight: number) {
  const parent = bone.parent;
  const q = _quat;
  if (weight < 1) {
    q.identity().slerp(qWorld, weight);
  } else {
    q.copy(qWorld);
  }
  if (parent) {
    parent.updateWorldMatrix(true, false);
    _m.copy(parent.matrixWorld);
    const pq = new THREE.Quaternion().setFromRotationMatrix(_m);
    const inv = pq.clone().invert();
    bone.quaternion.premultiply(inv).premultiply(q.clone().multiply(pq));
  } else {
    bone.quaternion.premultiply(q);
  }
}

/* ------------------------------------------------------------------ *
 * Animator: cross-fading state machine over pose-writing functions.
 * ------------------------------------------------------------------ */

export type PoseFn = (pose: Pose, t: number, w: number, ctx: AnimCtx) => void;

export interface AnimCtx {
  /** Normalised planar speed, 0..1 over the sprint range. */
  speed: number;
  /** Signed strafe amount for locked-on movement. */
  strafe: number;
  airborne: number;
  crouch: number;
  time: number;
  /** Phase of the locomotion cycle, 0..1, advanced by distance travelled. */
  gait: number;
  extra: Record<string, number>;
}

interface StateRec {
  fn: PoseFn;
  weight: number;
  target: number;
  time: number;
  /** Seconds to blend in/out. */
  fade: number;
  /** One-shot states unblend themselves when finished. */
  once: boolean;
  duration: number;
}

export class Animator {
  private states = new Map<string, StateRec>();
  private order: string[] = [];
  pose: Pose;
  ctx: AnimCtx = { speed: 0, strafe: 0, airborne: 0, crouch: 0, time: 0, gait: 0, extra: {} };
  current = '';
  /** Name of the running one-shot, if any. */
  action = '';
  actionTime = 0;
  actionDuration = 0;

  constructor(private rig: Rig) {
    this.pose = new Pose(rig.bones.length);
  }

  register(name: string, fn: PoseFn, opts: { fade?: number; once?: boolean; duration?: number } = {}) {
    this.states.set(name, {
      fn, weight: 0, target: 0, time: 0,
      fade: opts.fade ?? 0.16,
      once: opts.once ?? false,
      duration: opts.duration ?? 1,
    });
    this.order.push(name);
  }

  /** Set the looping locomotion state. One-shots layer on top of it. */
  setState(name: string) {
    if (this.current === name) return;
    this.current = name;
    for (const [n, s] of this.states) {
      if (s.once) continue;
      s.target = n === name ? 1 : 0;
    }
  }

  /** Fire a one-shot (attack, roll, hurt). Returns false if unknown. */
  play(name: string, speedScale = 1) {
    const s = this.states.get(name);
    if (!s) return false;
    s.time = 0;
    s.target = 1;
    s.weight = Math.max(s.weight, 0.001);
    this.action = name;
    this.actionTime = 0;
    this.actionDuration = s.duration / speedScale;
    for (const [n, o] of this.states) if (o.once && n !== name) o.target = 0;
    return true;
  }

  stopAction() {
    const s = this.states.get(this.action);
    if (s) s.target = 0;
    this.action = '';
  }

  /** 0..1 through the active one-shot. */
  get actionPhase() {
    return this.actionDuration > 0 ? clamp01(this.actionTime / this.actionDuration) : 1;
  }

  update(dt: number) {
    this.ctx.time += dt;
    if (this.action) {
      this.actionTime += dt;
      const s = this.states.get(this.action)!;
      if (this.actionTime >= this.actionDuration) {
        s.target = 0;
        this.action = '';
      }
    }
    this.pose.clear();
    for (const name of this.order) {
      const s = this.states.get(name)!;
      const rate = 1 - Math.exp(-dt / Math.max(0.016, s.fade));
      s.weight = lerp(s.weight, s.target, rate);
      if (s.weight < 0.0015 && s.target === 0) { s.weight = 0; continue; }
      s.time += dt;
      const t = s.once
        ? (this.action === name ? clamp01(this.actionTime / this.actionDuration) : 1)
        : s.time;
      s.fn(this.pose, t, s.weight, this.ctx);
    }
    this.pose.normalize();
    this.pose.applyTo(this.rig);
  }

  weightOf(name: string) { return this.states.get(name)?.weight ?? 0; }
}
