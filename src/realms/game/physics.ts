/**
 * REALMS — collision.
 *
 * Deliberately not a rigid-body engine. A third-person action game needs three
 * things: a reliable ground height, walls that push you out, and platforms you
 * can stand on above the terrain (the Riftspan, the keep floors, the floating
 * islands). All three are analytic queries against a small registry, which
 * costs microseconds and never jitters the way a solver can.
 */

import * as THREE from 'three';
import { terrainHeight, terrainNormal } from '../world/heightfield';
import { clamp01 } from '../core/math';

export interface BoxCollider {
  kind: 'box';
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  rot: number;
  /** Can the player stand on the top face? */
  walkable: boolean;
  /** Does it block horizontal movement? */
  solid: boolean;
  tag?: string;
}

export interface CylinderCollider {
  kind: 'cyl';
  cx: number; cz: number;
  r: number;
  top: number;
  bottom: number;
  walkable: boolean;
  solid: boolean;
  tag?: string;
}

export type Collider = BoxCollider | CylinderCollider;

const _n = { x: 0, y: 1, z: 0 };

export class Physics {
  colliders: Collider[] = [];
  /** Uniform grid so a query only tests nearby colliders. */
  private cell = 24;
  private grid = new Map<number, number[]>();
  private built = false;

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rot = 0, opts: Partial<BoxCollider> = {}) {
    this.colliders.push({ kind: 'box', cx, cy, cz, hx, hy, hz, rot, walkable: true, solid: true, ...opts });
    this.built = false;
  }
  addCylinder(cx: number, cz: number, r: number, bottom: number, top: number, opts: Partial<CylinderCollider> = {}) {
    this.colliders.push({ kind: 'cyl', cx, cz, r, bottom, top, walkable: false, solid: true, ...opts });
    this.built = false;
  }

  private key(ix: number, iz: number) { return ix * 73856093 ^ iz * 19349663; }

  build() {
    this.grid.clear();
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      let minX: number, maxX: number, minZ: number, maxZ: number;
      if (c.kind === 'box') {
        const ext = Math.hypot(c.hx, c.hz);
        minX = c.cx - ext; maxX = c.cx + ext; minZ = c.cz - ext; maxZ = c.cz + ext;
      } else {
        minX = c.cx - c.r; maxX = c.cx + c.r; minZ = c.cz - c.r; maxZ = c.cz + c.r;
      }
      const x0 = Math.floor(minX / this.cell), x1 = Math.floor(maxX / this.cell);
      const z0 = Math.floor(minZ / this.cell), z1 = Math.floor(maxZ / this.cell);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const k = this.key(x, z);
          let arr = this.grid.get(k);
          if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push(i);
        }
      }
    }
    this.built = true;
  }

  private near(x: number, z: number, out: number[]) {
    if (!this.built) this.build();
    out.length = 0;
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this.grid.get(this.key(ix + dx, iz + dz));
        if (!arr) continue;
        for (const i of arr) if (!out.includes(i)) out.push(i);
      }
    }
    return out;
  }

  private _idx: number[] = [];

  /** Height of the surface the character should stand on. */
  groundHeight(x: number, z: number, fromY: number, stepUp = 0.7): number {
    let best = terrainHeight(x, z);
    const idx = this.near(x, z, this._idx);
    for (const i of idx) {
      const c = this.colliders[i];
      if (!c.walkable) continue;
      let top: number;
      if (c.kind === 'box') {
        const dx = x - c.cx, dz = z - c.cz;
        const ca = Math.cos(-c.rot), sa = Math.sin(-c.rot);
        const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
        if (Math.abs(lx) > c.hx || Math.abs(lz) > c.hz) continue;
        top = c.cy + c.hy;
      } else {
        if (Math.hypot(x - c.cx, z - c.cz) > c.r) continue;
        top = c.top;
      }
      if (top > best && top <= fromY + stepUp) best = top;
    }
    return best;
  }

  /** True if a point is inside any solid collider (used for spawn validation). */
  inside(x: number, y: number, z: number) {
    const idx = this.near(x, z, this._idx);
    for (const i of idx) {
      const c = this.colliders[i];
      if (!c.solid) continue;
      if (c.kind === 'box') {
        if (y < c.cy - c.hy || y > c.cy + c.hy) continue;
        const dx = x - c.cx, dz = z - c.cz;
        const ca = Math.cos(-c.rot), sa = Math.sin(-c.rot);
        const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
        if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) return true;
      } else {
        if (y < c.bottom || y > c.top) continue;
        if (Math.hypot(x - c.cx, z - c.cz) <= c.r) return true;
      }
    }
    return false;
  }

  /**
   * Push a capsule out of solid colliders. Mutates `pos`. Returns true if the
   * character was moved (used to kill horizontal velocity into walls).
   */
  resolve(pos: THREE.Vector3, radius: number, height: number): boolean {
    const idx = this.near(pos.x, pos.z, this._idx);
    let moved = false;
    const yLo = pos.y + 0.25;
    const yHi = pos.y + height;
    for (const i of idx) {
      const c = this.colliders[i];
      if (!c.solid) continue;
      if (c.kind === 'cyl') {
        if (yHi < c.bottom || yLo > c.top) continue;
        const dx = pos.x - c.cx, dz = pos.z - c.cz;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min && d > 1e-4) {
          const push = (min - d);
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
          moved = true;
        }
      } else {
        const top = c.cy + c.hy;
        // stepping onto a low ledge is handled by groundHeight, not by pushing
        if (yHi < c.cy - c.hy || yLo > top - 0.05) continue;
        const dx = pos.x - c.cx, dz = pos.z - c.cz;
        const ca = Math.cos(-c.rot), sa = Math.sin(-c.rot);
        let lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
        const ex = c.hx + radius, ez = c.hz + radius;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
          const px = ex - Math.abs(lx);
          const pz = ez - Math.abs(lz);
          if (px < pz) lx += Math.sign(lx || 1) * px;
          else lz += Math.sign(lz || 1) * pz;
          const wx = lx * ca + lz * sa;
          const wz = -lx * sa + lz * ca;
          pos.x = c.cx + wx;
          pos.z = c.cz + wz;
          moved = true;
        }
      }
    }
    return moved;
  }

  /** Terrain slope, 0 flat .. 1 vertical, ignoring props. */
  slopeAt(x: number, z: number) {
    terrainNormal(x, z, _n);
    return 1 - clamp01(_n.y);
  }

  normalAt(x: number, z: number, out: THREE.Vector3) {
    terrainNormal(x, z, _n);
    return out.set(_n.x, _n.y, _n.z);
  }

  /**
   * March a ray from `from` toward `to` against terrain and colliders; returns
   * the fraction of the way it got. Used for camera collision and line of sight.
   */
  rayFraction(from: THREE.Vector3, to: THREE.Vector3, steps = 18, pad = 0.35) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + dx * t, yy = from.y + dy * t, z = from.z + dz * t;
      if (yy < terrainHeight(x, z) + pad) return Math.max(0, (i - 1) / steps);
      if (this.inside(x, yy, z)) return Math.max(0, (i - 1) / steps);
    }
    return 1;
  }
}
