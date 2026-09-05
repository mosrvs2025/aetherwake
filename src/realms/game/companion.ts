/**
 * REALMS — Ashfang, the companion.
 *
 * Steering rather than pathfinding: a follow anchor offset behind and beside
 * the player, with terrain-aware motion, a leash that teleports him back when
 * the world gets between you, and combat behaviour that picks the enemy you are
 * fighting rather than the nearest one. He sits when you stand still, looks
 * where you look, and howls at the vista when you first arrive somewhere.
 */

import * as THREE from 'three';
import { Wolf } from '../chars/wolf';
import type { Physics } from './physics';
import type { Player } from './player';
import type { Combat, Enemy } from './combat';
import type { Fx } from './fx';
import { audio } from '../core/audio';
import { clamp01, damp, dampAngle, lerp } from '../core/math';
import { AETHER } from '../chars/materials';

type WolfState = 'follow' | 'sit' | 'chase' | 'lunge' | 'recover' | 'howl' | 'hurt' | 'down';

export class Companion {
  wolf: Wolf;
  group: THREE.Group;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  wantYaw = 0;
  state: WolfState = 'follow';
  stateTime = 0;
  target: Enemy | null = null;
  hp = 120;
  hpMax = 120;
  private idleTimer = 0;
  private grounded = true;
  private anchor = new THREE.Vector3();
  private lastAttack = -10;
  private t = 0;
  private downTimer = 0;
  /** Set by the game when the player commands the wolf (ability 3). */
  commanded: Enemy | null = null;

  constructor(private physics: Physics, private fx: Fx) {
    this.wolf = new Wolf();
    this.group = this.wolf.group;
  }

  spawn(x: number, z: number, yaw = 0) {
    const y = this.physics.groundHeight(x, z, 1e5, 1e6);
    this.pos.set(x, y, z);
    this.yaw = this.wantYaw = yaw;
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
  }

  damage(n: number) {
    if (this.state === 'down') return;
    this.hp -= n;
    this.wolf.anim.play('hurt');
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'down';
      this.downTimer = 0;
      audio.sfx('wolfBark', 0.7);
    } else {
      this.state = 'hurt';
      this.stateTime = 0;
    }
  }

  howl() {
    if (this.state === 'down') return;
    this.state = 'howl';
    this.stateTime = 0;
    this.wolf.anim.play('howl');
    audio.sfx('wolfHowl', 0.9);
  }

  update(dt: number, player: Player, combat: Combat) {
    this.t += dt;
    this.stateTime += dt;

    if (this.state === 'down') {
      this.downTimer += dt;
      this.wolf.anim.setState('sit');
      this.wolf.update(dt);
      this.group.position.copy(this.pos);
      // he gets back up
      if (this.downTimer > 14) {
        this.hp = this.hpMax * 0.5;
        this.state = 'follow';
      }
      return;
    }

    // --- pick a target ---
    const playerFighting = combat.enemies.some((e) => !e.dead && e.active && e.aggro && e.distanceTo(player.pos) < 22);
    if (this.commanded && !this.commanded.dead) {
      this.target = this.commanded;
    } else if (playerFighting) {
      if (!this.target || this.target.dead || this.target.distanceTo(player.pos) > 30) {
        let best: Enemy | null = null;
        let bestD = 1e9;
        for (const e of combat.enemies) {
          if (e.dead || !e.active || !e.aggro) continue;
          const d = e.distanceTo(player.pos);
          if (d < bestD && d < 26) { bestD = d; best = e; }
        }
        this.target = best;
      }
    } else {
      this.target = null;
      this.commanded = null;
    }

    // --- anchor: behind and to the player's right ---
    const px = player.pos.x, pz = player.pos.z;
    const ax = px - Math.sin(player.yaw + 0.9) * 2.6;
    const az = pz - Math.cos(player.yaw + 0.9) * 2.6;
    this.anchor.set(ax, 0, az);

    const distToPlayer = Math.hypot(px - this.pos.x, pz - this.pos.z);
    let speed = 0;
    const maxSpeed = 9.5;

    switch (this.state) {
      case 'follow': {
        const d = Math.hypot(this.anchor.x - this.pos.x, this.anchor.z - this.pos.z);
        if (d > 1.6) {
          const want = clamp01((d - 1.4) / 6) * maxSpeed;
          speed = Math.max(want, Math.min(maxSpeed, player.speed * 1.05 + 0.6));
          this.steer(this.anchor.x, this.anchor.z, speed, dt);
          this.idleTimer = 0;
        } else {
          this.idleTimer += dt;
          this.faceTowards(px, pz);
          if (this.idleTimer > 4.5 && player.speed < 0.4) {
            this.state = 'sit';
            this.stateTime = 0;
          }
        }
        if (this.target && this.target.distanceTo(player.pos) < 20) {
          this.state = 'chase';
          this.stateTime = 0;
        }
        break;
      }
      case 'sit':
        this.faceTowards(px, pz);
        if (player.speed > 1.2 || this.target) {
          this.state = 'follow';
          this.idleTimer = 0;
        }
        break;
      case 'chase': {
        const tgt = this.target;
        if (!tgt || tgt.dead) { this.state = 'follow'; break; }
        const d = tgt.distanceTo(this.pos);
        this.faceTowards(tgt.pos.x, tgt.pos.z);
        if (d > tgt.radius + 1.9) {
          speed = maxSpeed;
          this.steer(tgt.pos.x, tgt.pos.z, speed, dt);
        } else if (this.t - this.lastAttack > 1.9) {
          this.state = 'lunge';
          this.stateTime = 0;
          this.lastAttack = this.t;
          this.wolf.anim.play('lunge');
          audio.sfx('wolfBark', 0.55);
        } else {
          // circle the target while on cooldown
          const a = Math.atan2(this.pos.z - tgt.pos.z, this.pos.x - tgt.pos.x) + dt * 1.6;
          const r = tgt.radius + 3.2;
          this.steer(tgt.pos.x + Math.cos(a) * r, tgt.pos.z + Math.sin(a) * r, 6, dt);
          speed = 6;
        }
        if (distToPlayer > 34) { this.state = 'follow'; this.target = null; }
        break;
      }
      case 'lunge': {
        const tgt = this.target;
        const phase = clamp01(this.stateTime / 0.62);
        if (tgt && !tgt.dead) {
          this.faceTowards(tgt.pos.x, tgt.pos.z);
          if (phase > 0.24 && phase < 0.52) {
            this.vel.x = -Math.sin(this.yaw) * 14;
            this.vel.z = -Math.cos(this.yaw) * 14;
          }
          if (phase >= 0.42 && this.stateTime - dt < 0.42 * 0.62) {
            const d = tgt.distanceTo(this.pos);
            if (d < tgt.radius + 2.6) {
              const dmg = 16 + player.stats.level * 1.6;
              const killed = tgt.damage(dmg, this.pos.x, this.pos.z, 3.5, this.fx, this.t);
              this.fx.hitSpark(tgt.pos.x, tgt.pos.y + tgt.height * 0.55, tgt.pos.z,
                -Math.sin(this.yaw), -Math.cos(this.yaw), 0.7, AETHER);
              audio.sfx('hit', 0.6);
              if (killed) player.addXp(Math.round(tgt.def.xp * 0.5));
            }
          }
        }
        if (phase >= 1) { this.state = 'recover'; this.stateTime = 0; this.commanded = null; }
        break;
      }
      case 'recover':
        if (this.stateTime > 0.35) this.state = this.target && !this.target.dead ? 'chase' : 'follow';
        break;
      case 'howl':
        if (this.stateTime > 2.2) this.state = 'follow';
        break;
      case 'hurt':
        if (this.stateTime > 0.5) this.state = this.target ? 'chase' : 'follow';
        break;
    }

    // --- leash: if he loses you badly, cut to a spot near you ---
    if (distToPlayer > 46) {
      const a = player.yaw + 0.9;
      const tx = px - Math.sin(a) * 3.2;
      const tz = pz - Math.cos(a) * 3.2;
      this.pos.set(tx, this.physics.groundHeight(tx, tz, player.pos.y + 3, 1e6), tz);
      this.vel.set(0, 0, 0);
    }

    // --- integrate ---
    this.pos.addScaledVector(this.vel, dt);
    this.physics.resolve(this.pos, 0.55, 1.0);
    const g = this.physics.groundHeight(this.pos.x, this.pos.z, this.pos.y, 1.1);
    this.vel.y -= 26 * dt;
    if (this.pos.y + this.vel.y * dt <= g) {
      this.pos.y = g;
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.pos.y += this.vel.y * dt;
      this.grounded = false;
    }
    // hop up ledges the player can step
    if (this.grounded) {
      const ahead = this.physics.groundHeight(
        this.pos.x - Math.sin(this.yaw) * 1.2, this.pos.z - Math.cos(this.yaw) * 1.2,
        this.pos.y + 2.4, 2.4,
      );
      if (ahead > this.pos.y + 0.55 && Math.hypot(this.vel.x, this.vel.z) > 2) this.vel.y = 7.4;
    }

    const drag = Math.exp(-7 * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;

    this.yaw = dampAngle(this.yaw, this.wantYaw, 8, dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // --- animation ---
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.wolf.advanceGait(dt, planar);
    if (!this.grounded) this.wolf.anim.setState('air');
    else if (this.state === 'sit') this.wolf.anim.setState('sit');
    else if (planar > 6.4) this.wolf.anim.setState('run');
    else if (planar > 2.6) this.wolf.anim.setState('trot');
    else if (planar > 0.5) this.wolf.anim.setState('walk');
    else this.wolf.anim.setState('idle');

    const look = this.target && !this.target.dead
      ? this.target.pos.clone().setY(this.target.pos.y + this.target.height * 0.6)
      : player.pos.clone().setY(player.pos.y + 1.3);
    this.wolf.lookTarget = look;
    this.wolf.lookWeight = 0.9;
    this.wolf.update(dt);

    // aether motes trail him
    if (Math.random() < 0.35 + clamp01(planar / 10) * 0.5) {
      this.fx.drift(
        this.pos.x + (Math.random() - 0.5) * 0.9,
        this.pos.y + 0.5 + Math.random() * 0.8,
        this.pos.z + (Math.random() - 0.5) * 0.9,
        AETHER,
      );
    }
  }

  private steer(tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x = damp(this.vel.x, (dx / d) * speed, 7, dt);
    this.vel.z = damp(this.vel.z, (dz / d) * speed, 7, dt);
    this.faceTowards(tx, tz);
  }

  private faceTowards(x: number, z: number) {
    this.wantYaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
  }

  dispose() { this.wolf.dispose(); }
}

export { lerp };
