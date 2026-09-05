/**
 * REALMS — the player controller.
 *
 * Tuned for action-game feel rather than physical accuracy: fast acceleration,
 * short coyote time, buffered jump and attack input, a three-hit combo with
 * root motion and cancel windows, and an i-frame dodge roll. Gravity is
 * asymmetric (heavier on the way down) because it makes jumps read as decisive.
 */

import * as THREE from 'three';
import { Character } from '../chars/character';
import { buildWarrior, type BuiltCharacter } from '../chars/warrior';
import type { Physics } from './physics';
import type { InputFrame } from '../core/input';
import { clamp01, damp, dampAngle, smoothstep } from '../core/math';
import { waterLevelAt } from '../world/water';
import { VOID_Y } from '../world/atlas';

export type PlayerMode = 'locked' | 'free';

export interface PlayerStats {
  hp: number; hpMax: number;
  energy: number; energyMax: number;
  stamina: number; staminaMax: number;
  level: number; xp: number; xpNext: number;
  attack: number; defense: number;
}

export interface AttackEvent {
  index: number;
  heavy: boolean;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  range: number;
  arc: number;
  damage: number;
  knockback: number;
}

const WALK = 5.15;
const SPRINT = 8.6;
const ACCEL_GROUND = 46;
const ACCEL_AIR = 14;
const FRICTION = 15;
const GRAVITY = 26;
const FALL_MULT = 1.55;
const JUMP_V = 9.4;
const COYOTE = 0.13;
const JUMP_BUFFER = 0.16;
const ROLL_TIME = 0.62;
const ROLL_SPEED = 12.4;
const RADIUS = 0.42;
const HEIGHT = 1.82;

export class Player {
  built: BuiltCharacter;
  char: Character;
  group: THREE.Group;

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  private wantYaw = 0;

  grounded = true;
  private coyote = 0;
  private jumpBuf = 0;
  private airTime = 0;
  private lastGroundY = 0;
  private landImpact = 0;

  state: 'idle' | 'move' | 'air' | 'roll' | 'attack' | 'cast' | 'hurt' | 'dead' = 'idle';
  private stateTime = 0;
  private rollDir = new THREE.Vector3(0, 0, -1);
  invulnerable = 0;

  combo = 0;
  private comboWindow = 0;
  private attackBuffered = false;
  private attackHeavyBuffered = false;
  private attackHitDone = false;
  private attackHeavy = false;
  private lungeSpeed = 0;

  stats: PlayerStats = {
    hp: 100, hpMax: 100,
    energy: 100, energyMax: 100,
    stamina: 100, staminaMax: 100,
    level: 1, xp: 0, xpNext: 120,
    attack: 12, defense: 4,
  };

  sprinting = false;
  inWater = 0;
  swimming = false;
  waterY = 0;
  lockTarget: THREE.Object3D | null = null;
  controlEnabled = true;
  /** Blend from the intro pose into gameplay. */
  introHold = 0;

  onAttack: ((e: AttackEvent) => void) | null = null;
  onAbility: ((slot: number) => boolean) | null = null;
  onFootstep: ((foot: number, speed: number) => void) | null = null;
  onJump: (() => void) | null = null;
  onLand: ((impact: number) => void) | null = null;
  onRoll: (() => void) | null = null;
  onDamaged: ((amount: number) => void) | null = null;
  onDeath: (() => void) | null = null;

  private lastFootPhase = 0;
  private _f = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _tmp = new THREE.Vector3();

  constructor(private physics: Physics) {
    this.built = buildWarrior({ key: 'warden' });
    this.char = this.built.character;
    this.group = this.char.group;
    this.char.setGroundSampler((x, z) => this.physics.groundHeight(x, z, this.pos.y + 1, 1e6));
  }

  spawn(x: number, z: number, yaw = 0) {
    const y = this.physics.groundHeight(x, z, 1e5, 1e6);
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = this.wantYaw = yaw;
    this.grounded = true;
    this.state = 'idle';
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get alive() { return this.state !== 'dead'; }

  damage(amount: number, fromDir?: THREE.Vector3) {
    if (this.state === 'dead' || this.invulnerable > 0) return false;
    const reduced = Math.max(1, amount - this.stats.defense * 0.5);
    this.stats.hp = Math.max(0, this.stats.hp - reduced);
    this.onDamaged?.(reduced);
    if (fromDir) {
      this.vel.addScaledVector(fromDir, 4.2);
      this.char.hitLean.set(fromDir.x * 0.5, fromDir.z * 0.5);
    }
    if (this.stats.hp <= 0) {
      this.state = 'dead';
      this.stateTime = 0;
      this.char.anim.play('death');
      this.onDeath?.();
    } else if (this.state !== 'roll') {
      this.state = 'hurt';
      this.stateTime = 0;
      this.char.anim.play('hurt');
      this.invulnerable = 0.35;
    }
    return true;
  }

  heal(n: number) { this.stats.hp = Math.min(this.stats.hpMax, this.stats.hp + n); }

  addXp(n: number) {
    this.stats.xp += n;
    let leveled = 0;
    while (this.stats.xp >= this.stats.xpNext) {
      this.stats.xp -= this.stats.xpNext;
      this.stats.level++;
      this.stats.xpNext = Math.round(this.stats.xpNext * 1.42 + 40);
      this.stats.hpMax += 14;
      this.stats.energyMax += 8;
      this.stats.attack += 2.4;
      this.stats.defense += 1.1;
      this.stats.hp = this.stats.hpMax;
      this.stats.energy = this.stats.energyMax;
      leveled++;
    }
    return leveled;
  }

  update(dt: number, input: InputFrame, camYaw: number) {
    this.stateTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    const active = this.controlEnabled && this.state !== 'dead';

    // ---------- desired direction ----------
    this._f.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    this._r.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    this._dir.set(0, 0, 0);
    if (active) {
      this._dir.addScaledVector(this._f, -input.moveZ).addScaledVector(this._r, input.moveX);
    }
    const inputMag = Math.min(1, this._dir.length());
    if (inputMag > 0.001) this._dir.normalize();

    // ---------- input edges ----------
    if (active) {
      if (input.jump) this.jumpBuf = JUMP_BUFFER;
      if (input.dodge) this.tryRoll();
      if (input.attack) this.queueAttack(false);
      if (input.heavy) this.queueAttack(true);
      if (input.ability1) this.tryAbility(1);
      if (input.ability2) this.tryAbility(2);
      if (input.ability3) this.tryAbility(3);
    }

    // ---------- water ----------
    const wl = waterLevelAt(this.pos.x, this.pos.z);
    this.waterY = wl ?? -9999;
    const submerged = wl !== null ? wl - this.pos.y : -10;
    this.inWater = clamp01(submerged / 1.6);
    this.swimming = submerged > 1.25;

    // ---------- state machine ----------
    let speedTarget = 0;
    this.sprinting = false;

    if (this.state === 'roll') {
      const t = this.stateTime / ROLL_TIME;
      this.invulnerable = Math.max(this.invulnerable, t > 0.08 && t < 0.66 ? 0.05 : 0);
      const push = (1 - smoothstep(0.35, 1.0, t)) * ROLL_SPEED;
      this.vel.x = this.rollDir.x * push;
      this.vel.z = this.rollDir.z * push;
      if (t >= 1) this.state = this.grounded ? 'idle' : 'air';
    } else if (this.state === 'attack') {
      const a = this.char.anim;
      const phase = a.actionPhase;
      // root motion: a short lunge on the strike
      const lunge = this.attackHeavy
        ? smoothstep(0.30, 0.48, phase) * (1 - smoothstep(0.5, 0.75, phase))
        : smoothstep(0.16, 0.36, phase) * (1 - smoothstep(0.38, 0.62, phase));
      const s = lunge * this.lungeSpeed;
      this.vel.x = -Math.sin(this.yaw) * s;
      this.vel.z = -Math.cos(this.yaw) * s;
      const hitAt = this.attackHeavy ? 0.50 : 0.40;
      if (!this.attackHitDone && phase >= hitAt) {
        this.attackHitDone = true;
        this.emitAttack();
      }
      // steer slightly during the swing
      if (inputMag > 0.1 && phase > 0.6) this.wantYaw = Math.atan2(-this._dir.x, -this._dir.z);
      if (phase >= 1 || (phase > 0.55 && (this.attackBuffered || this.attackHeavyBuffered))) {
        if (this.attackBuffered || this.attackHeavyBuffered) {
          const heavy = this.attackHeavyBuffered;
          this.attackBuffered = this.attackHeavyBuffered = false;
          this.startAttack(heavy);
        } else {
          this.state = this.grounded ? 'idle' : 'air';
          this.combo = 0;
        }
      }
    } else if (this.state === 'cast') {
      if (this.char.anim.actionPhase >= 1) this.state = this.grounded ? 'idle' : 'air';
      this.vel.x *= Math.exp(-dt * 8);
      this.vel.z *= Math.exp(-dt * 8);
    } else if (this.state === 'hurt') {
      if (this.char.anim.actionPhase >= 1) this.state = this.grounded ? 'idle' : 'air';
    } else if (this.state === 'dead') {
      this.vel.x *= Math.exp(-dt * 6);
      this.vel.z *= Math.exp(-dt * 6);
    } else {
      // free movement
      const wantSprint = input.sprint && inputMag > 0.4 && this.stats.stamina > 1 && !this.swimming;
      this.sprinting = wantSprint;
      const base = this.swimming ? 3.6 : WALK;
      speedTarget = inputMag * (wantSprint ? SPRINT : base);
      if (this.lockTarget && !wantSprint) speedTarget *= 0.92;
      if (inputMag > 0.05) this.wantYaw = Math.atan2(-this._dir.x, -this._dir.z);
      if (this.lockTarget) {
        const t = this.lockTarget.position;
        this.wantYaw = Math.atan2(-(t.x - this.pos.x), -(t.z - this.pos.z));
      }
      this.state = inputMag > 0.05 ? 'move' : 'idle';
      if (!this.grounded) this.state = 'air';
    }

    // stamina
    if (this.sprinting) this.stats.stamina = Math.max(0, this.stats.stamina - dt * 17);
    else this.stats.stamina = Math.min(this.stats.staminaMax, this.stats.stamina + dt * (this.state === 'idle' ? 32 : 19));
    this.stats.energy = Math.min(this.stats.energyMax, this.stats.energy + dt * 4.2);

    // ---------- jump ----------
    if (this.grounded) this.coyote = COYOTE;
    else this.coyote = Math.max(0, this.coyote - dt);

    const canAct = this.state === 'idle' || this.state === 'move' || this.state === 'air';
    if (this.jumpBuf > 0 && this.coyote > 0 && canAct && !this.swimming) {
      this.vel.y = JUMP_V;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.grounded = false;
      this.airTime = 0;
      this.char.anim.setState('jump');
      this.onJump?.();
    }
    if (this.swimming && this.jumpBuf > 0) {
      this.vel.y = Math.max(this.vel.y, 4.2);
      this.jumpBuf = 0;
    }

    // ---------- integrate ----------
    const accel = this.grounded ? ACCEL_GROUND : ACCEL_AIR;
    if (this.state !== 'roll' && this.state !== 'attack') {
      const tx = this._dir.x * speedTarget;
      const tz = this._dir.z * speedTarget;
      this.vel.x = damp(this.vel.x, tx, accel / Math.max(1, Math.abs(this.vel.x - tx) * 0.15 + 1), dt);
      this.vel.z = damp(this.vel.z, tz, accel / Math.max(1, Math.abs(this.vel.z - tz) * 0.15 + 1), dt);
      if (inputMag < 0.05 && this.grounded) {
        const f = Math.exp(-FRICTION * dt);
        this.vel.x *= f;
        this.vel.z *= f;
      }
    }

    // gravity
    if (this.swimming) {
      const targetY = this.waterY - 0.9;
      this.vel.y = damp(this.vel.y, (targetY - this.pos.y) * 3.2, 6, dt);
    } else {
      const g = this.vel.y < 0 ? GRAVITY * FALL_MULT : GRAVITY;
      this.vel.y -= g * dt * (this.inWater > 0.4 ? 0.4 : 1);
      if (this.vel.y < -62) this.vel.y = -62;
    }

    this.pos.addScaledVector(this.vel, dt);

    // ---------- collide ----------
    const pushed = this.physics.resolve(this.pos, RADIUS, HEIGHT);
    if (pushed) {
      // kill velocity into the wall so we slide instead of sticking
      this.vel.x *= 0.35;
      this.vel.z *= 0.35;
    }

    const gh = this.physics.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.75);
    const wasGrounded = this.grounded;
    if (this.pos.y <= gh + 0.02 && this.vel.y <= 0.01) {
      // steep slopes are not standable — slide
      const slope = this.physics.slopeAt(this.pos.x, this.pos.z);
      this.pos.y = gh;
      this.vel.y = 0;
      this.grounded = true;
      if (slope > 0.68) {
        this.physics.normalAt(this.pos.x, this.pos.z, this._tmp);
        this.vel.x += this._tmp.x * 34 * dt;
        this.vel.z += this._tmp.z * 34 * dt;
      }
    } else {
      this.grounded = false;
    }

    if (this.grounded) {
      if (!wasGrounded) {
        const drop = Math.max(0, this.lastGroundY - this.pos.y);
        this.landImpact = clamp01((drop - 2.5) / 12);
        if (this.airTime > 0.22) {
          this.char.anim.play('land');
          this.onLand?.(this.landImpact);
        }
        if (drop > 11 && !this.swimming && this.inWater < 0.3) {
          this.damage(Math.min(70, (drop - 11) * 4.2));
        }
        this.airTime = 0;
      }
      this.lastGroundY = this.pos.y;
    } else {
      this.airTime += dt;
    }

    // fell off the shelf
    if (this.pos.y < VOID_Y - 60 && this.state !== 'dead') {
      this.damage(9999);
    }

    // ---------- orientation ----------
    const turnRate = this.state === 'roll' ? 3 : this.lockTarget ? 16 : 13;
    this.yaw = dampAngle(this.yaw, this.wantYaw, turnRate, dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // ---------- animation ----------
    this.driveAnimation(dt, inputMag, camYaw);
  }

  private driveAnimation(dt: number, inputMag: number, camYaw: number) {
    const a = this.char.anim;
    const sp = this.speed;
    this.char.velocity.copy(this.vel);
    this.char.grounded = this.grounded ? 1 : 0;
    this.char.advanceGait(dt, this.grounded ? sp : 0);

    if (this.state === 'dead') {
      // handled by the one-shot
    } else if (this.state === 'roll' || this.state === 'attack' || this.state === 'cast' || this.state === 'hurt') {
      // one-shot drives the upper body; keep the base state sensible underneath
      a.setState(sp > 0.4 ? (sp > 6.4 ? 'sprint' : 'walk') : 'idle');
    } else if (!this.grounded) {
      a.ctx.extra.rise = clamp01(this.vel.y / JUMP_V);
      a.setState(this.vel.y > 0.6 ? 'jump' : 'fall');
    } else if (sp > 0.35) {
      if (this.lockTarget && sp < 6.2 && Math.abs(this.char.anim.ctx.strafe) > 0.3) a.setState('strafe');
      else if (sp > 6.6) a.setState('sprint');
      else if (sp > 3.1) a.setState('run');
      else a.setState('walk');
    } else {
      a.setState('idle');
    }

    // strafe amount for the locked-on shuffle
    const rel = Math.atan2(-this.vel.x, -this.vel.z) - this.yaw;
    a.ctx.strafe = sp > 0.4 ? Math.sin(rel) : 0;

    // footstep events on gait crossings
    if (this.grounded && sp > 0.6) {
      const phase = this.char.gait;
      const crossed = (this.lastFootPhase < 0.25 && phase >= 0.25) || (this.lastFootPhase < 0.75 && phase >= 0.75);
      if (crossed) this.onFootstep?.(phase < 0.5 ? 0 : 1, sp);
      if (phase < this.lastFootPhase) {
        // wrapped
        if (this.lastFootPhase < 0.75) this.onFootstep?.(1, sp);
      }
      this.lastFootPhase = phase;
    }

    // look toward the lock target, else level with the camera
    if (this.lockTarget) {
      this.char.lookTarget = this.lockTarget.position;
      this.char.lookWeight = damp(this.char.lookWeight, 0.85, 6, dt);
    } else {
      this.char.lookWeight = damp(this.char.lookWeight, this.state === 'idle' ? 0.35 : 0.12, 3, dt);
      if (!this.char.lookTarget) this.char.lookTarget = new THREE.Vector3();
      this.char.lookTarget.set(
        this.pos.x - Math.sin(camYaw) * 14,
        this.pos.y + 1.7,
        this.pos.z - Math.cos(camYaw) * 14,
      );
    }
    void inputMag;

    this.char.update(dt, {
      speed01: clamp01(sp / SPRINT),
      strafe: a.ctx.strafe,
      airborne: this.grounded ? 0 : 1,
    });
  }

  /* ---------------- actions ---------------- */

  private tryRoll() {
    if (this.state === 'roll' || this.state === 'dead' || this.state === 'hurt') return;
    if (this.stats.stamina < 18) return;
    if (this.swimming) return;
    this.stats.stamina -= 18;
    this.state = 'roll';
    this.stateTime = 0;
    this.combo = 0;
    this.rollDir.set(-Math.sin(this.wantYaw), 0, -Math.cos(this.wantYaw));
    this.yaw = this.wantYaw;
    this.char.anim.play('roll');
    this.invulnerable = 0.45;
    this.onRoll?.();
  }

  private queueAttack(heavy: boolean) {
    if (this.state === 'dead' || this.state === 'roll') return;
    if (this.state === 'attack') {
      if (this.char.anim.actionPhase > 0.30) {
        if (heavy) this.attackHeavyBuffered = true; else this.attackBuffered = true;
      }
      return;
    }
    if (this.state === 'cast' || this.state === 'hurt') return;
    this.startAttack(heavy);
  }

  private startAttack(heavy: boolean) {
    this.state = 'attack';
    this.stateTime = 0;
    this.attackHitDone = false;
    this.attackHeavy = heavy;
    if (this.comboWindow <= 0) this.combo = 0;
    if (heavy) {
      this.char.anim.play('attack3');
      this.lungeSpeed = 7.0;
      this.combo = 2;
    } else {
      this.combo = this.combo % 2;
      this.char.anim.play(this.combo === 0 ? 'attack1' : 'attack2');
      this.lungeSpeed = this.combo === 0 ? 5.4 : 6.2;
      this.combo++;
    }
    this.comboWindow = 1.15;
    if (this.grounded) this.yaw = this.wantYaw;
  }

  private emitAttack() {
    const heavy = this.attackHeavy;
    const e: AttackEvent = {
      index: this.combo,
      heavy,
      origin: this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)),
      dir: new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
      range: heavy ? 3.5 : 2.9,
      arc: heavy ? 1.5 : 1.9,
      damage: this.stats.attack * (heavy ? 2.15 : 1) * (this.combo === 2 ? 1.25 : 1),
      knockback: heavy ? 9 : 4.5,
    };
    this.onAttack?.(e);
  }

  private tryAbility(slot: number) {
    if (this.state === 'dead' || this.state === 'roll' || this.state === 'attack') return;
    if (!this.onAbility) return;
    if (this.onAbility(slot)) {
      this.state = 'cast';
      this.stateTime = 0;
      this.char.anim.play('cast');
    }
  }

  /** Snap the model to a pose for the opening shot. */
  setIntroPose(yaw: number) {
    this.yaw = this.wantYaw = yaw;
    this.group.rotation.y = yaw;
    this.char.anim.setState('idle');
  }
}

export { WALK as PLAYER_WALK, SPRINT as PLAYER_SPRINT, RADIUS as PLAYER_RADIUS, HEIGHT as PLAYER_HEIGHT };
