/**
 * REALMS — the Character wrapper.
 *
 * Binds a skinned mesh, its rig and its animator together, and runs the
 * per-frame extras that make procedural animation read as real motion: gait
 * phase driven by distance travelled (so footfalls never skate), terrain foot
 * IK, look-at, hit lean, and a cloak driven by velocity.
 */

import * as THREE from 'three';
import { Animator, Rig, twoBoneIK } from './rig';
import { boneIds, type BoneIds } from './humanoid';
import { clamp01, damp, lerp, smoothstep } from '../core/math';

export interface CharacterOpts {
  footIK?: boolean;
  /** Height of the hip above the root, used to keep IK sane. */
  scale?: number;
  castShadow?: boolean;
}

export class Character {
  group = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  rig: Rig;
  anim: Animator;
  bones: BoneIds;
  scale: number;

  /** World-space velocity, set by whatever drives this character. */
  velocity = new THREE.Vector3();
  grounded = 1;
  /** Optional world point the head turns toward. */
  lookTarget: THREE.Vector3 | null = null;
  lookWeight = 0;
  private lookYaw = 0;
  private lookPitch = 0;

  footIK: boolean;
  private footRayHeight: ((x: number, z: number) => number) | null = null;
  private footPlant = [0, 0];
  private ikTarget = new THREE.Vector3();
  private ikPole = new THREE.Vector3();
  private _v = new THREE.Vector3();
  private _localVel = new THREE.Vector3();

  gait = 0;
  /** Distance-per-cycle in metres; smaller = faster leg turnover. */
  strideLength = 1.85;

  hitLean = new THREE.Vector2();
  private cloakVel = new THREE.Vector3();

  constructor(mesh: THREE.SkinnedMesh, rig: Rig, opts: CharacterOpts = {}) {
    this.mesh = mesh;
    this.rig = rig;
    this.anim = new Animator(rig);
    this.bones = boneIds(rig);
    this.scale = opts.scale ?? 1;
    this.footIK = opts.footIK ?? false;
    this.group.add(rig.root);
    this.group.add(mesh);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  }

  setGroundSampler(fn: (x: number, z: number) => number) {
    this.footRayHeight = fn;
  }

  /** Advance the locomotion phase by distance rather than by time. */
  advanceGait(dt: number, planarSpeed: number) {
    const cycles = (planarSpeed * dt) / (this.strideLength * this.scale);
    this.gait = (this.gait + cycles) % 1;
    if (planarSpeed < 0.05) {
      // ease back to a neutral stance instead of freezing mid-stride
      const target = this.gait < 0.5 ? 0 : 1;
      this.gait = lerp(this.gait, target, 1 - Math.exp(-dt * 6));
      if (this.gait > 0.999) this.gait = 0;
    }
  }

  update(dt: number, opts: { speed01?: number; strafe?: number; airborne?: number } = {}) {
    const ctx = this.anim.ctx;
    ctx.speed = opts.speed01 ?? 0;
    ctx.strafe = opts.strafe ?? 0;
    ctx.airborne = opts.airborne ?? 0;
    ctx.gait = this.gait;
    this.anim.update(dt);

    // --- additive look-at ---
    if (this.lookTarget && this.lookWeight > 0.01) {
      this.group.updateMatrixWorld(true);
      this._v.copy(this.lookTarget);
      this.group.worldToLocal(this._v);
      const yaw = Math.atan2(-this._v.x, -this._v.z);
      const dist = Math.hypot(this._v.x, this._v.z);
      const pitch = Math.atan2(this._v.y - 1.55 * this.scale, dist);
      this.lookYaw = damp(this.lookYaw, THREE.MathUtils.clamp(yaw, -1.15, 1.15), 8, dt);
      this.lookPitch = damp(this.lookPitch, THREE.MathUtils.clamp(pitch, -0.6, 0.55), 8, dt);
    } else {
      this.lookYaw = damp(this.lookYaw, 0, 6, dt);
      this.lookPitch = damp(this.lookPitch, 0, 6, dt);
    }
    const lw = this.lookWeight;
    const B = this.bones;
    const applyExtra = (bone: number, rx: number, ry: number, rz: number) => {
      this.rig.bones[bone].rotateY(ry);
      this.rig.bones[bone].rotateX(rx);
      this.rig.bones[bone].rotateZ(rz);
    };
    if (lw > 0.01) {
      applyExtra(B.head, -this.lookPitch * 0.62 * lw, this.lookYaw * 0.6 * lw, 0);
      applyExtra(B.neck, -this.lookPitch * 0.30 * lw, this.lookYaw * 0.26 * lw, 0);
      applyExtra(B.chest, 0, this.lookYaw * 0.14 * lw, 0);
    }

    // --- hit lean (decays on its own) ---
    if (this.hitLean.lengthSq() > 1e-5) {
      applyExtra(B.spine, this.hitLean.y * 0.5, 0, this.hitLean.x * 0.5);
      applyExtra(B.chest, this.hitLean.y * 0.35, 0, this.hitLean.x * 0.35);
      this.hitLean.multiplyScalar(Math.exp(-dt * 7));
    }

    // --- cloak: swing away from motion ---
    this._localVel.copy(this.velocity);
    const inv = this.group.quaternion.clone().invert();
    this._localVel.applyQuaternion(inv);
    this.cloakVel.lerp(this._localVel, 1 - Math.exp(-dt * 7));
    const cf = clamp01(this.cloakVel.length() / 9);
    for (let i = 0; i < B.cloak.length; i++) {
      const f = (i + 1) / B.cloak.length;
      const bone = this.rig.bones[B.cloak[i]];
      bone.rotateX(this.cloakVel.z * 0.055 * f + cf * 0.30 * f);
      bone.rotateZ(-this.cloakVel.x * 0.045 * f);
      bone.rotateY(Math.sin(this.anim.ctx.time * 2.1 + i * 0.9) * 0.035 * (0.3 + cf));
    }

    // --- foot IK ---
    if (this.footIK && this.footRayHeight) this.solveFeet(dt);
  }

  private solveFeet(dt: number) {
    this.group.updateMatrixWorld(true);
    const sides = [
      { up: 'upperLegL', lo: 'lowerLegL', ft: 'footL', i: 0 },
      { up: 'upperLegR', lo: 'lowerLegR', ft: 'footR', i: 1 },
    ];
    const ground = this.footRayHeight!;
    const rootY = this.group.position.y;
    for (const s of sides) {
      const foot = this.rig.get(s.ft);
      foot.updateWorldMatrix(true, false);
      this._v.setFromMatrixPosition(foot.matrixWorld);
      const h = ground(this._v.x, this._v.z);
      const ankle = 0.105 * this.scale;
      const want = h + ankle;
      // only lift, never sink, and only while the foot is near the ground
      const nearness = 1 - smoothstep(0.05, 0.45 * this.scale, this._v.y - rootY);
      const strength = clamp01(nearness) * this.grounded;
      this.footPlant[s.i] = damp(this.footPlant[s.i], strength, 14, dt);
      const wgt = this.footPlant[s.i] * 0.85;
      if (wgt < 0.02) continue;
      // only correct small deltas; a large one means the sampler is wrong or the
      // character is mid-air, and yanking the legs there looks broken
      if (want <= this._v.y - 0.35 * this.scale) continue;
      if (want > this._v.y + 0.55 * this.scale) continue;
      this.ikTarget.set(this._v.x, Math.max(this._v.y, want), this._v.z);
      this.ikPole.set(0, 0, -1).applyQuaternion(this.group.quaternion);
      twoBoneIK(this.rig.get(s.up), this.rig.get(s.lo), foot, this.ikTarget, this.ikPole, wgt);
    }
  }

  /** World position of a named bone. */
  bonePos(name: string, out = new THREE.Vector3()) {
    const b = this.rig.get(name);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  dispose() {
    this.mesh.geometry.dispose();
    const m = this.mesh.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m.dispose();
  }
}
