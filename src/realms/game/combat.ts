/**
 * REALMS — enemies, AI and combat resolution.
 *
 * Grunts run a small state machine (idle → alert → chase → circle → windup →
 * strike → recover, plus stagger and death) with a shared aggro budget so a
 * pack surrounds you instead of all swinging at once. Every attack has a
 * readable windup, and damage is resolved from the animation phase rather than
 * from a timer, so what you see is what hits you.
 *
 * The Warden of the Fall is the same machine with three phases, telegraphed
 * heavy attacks and a summon.
 */

import * as THREE from 'three';
import { buildEnemy, Riftwisp, type EnemyKind } from '../chars/enemies';
import type { Character } from '../chars/character';
import type { Physics } from './physics';
import type { Fx } from './fx';
import type { Player, AttackEvent } from './player';
import { clamp01, damp, dampAngle, lerp, Random, smoothstep } from '../core/math';
import { audio } from '../core/audio';
import { WRAITH, AETHER, EMBER } from '../chars/materials';

export type EnemyState =
  | 'dormant' | 'idle' | 'alert' | 'chase' | 'circle'
  | 'windup' | 'strike' | 'recover' | 'stagger' | 'dead';

export interface EnemyDef {
  kind: EnemyKind;
  hp: number;
  damage: number;
  speed: number;
  chaseSpeed: number;
  attackRange: number;
  aggroRange: number;
  xp: number;
  name: string;
  poise: number;
  scale: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  husk: { kind: 'husk', hp: 62, damage: 11, speed: 1.9, chaseSpeed: 4.4, attackRange: 2.4, aggroRange: 22, xp: 34, name: 'Husk of the Fall', poise: 26, scale: 1 },
  stalker: { kind: 'stalker', hp: 46, damage: 15, speed: 2.6, chaseSpeed: 6.6, attackRange: 2.8, aggroRange: 30, xp: 46, name: 'Ashen Stalker', poise: 16, scale: 1 },
  wisp: { kind: 'wisp', hp: 30, damage: 9, speed: 2.4, chaseSpeed: 4.0, attackRange: 8.5, aggroRange: 26, xp: 28, name: 'Riftwisp', poise: 8, scale: 1 },
  warden: { kind: 'warden', hp: 1750, damage: 34, speed: 2.2, chaseSpeed: 5.6, attackRange: 5.4, aggroRange: 40, xp: 1200, name: 'The Warden of the Fall', poise: 240, scale: 1 },
};

export interface DamageEvent {
  amount: number;
  x: number; y: number; z: number;
  crit: boolean;
  toPlayer: boolean;
  kind: 'physical' | 'aether' | 'fire';
}

let nextId = 1;

export class Enemy {
  id = nextId++;
  def: EnemyDef;
  kind: EnemyKind;
  character: Character | null = null;
  wisp: Riftwisp | null = null;
  group: THREE.Group;
  weaponTip: THREE.Object3D | null = null;

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  home = new THREE.Vector3();
  yaw = 0;
  wantYaw = 0;
  hp: number;
  hpMax: number;
  poise: number;
  state: EnemyState = 'dormant';
  stateTime = 0;
  attackKind = 0;
  grounded = true;
  active = false;
  dead = false;
  deadTime = 0;
  hitDone = false;
  aggro = false;
  aggroSlot = -1;
  lastHitTime = -99;
  flash = 0;
  height: number;
  radius: number;
  scale: number;
  /** Boss-only. */
  phase = 1;
  summonedAt = 0;

  wanderTarget = new THREE.Vector3();
  wanderTimer = 0;
  private rng: Random;

  constructor(kind: EnemyKind, x: number, z: number, physics: Physics, seed = Math.random() * 1e6) {
    this.kind = kind;
    this.def = ENEMY_DEFS[kind];
    this.hp = this.hpMax = this.def.hp;
    this.poise = this.def.poise;
    this.rng = new Random(seed);
    this.scale = this.def.scale;

    if (kind === 'wisp') {
      this.wisp = new Riftwisp();
      this.group = this.wisp.group;
      this.height = 1.4;
      this.radius = 0.55;
    } else {
      const built = buildEnemy(kind)!;
      this.character = built.character;
      this.group = built.character.group;
      this.weaponTip = built.weaponTip;
      this.height = built.height;
      this.radius = built.radius;
      this.character.setGroundSampler((gx, gz) => physics.groundHeight(gx, gz, this.pos.y + 1.5, 1e6));
    }
    const y = physics.groundHeight(x, z, 1e5, 1e6);
    this.pos.set(x, y, z);
    this.home.set(x, y, z);
    this.wanderTarget.copy(this.home);
    this.group.position.copy(this.pos);
    this.group.visible = false;
    this.yaw = this.wantYaw = this.rng.angle();
  }

  get eyeY() { return this.pos.y + this.height * 0.82; }

  distanceTo(p: THREE.Vector3) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  faceTowards(x: number, z: number) {
    this.wantYaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
  }

  /** Returns true if the enemy died from this hit. */
  damage(amount: number, fromX: number, fromZ: number, knockback: number, fx: Fx, now: number): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.flash = 1;
    this.lastHitTime = now;
    this.aggro = true;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * knockback;
    this.vel.z += (dz / d) * knockback;
    const color = this.kind === 'stalker' ? EMBER : this.kind === 'warden' ? AETHER : WRAITH;
    fx.hitSpark(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z, dx / d, dz / d, 1, color);
    fx.bloodBurst(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z, dx / d, dz / d, color.clone().multiplyScalar(0.6));

    this.poise -= amount;
    if (this.hp <= 0) {
      this.die(fx);
      return true;
    }
    if (this.poise <= 0 && this.state !== 'strike') {
      this.poise = this.def.poise;
      this.state = 'stagger';
      this.stateTime = 0;
      this.character?.anim.play('hurt');
      if (this.character) this.character.hitLean.set((dx / d) * 0.8, (dz / d) * 0.8);
    }
    return false;
  }

  die(fx: Fx) {
    this.dead = true;
    this.deadTime = 0;
    this.state = 'dead';
    this.character?.anim.play('death');
    const color = this.kind === 'stalker' ? EMBER : this.kind === 'warden' ? AETHER : WRAITH;
    fx.dissolve(this.pos.x, this.pos.y, this.pos.z, this.radius * 1.6, color);
    audio.sfx(this.kind === 'warden' ? 'bossRoar' : 'enemyDeath', this.kind === 'warden' ? 1 : 0.7);
  }

  dispose() {
    this.character?.dispose();
    this.wisp?.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * The combat director
 * ------------------------------------------------------------------ */

export interface CombatCallbacks {
  onDamage: (e: DamageEvent) => void;
  onKill: (e: Enemy) => void;
  onBossPhase: (phase: number) => void;
  onPlayerHit: (amount: number) => void;
}

const MAX_ATTACKERS = 2;

export class Combat {
  enemies: Enemy[] = [];
  group = new THREE.Group();
  boss: Enemy | null = null;
  bossActive = false;
  /** Set true once the arena is entered; drives music and the HUD bar. */
  private attackerSlots: Array<number | null> = [null, null];
  private time = 0;
  private _v = new THREE.Vector3();

  constructor(
    private physics: Physics,
    private fx: Fx,
    private cb: CombatCallbacks,
  ) {
    this.group.name = 'enemies';
  }

  spawn(kind: EnemyKind, x: number, z: number, seed?: number) {
    const e = new Enemy(kind, x, z, this.physics, seed);
    this.enemies.push(e);
    this.group.add(e.group);
    if (kind === 'warden') this.boss = e;
    return e;
  }

  /** Populate the shelf. Packs are placed by hand-ish rules per region. */
  populate(accept: (x: number, z: number) => boolean) {
    const rng = new Random('spawns');
    const packs: Array<{ x: number; z: number; kinds: EnemyKind[] }> = [
      { x: -30, z: 430, kinds: ['husk', 'husk'] },
      { x: 90, z: 372, kinds: ['husk', 'stalker'] },
      { x: -230, z: 330, kinds: ['husk', 'husk', 'wisp'] },
      { x: -372, z: 336, kinds: ['stalker', 'stalker', 'wisp'] },
      { x: 40, z: 214, kinds: ['husk', 'wisp'] },
      { x: 210, z: 260, kinds: ['husk', 'husk'] },
      { x: -120, z: 96, kinds: ['stalker', 'husk'] },
      { x: -80, z: -30, kinds: ['husk', 'husk', 'stalker'] },
      { x: -90, z: -110, kinds: ['stalker', 'wisp'] },
      { x: -66, z: -280, kinds: ['husk', 'husk', 'husk'] },
      { x: -140, z: -350, kinds: ['stalker', 'stalker', 'wisp'] },
      { x: 20, z: -390, kinds: ['husk', 'stalker', 'wisp'] },
      { x: -60, z: -470, kinds: ['husk', 'husk', 'stalker', 'wisp'] },
      { x: 300, z: -140, kinds: ['wisp', 'wisp'] },
      { x: -560, z: 120, kinds: ['stalker', 'wisp'] },
      { x: 420, z: 40, kinds: ['husk', 'wisp'] },
    ];
    for (const p of packs) {
      for (const k of p.kinds) {
        let x = p.x + rng.range(-9, 9);
        let z = p.z + rng.range(-9, 9);
        for (let t = 0; t < 6 && !accept(x, z); t++) {
          x = p.x + rng.range(-14, 14);
          z = p.z + rng.range(-14, 14);
        }
        if (!accept(x, z)) continue;
        this.spawn(k, x, z, rng.next() * 1e6);
      }
    }
  }

  spawnBoss(x: number, z: number) {
    const b = this.spawn('warden', x, z);
    b.group.visible = false;
    return b;
  }

  /* ---------------- player attacks ---------------- */

  resolvePlayerAttack(e: AttackEvent, player: Player) {
    let hits = 0;
    for (const en of this.enemies) {
      if (en.dead || !en.active) continue;
      const dx = en.pos.x - e.origin.x;
      const dz = en.pos.z - e.origin.z;
      const dist = Math.hypot(dx, dz);
      const reach = e.range + en.radius;
      if (dist > reach) continue;
      const dy = Math.abs(en.pos.y + en.height * 0.5 - e.origin.y);
      if (dy > 2.4 + en.height) continue;
      const dot = (dx * e.dir.x + dz * e.dir.z) / (dist || 1);
      if (dot < Math.cos(e.arc)) continue;
      const crit = Math.random() < 0.16;
      const dmg = e.damage * (crit ? 1.85 : 1) * (0.9 + Math.random() * 0.2);
      const killed = en.damage(dmg, e.origin.x, e.origin.z, e.knockback, this.fx, this.time);
      this.cb.onDamage({
        amount: dmg, x: en.pos.x, y: en.pos.y + en.height * 0.75, z: en.pos.z,
        crit, toPlayer: false, kind: 'physical',
      });
      audio.sfx(crit ? 'hitCrit' : 'hit', 0.9);
      if (killed) this.onKilled(en, player);
      hits++;
    }
    return hits;
  }

  /** Radial damage — abilities, boss slams, explosions. */
  radialDamage(x: number, z: number, radius: number, damage: number, knockback: number, player: Player, kind: DamageEvent['kind'] = 'aether') {
    let hits = 0;
    for (const en of this.enemies) {
      if (en.dead || !en.active) continue;
      const d = Math.hypot(en.pos.x - x, en.pos.z - z);
      if (d > radius + en.radius) continue;
      const falloff = 1 - smoothstep(radius * 0.4, radius, d);
      const dmg = damage * (0.6 + falloff * 0.6);
      const killed = en.damage(dmg, x, z, knockback * falloff, this.fx, this.time);
      this.cb.onDamage({
        amount: dmg, x: en.pos.x, y: en.pos.y + en.height * 0.75, z: en.pos.z,
        crit: false, toPlayer: false, kind,
      });
      if (killed) this.onKilled(en, player);
      hits++;
    }
    return hits;
  }

  private onKilled(en: Enemy, player: Player) {
    this.cb.onKill(en);
    const levels = player.addXp(en.def.xp);
    if (levels > 0) audio.sfx('levelup');
  }

  /** Nearest living enemy in front of the player, for lock-on. */
  findLockTarget(from: THREE.Vector3, dirX: number, dirZ: number, maxDist = 28) {
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    for (const en of this.enemies) {
      if (en.dead || !en.active) continue;
      const dx = en.pos.x - from.x, dz = en.pos.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > maxDist) continue;
      const dot = (dx * dirX + dz * dirZ) / (d || 1);
      const score = dot * 2.2 - d / maxDist;
      if (score > bestScore) { bestScore = score; best = en; }
    }
    return best;
  }

  aliveCount(near?: THREE.Vector3, radius = 40) {
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (near && e.distanceTo(near) > radius) continue;
      n++;
    }
    return n;
  }

  /* ---------------- simulation ---------------- */

  update(dt: number, player: Player) {
    this.time += dt;
    const p = player.pos;

    // assign attack slots so packs take turns
    for (let i = 0; i < this.attackerSlots.length; i++) {
      const id = this.attackerSlots[i];
      if (id === null) continue;
      const e = this.enemies.find((x) => x.id === id);
      if (!e || e.dead || !e.aggro || (e.state !== 'windup' && e.state !== 'strike' && e.state !== 'recover')) {
        this.attackerSlots[i] = null;
      }
    }

    for (const e of this.enemies) {
      const dist = e.distanceTo(p);
      const shouldBeActive = dist < 150 && !(e === this.boss && !this.bossActive);
      if (shouldBeActive !== e.active) {
        e.active = shouldBeActive;
        e.group.visible = shouldBeActive;
      }
      if (!e.active) continue;
      if (e.dead) { this.updateDead(e, dt); continue; }
      // far away: cheap idle only
      if (dist > 70) { this.updateFar(e, dt); continue; }
      if (e === this.boss) this.updateBoss(e, dt, player, dist);
      else this.updateGrunt(e, dt, player, dist);
    }
  }

  private applyMotion(e: Enemy, dt: number) {
    e.pos.addScaledVector(e.vel, dt);
    this.physics.resolve(e.pos, e.radius, e.height);
    if (e.kind === 'wisp') {
      const g = this.physics.groundHeight(e.pos.x, e.pos.z, e.pos.y + 4, 1e6);
      const want = g + 1.9 + Math.sin(this.time * 1.7 + e.id) * 0.35;
      e.pos.y = damp(e.pos.y, want, 3.4, dt);
    } else {
      const g = this.physics.groundHeight(e.pos.x, e.pos.z, e.pos.y, 0.9);
      e.vel.y -= 26 * dt;
      if (e.pos.y + e.vel.y * dt <= g) { e.pos.y = g; e.vel.y = 0; e.grounded = true; }
      else { e.pos.y += e.vel.y * dt; e.grounded = false; }
    }
    const drag = Math.exp(-6.5 * dt);
    e.vel.x *= drag;
    e.vel.z *= drag;
    e.yaw = dampAngle(e.yaw, e.wantYaw, e.kind === 'warden' ? 3.2 : 7.5, dt);
    e.group.position.copy(e.pos);
    e.group.rotation.y = e.yaw;
    e.flash = Math.max(0, e.flash - dt * 4);
  }

  private moveToward(e: Enemy, tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const ax = (dx / d) * speed;
    const az = (dz / d) * speed;
    e.vel.x = damp(e.vel.x, ax, 8, dt);
    e.vel.z = damp(e.vel.z, az, 8, dt);
  }

  private updateFar(e: Enemy, dt: number) {
    e.stateTime += dt;
    this.applyMotion(e, dt);
    if (e.character) {
      e.character.advanceGait(dt, Math.hypot(e.vel.x, e.vel.z));
      e.character.anim.setState('idle');
      e.character.update(dt, { speed01: 0 });
    }
    e.wisp?.update(dt);
  }

  private updateDead(e: Enemy, dt: number) {
    e.deadTime += dt;
    e.vel.x *= Math.exp(-5 * dt);
    e.vel.z *= Math.exp(-5 * dt);
    this.applyMotion(e, dt);
    if (e.character) {
      e.character.update(dt, { speed01: 0 });
      if (e.deadTime > 3.2) {
        const t = clamp01((e.deadTime - 3.2) / 1.6);
        e.group.position.y = e.pos.y - t * 2.2;
        if (t >= 1) { e.group.visible = false; e.active = false; }
      }
    } else if (e.wisp) {
      e.wisp.update(dt);
      const t = clamp01(e.deadTime / 0.6);
      e.group.scale.setScalar(1 - t);
      if (t >= 1) { e.group.visible = false; e.active = false; }
    }
  }

  private claimSlot(e: Enemy) {
    if (e.aggroSlot >= 0 && this.attackerSlots[e.aggroSlot] === e.id) return true;
    for (let i = 0; i < MAX_ATTACKERS; i++) {
      if (this.attackerSlots[i] === null) {
        this.attackerSlots[i] = e.id;
        e.aggroSlot = i;
        return true;
      }
    }
    return false;
  }

  private releaseSlot(e: Enemy) {
    if (e.aggroSlot >= 0 && this.attackerSlots[e.aggroSlot] === e.id) this.attackerSlots[e.aggroSlot] = null;
    e.aggroSlot = -1;
  }

  private updateGrunt(e: Enemy, dt: number, player: Player, dist: number) {
    e.stateTime += dt;
    const p = player.pos;
    const def = e.def;
    const canSee = dist < def.aggroRange && player.alive;
    if (!e.aggro && canSee) {
      e.aggro = true;
      e.state = 'alert';
      e.stateTime = 0;
    }
    if (e.aggro && (dist > def.aggroRange * 2.6 || !player.alive)) {
      e.aggro = false;
      e.state = 'idle';
      this.releaseSlot(e);
    }

    let speed = 0;
    switch (e.state) {
      case 'dormant':
      case 'idle': {
        e.wanderTimer -= dt;
        if (e.wanderTimer <= 0) {
          e.wanderTimer = 3 + Math.random() * 5;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 9;
          e.wanderTarget.set(e.home.x + Math.cos(a) * r, 0, e.home.z + Math.sin(a) * r);
        }
        const d = Math.hypot(e.wanderTarget.x - e.pos.x, e.wanderTarget.z - e.pos.z);
        if (d > 1.2) {
          this.moveToward(e, e.wanderTarget.x, e.wanderTarget.z, def.speed, dt);
          e.faceTowards(e.wanderTarget.x, e.wanderTarget.z);
          speed = def.speed;
        }
        break;
      }
      case 'alert':
        e.faceTowards(p.x, p.z);
        if (e.stateTime > 0.45) e.state = 'chase';
        break;
      case 'chase': {
        e.faceTowards(p.x, p.z);
        const want = def.attackRange * 0.82;
        if (dist > want) {
          this.moveToward(e, p.x, p.z, def.chaseSpeed, dt);
          speed = def.chaseSpeed;
        } else if (this.claimSlot(e)) {
          e.state = 'windup';
          e.stateTime = 0;
          e.hitDone = false;
          e.attackKind = Math.random() < 0.35 ? 1 : 0;
          e.character?.anim.play(e.attackKind === 0 ? 'attack1' : 'attack2');
          audio.sfx('swing', 0.5);
        } else {
          e.state = 'circle';
          e.stateTime = 0;
        }
        break;
      }
      case 'circle': {
        e.faceTowards(p.x, p.z);
        const side = (e.id % 2 === 0 ? 1 : -1);
        const a = Math.atan2(e.pos.z - p.z, e.pos.x - p.x) + side * dt * 0.9;
        const r = lerp(def.attackRange * 1.5, def.attackRange * 2.4, 0.5 + 0.5 * Math.sin(this.time * 0.7 + e.id));
        this.moveToward(e, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, def.speed * 1.7, dt);
        speed = def.speed * 1.7;
        if (e.stateTime > 1.1 + Math.random() && dist < def.attackRange * 2.0 && this.claimSlot(e)) {
          e.state = 'windup';
          e.stateTime = 0;
          e.hitDone = false;
          e.attackKind = 0;
          e.character?.anim.play('attack1');
          audio.sfx('swing', 0.5);
        }
        if (dist > def.attackRange * 3.2) { e.state = 'chase'; }
        break;
      }
      case 'windup': {
        e.faceTowards(p.x, p.z);
        const anim = e.character?.anim;
        const phase = anim ? anim.actionPhase : clamp01(e.stateTime / 0.6);
        if (e.kind === 'wisp') {
          if (e.stateTime > 0.75) {
            this.wispBolt(e, player);
            e.state = 'recover';
            e.stateTime = 0;
          }
        } else if (phase >= 0.42 && !e.hitDone) {
          e.hitDone = true;
          e.state = 'strike';
          e.stateTime = 0;
          this.enemyStrike(e, player);
        } else if (phase >= 1) {
          e.state = 'recover';
          e.stateTime = 0;
        }
        break;
      }
      case 'strike':
        // slide forward through the swing
        e.vel.x += -Math.sin(e.yaw) * 22 * dt;
        e.vel.z += -Math.cos(e.yaw) * 22 * dt;
        if (e.stateTime > 0.22) { e.state = 'recover'; e.stateTime = 0; }
        break;
      case 'recover':
        if (e.stateTime > (e.kind === 'stalker' ? 0.45 : 0.75)) {
          this.releaseSlot(e);
          e.state = dist < def.attackRange * 1.4 ? 'circle' : 'chase';
          e.stateTime = 0;
        }
        break;
      case 'stagger':
        if (e.stateTime > 0.55) { e.state = 'chase'; e.stateTime = 0; }
        break;
    }

    this.applyMotion(e, dt);

    if (e.character) {
      const planar = Math.hypot(e.vel.x, e.vel.z);
      e.character.advanceGait(dt, planar);
      e.character.velocity.copy(e.vel);
      if (e.state === 'windup' || e.state === 'strike' || e.state === 'stagger') {
        e.character.anim.setState(planar > 1 ? 'walk' : 'idle');
      } else if (planar > 4.2) e.character.anim.setState('sprint');
      else if (planar > 1.6) e.character.anim.setState('run');
      else if (planar > 0.3) e.character.anim.setState('walk');
      else e.character.anim.setState('idle');
      e.character.lookTarget = e.aggro ? p : null;
      e.character.lookWeight = e.aggro ? 0.8 : 0;
      e.character.update(dt, { speed01: clamp01(planar / def.chaseSpeed) });
    }
    if (e.wisp) {
      e.wisp.update(dt);
      if (e.aggro && e.state !== 'windup' && e.state !== 'recover') {
        e.faceTowards(p.x, p.z);
        if (dist > def.attackRange) {
          this.moveToward(e, p.x, p.z, def.chaseSpeed, dt);
        } else if (e.stateTime > 1.6 && this.claimSlot(e)) {
          e.state = 'windup';
          e.stateTime = 0;
        } else {
          const a = Math.atan2(e.pos.z - p.z, e.pos.x - p.x) + dt * 0.7;
          this.moveToward(e, p.x + Math.cos(a) * def.attackRange, p.z + Math.sin(a) * def.attackRange, def.speed, dt);
        }
      }
      if (e.state === 'windup') {
        this.fx.castCharge(e.pos.x, e.pos.y + 0.4, e.pos.z, WRAITH);
      }
      this.fx.drift(e.pos.x + (Math.random() - 0.5), e.pos.y + Math.random(), e.pos.z + (Math.random() - 0.5), WRAITH);
    }
    void speed;
  }

  private enemyStrike(e: Enemy, player: Player) {
    audio.sfx('swingHeavy', 0.45);
    const reach = e.def.attackRange + 0.7;
    const dx = player.pos.x - e.pos.x;
    const dz = player.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    const dot = d > 0.001 ? (dx * fx + dz * fz) / d : 1;
    if (d <= reach && dot > 0.35) {
      const dealt = player.damage(e.def.damage, new THREE.Vector3(-fx, 0, -fz));
      if (dealt) {
        this.cb.onPlayerHit(e.def.damage);
        this.cb.onDamage({
          amount: e.def.damage, x: player.pos.x, y: player.pos.y + 1.5, z: player.pos.z,
          crit: false, toPlayer: true, kind: 'physical',
        });
        audio.sfx('hurt', 0.9);
      } else {
        audio.sfx('block', 0.5);
      }
    }
    const tipX = e.pos.x + fx * reach * 0.7;
    const tipZ = e.pos.z + fz * reach * 0.7;
    this.fx.hitSpark(tipX, e.pos.y + e.height * 0.55, tipZ, fx, fz, 0.35,
      e.kind === 'stalker' ? EMBER : WRAITH);
  }

  private wispBolt(e: Enemy, player: Player) {
    audio.sfx('castSurge', 0.4);
    const dx = player.pos.x - e.pos.x;
    const dy = (player.pos.y + 1.1) - (e.pos.y + 0.3);
    const dz = player.pos.z - e.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    for (let i = 0; i < 22; i++) {
      const t = i / 22;
      this.fx.additive.spawn({
        x: e.pos.x + dx * t, y: e.pos.y + 0.3 + dy * t, z: e.pos.z + dz * t,
        vx: 0, vy: 0.4, vz: 0,
        size: 0.20 * (1 - t * 0.5), sizeEnd: 0.02,
        color: WRAITH, life: 0.30 + t * 0.2, drag: 1.5,
      });
    }
    if (d < e.def.attackRange + 2.5) {
      const dealt = player.damage(e.def.damage, new THREE.Vector3(dx / d, 0, dz / d));
      if (dealt) {
        this.cb.onPlayerHit(e.def.damage);
        this.cb.onDamage({
          amount: e.def.damage, x: player.pos.x, y: player.pos.y + 1.5, z: player.pos.z,
          crit: false, toPlayer: true, kind: 'aether',
        });
        audio.sfx('hurt', 0.8);
      }
    }
  }

  /* ---------------- the Warden ---------------- */

  private updateBoss(e: Enemy, dt: number, player: Player, dist: number) {
    e.stateTime += dt;
    const p = player.pos;
    const def = e.def;
    const frac = e.hp / e.hpMax;
    const wantPhase = frac > 0.62 ? 1 : frac > 0.28 ? 2 : 3;
    if (wantPhase !== e.phase) {
      e.phase = wantPhase;
      this.cb.onBossPhase(wantPhase);
      audio.sfx('bossRoar', 0.8);
      this.fx.shockwave(e.pos.x, e.pos.y, e.pos.z, 9, AETHER);
      e.state = 'recover';
      e.stateTime = 0;
      // phase 2 brings help
      if (wantPhase === 2) {
        for (let i = 0; i < 2; i++) {
          const a = (i / 2) * Math.PI * 2 + 0.6;
          this.spawn('wisp', e.pos.x + Math.cos(a) * 12, e.pos.z + Math.sin(a) * 12);
        }
      }
    }

    const speedMul = e.phase === 3 ? 1.35 : e.phase === 2 ? 1.15 : 1;
    e.faceTowards(p.x, p.z);

    switch (e.state) {
      case 'dormant':
      case 'idle':
        if (dist < def.aggroRange) { e.state = 'chase'; e.stateTime = 0; e.aggro = true; }
        break;
      case 'chase': {
        if (dist > def.attackRange * 0.9) {
          this.moveToward(e, p.x, p.z, def.chaseSpeed * speedMul, dt);
        }
        const cooldown = e.phase === 3 ? 0.7 : e.phase === 2 ? 1.0 : 1.4;
        if (e.stateTime > cooldown && dist < def.attackRange * 1.8) {
          e.state = 'windup';
          e.stateTime = 0;
          e.hitDone = false;
          const r = Math.random();
          e.attackKind = e.phase >= 2 && r < 0.28 ? 2 : r < 0.6 ? 0 : 1;
          e.character?.anim.play(e.attackKind === 2 ? 'attack3' : e.attackKind === 0 ? 'attack1' : 'attack2');
          audio.sfx('swingHeavy', 0.8);
        } else if (e.stateTime > 3.4 && dist > def.attackRange * 3) {
          // charge across the arena
          e.state = 'strike';
          e.stateTime = 0;
          e.attackKind = 3;
          e.hitDone = false;
          e.character?.anim.setState('sprint');
          audio.sfx('bossRoar', 0.55);
        }
        break;
      }
      case 'windup': {
        const anim = e.character!.anim;
        const phase = anim.actionPhase;
        // telegraph
        if (phase > 0.15 && phase < 0.5) {
          const fwd = e.attackKind === 2 ? 0 : 4.5;
          this.fx.castCharge(
            e.pos.x - Math.sin(e.yaw) * fwd, e.pos.y + 0.4, e.pos.z - Math.cos(e.yaw) * fwd, AETHER,
          );
        }
        const hitAt = e.attackKind === 2 ? 0.56 : 0.44;
        if (phase >= hitAt && !e.hitDone) {
          e.hitDone = true;
          this.bossStrike(e, player);
        }
        if (phase >= 1) { e.state = 'recover'; e.stateTime = 0; }
        break;
      }
      case 'strike': {
        // the charge
        e.vel.x = -Math.sin(e.yaw) * 13.5;
        e.vel.z = -Math.cos(e.yaw) * 13.5;
        this.fx.riftTrail(e.pos.x, e.pos.y, e.pos.z);
        if (dist < 4.2 && !e.hitDone) {
          e.hitDone = true;
          const dealt = player.damage(def.damage * 0.8, new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)));
          if (dealt) {
            this.cb.onPlayerHit(def.damage * 0.8);
            this.cb.onDamage({ amount: def.damage * 0.8, x: p.x, y: p.y + 1.6, z: p.z, crit: false, toPlayer: true, kind: 'physical' });
          }
        }
        if (e.stateTime > 1.5) { e.state = 'recover'; e.stateTime = 0; }
        break;
      }
      case 'recover':
        if (e.stateTime > (e.phase === 3 ? 0.5 : 0.9)) { e.state = 'chase'; e.stateTime = 0; }
        break;
      case 'stagger':
        if (e.stateTime > 0.9) { e.state = 'chase'; e.stateTime = 0; }
        break;
    }

    this.applyMotion(e, dt);

    const planar = Math.hypot(e.vel.x, e.vel.z);
    const c = e.character!;
    c.advanceGait(dt, planar);
    c.velocity.copy(e.vel);
    if (e.state === 'strike') c.anim.setState('sprint');
    else if (planar > 2.5) c.anim.setState('run');
    else if (planar > 0.4) c.anim.setState('walk');
    else c.anim.setState('idle');
    c.lookTarget = p;
    c.lookWeight = 0.6;
    c.update(dt, { speed01: clamp01(planar / def.chaseSpeed) });

    // the Warden leaks aether constantly
    if (Math.random() < 0.6) {
      this.fx.drift(
        e.pos.x + (Math.random() - 0.5) * 3,
        e.pos.y + Math.random() * 4,
        e.pos.z + (Math.random() - 0.5) * 3,
        AETHER,
      );
    }
  }

  private bossStrike(e: Enemy, player: Player) {
    const def = e.def;
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    if (e.attackKind === 2) {
      // overhead slam: a ring that travels
      const gx = e.pos.x + fx * 4.2, gz = e.pos.z + fz * 4.2;
      const gy = this.physics.groundHeight(gx, gz, e.pos.y + 2, 1e6);
      this.fx.shockwave(gx, gy, gz, 7.5, AETHER);
      audio.sfx('bossSlam', 1);
      const d = Math.hypot(player.pos.x - gx, player.pos.z - gz);
      if (d < 8.5) {
        const dealt = player.damage(def.damage * 1.35, new THREE.Vector3(player.pos.x - gx, 0, player.pos.z - gz).normalize());
        if (dealt) {
          this.cb.onPlayerHit(def.damage * 1.35);
          this.cb.onDamage({ amount: def.damage * 1.35, x: player.pos.x, y: player.pos.y + 1.6, z: player.pos.z, crit: false, toPlayer: true, kind: 'aether' });
        }
      }
      // and a delayed second ring in phase 3
      if (e.phase === 3) {
        window.setTimeout(() => {
          if (e.dead) return;
          this.fx.shockwave(gx, gy, gz, 13, AETHER);
          audio.sfx('bossSlam', 0.7);
          const d2 = Math.hypot(player.pos.x - gx, player.pos.z - gz);
          if (d2 > 6 && d2 < 15) {
            const dealt = player.damage(def.damage, new THREE.Vector3(player.pos.x - gx, 0, player.pos.z - gz).normalize());
            if (dealt) this.cb.onPlayerHit(def.damage);
          }
        }, 900);
      }
    } else {
      audio.sfx('swingHeavy', 0.9);
      const reach = def.attackRange + 2.2;
      const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      const dot = d > 0.001 ? (dx * fx + dz * fz) / d : 1;
      if (d <= reach && dot > 0.1) {
        const dealt = player.damage(def.damage, new THREE.Vector3(-fx, 0, -fz));
        if (dealt) {
          this.cb.onPlayerHit(def.damage);
          this.cb.onDamage({ amount: def.damage, x: player.pos.x, y: player.pos.y + 1.6, z: player.pos.z, crit: false, toPlayer: true, kind: 'physical' });
        }
      }
      const tipX = e.pos.x + fx * reach * 0.75;
      const tipZ = e.pos.z + fz * reach * 0.75;
      this.fx.hitSpark(tipX, e.pos.y + 1.4, tipZ, fx, fz, 1.4, AETHER);
    }
  }

  dispose() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
  }
}
