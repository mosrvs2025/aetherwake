/**
 * REALMS — the follow camera.
 *
 * A spring arm with terrain- and prop-aware collision, plus the small
 * cinematic tricks that make third-person movement feel good: the arm lags
 * behind acceleration, the FOV widens with speed, the frame rolls very
 * slightly into strafes, impacts add decaying shake, and locking on reframes
 * the shot so both fighters stay in view.
 */

import * as THREE from 'three';
import { clamp01, damp, dampAngle, lerp, smoothstep } from '../core/math';
import type { Physics } from './physics';

export interface CameraTuning {
  distance: number;
  minDistance: number;
  maxDistance: number;
  height: number;
  shoulder: number;
  pitchMin: number;
  pitchMax: number;
  fov: number;
  sprintFov: number;
}

const DEFAULT: CameraTuning = {
  distance: 6.4,
  minDistance: 1.9,
  maxDistance: 12.5,
  height: 1.62,
  shoulder: 0.62,
  pitchMin: -0.92,
  pitchMax: 0.62,
  fov: 58,
  sprintFov: 66,
};

export class FollowCamera {
  camera: THREE.PerspectiveCamera;
  tuning: CameraTuning = { ...DEFAULT };
  yaw = 0;
  pitch = -0.14;
  distance = DEFAULT.distance;
  private wantDistance = DEFAULT.distance;
  private curDistance = DEFAULT.distance;
  private pos = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private smoothFocus = new THREE.Vector3();
  private shake = 0;
  private shakeFreq = 34;
  private shakeSeed = Math.random() * 100;
  private roll = 0;
  private fovCur = DEFAULT.fov;
  private _v = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler(0, 0, 0, 'YXZ');
  /** 0 = gameplay, 1 = fully scripted (intro, cutscenes). */
  cinematic = 0;
  cinematicPos = new THREE.Vector3();
  cinematicLook = new THREE.Vector3();
  cinematicFov = 42;
  lockTarget: THREE.Vector3 | null = null;

  constructor(camera: THREE.PerspectiveCamera, private physics: Physics) {
    this.camera = camera;
    this.smoothFocus.set(0, 0, 0);
  }

  addShake(amount: number, freq = 34) {
    this.shake = Math.min(1.6, this.shake + amount);
    this.shakeFreq = freq;
  }

  orbit(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, this.tuning.pitchMin, this.tuning.pitchMax);
  }

  zoom(delta: number) {
    this.wantDistance = THREE.MathUtils.clamp(
      this.wantDistance + delta,
      this.tuning.minDistance + 0.4,
      this.tuning.maxDistance,
    );
  }

  /** Snap the arm behind the character — used when control is handed over. */
  snapBehind(targetYaw: number) {
    this.yaw = targetYaw;
    this.curDistance = this.wantDistance;
  }

  /** Place the rig instantly, with no interpolation, at a target. */
  reset(target: THREE.Vector3, yaw: number, pitch = -0.08) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.smoothFocus.copy(target);
    this.smoothFocus.y += this.tuning.height;
    this.curDistance = this.wantDistance;
    this._e.set(this.pitch, this.yaw, 0);
    this._q.setFromEuler(this._e);
    this._v.set(0, 0, this.curDistance).applyQuaternion(this._q);
    this.pos.copy(this.smoothFocus).add(this._v);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.smoothFocus);
  }

  update(dt: number, target: THREE.Vector3, opts: {
    speed01: number; sprinting: boolean; strafe: number; airborne: boolean; dead: boolean;
  }) {
    const T = this.tuning;

    // ---- focus point: hips height, lagging slightly behind fast motion ----
    this.focus.copy(target);
    this.focus.y += T.height;
    const follow = opts.dead ? 2.2 : lerp(9.5, 6.0, clamp01(opts.speed01));
    this.smoothFocus.x = damp(this.smoothFocus.x, this.focus.x, follow, dt);
    this.smoothFocus.y = damp(this.smoothFocus.y, this.focus.y, follow * 0.72, dt);
    this.smoothFocus.z = damp(this.smoothFocus.z, this.focus.z, follow, dt);

    // ---- lock-on reframing ----
    let yaw = this.yaw, pitch = this.pitch;
    if (this.lockTarget) {
      const dx = this.lockTarget.x - target.x;
      const dz = this.lockTarget.z - target.z;
      const want = Math.atan2(dx, dz) + Math.PI;
      this.yaw = dampAngle(this.yaw, want, 6.5, dt);
      const dist = Math.hypot(dx, dz);
      const wantPitch = THREE.MathUtils.clamp(-0.10 - smoothstep(3, 16, dist) * 0.16, T.pitchMin, T.pitchMax);
      this.pitch = damp(this.pitch, wantPitch, 4, dt);
      yaw = this.yaw; pitch = this.pitch;
    }

    // ---- arm length with collision ----
    const wantDist = this.wantDistance * (this.lockTarget ? 1.12 : 1) * (opts.airborne ? 1.06 : 1);
    this._e.set(pitch, yaw, 0);
    this._q.setFromEuler(this._e);
    this._v.set(T.shoulder, 0, wantDist).applyQuaternion(this._q);
    const desired = this._v.clone().add(this.smoothFocus);
    const frac = this.physics.rayFraction(this.smoothFocus, desired, 14, 0.45);
    const collided = Math.max(T.minDistance / Math.max(wantDist, 0.001), frac);
    const targetDist = wantDist * collided;
    // snap in fast, ease out slowly, so corners do not fling the camera
    const rate = targetDist < this.curDistance ? 26 : 6.5;
    this.curDistance = damp(this.curDistance, targetDist, rate, dt);
    this.distance = this.curDistance;

    this._v.set(T.shoulder * clamp01(this.curDistance / 3), 0, this.curDistance).applyQuaternion(this._q);
    this.pos.copy(this.smoothFocus).add(this._v);

    // never let the camera end up under the world
    const gh = this.physics.groundHeight(this.pos.x, this.pos.z, this.pos.y, 1e6) + 0.55;
    if (this.pos.y < gh) this.pos.y = gh;

    // ---- shake ----
    if (this.shake > 0.0005) {
      const t = performance.now() * 0.001 * this.shakeFreq + this.shakeSeed;
      const amp = this.shake * this.shake * 0.42;
      this.pos.x += Math.sin(t * 1.7) * amp;
      this.pos.y += Math.sin(t * 2.3 + 1.1) * amp;
      this.pos.z += Math.sin(t * 1.3 + 2.7) * amp;
      this.roll += Math.sin(t * 1.9) * amp * 0.06;
      this.shake *= Math.exp(-dt * 5.5);
    }

    // ---- cinematic override ----
    if (this.cinematic > 0.001) {
      this.pos.lerp(this.cinematicPos, this.cinematic);
    }

    this.camera.position.copy(this.pos);
    const lookAt = this.cinematic > 0.001
      ? this._v.copy(this.smoothFocus).lerp(this.cinematicLook, this.cinematic)
      : this.smoothFocus;
    this.camera.lookAt(lookAt);

    // ---- roll + fov ----
    const wantRoll = -opts.strafe * 0.022 * clamp01(opts.speed01);
    this.roll = damp(this.roll, wantRoll, 5, dt);
    this.camera.rotateZ(this.roll);

    const wantFov = this.cinematic > 0.001
      ? lerp(T.fov, this.cinematicFov, this.cinematic)
      : lerp(T.fov, T.sprintFov, opts.sprinting ? clamp01(opts.speed01) : 0);
    this.fovCur = damp(this.fovCur, wantFov, 4.5, dt);
    if (Math.abs(this.camera.fov - this.fovCur) > 0.01) {
      this.camera.fov = this.fovCur;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Camera-space forward/right on the horizontal plane, for movement input. */
  basis(outForward: THREE.Vector3, outRight: THREE.Vector3) {
    outForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    outRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
}
