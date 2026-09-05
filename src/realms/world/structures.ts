/**
 * REALMS — architecture.
 *
 * Everything built by hand from a small kit of parametric parts (walls, roofs,
 * columns, towers, crenellations, arches), authored in world space and then
 * merged per material. The whole settlement, the ruined colonnade, the Riftspan
 * and Skyfall Keep together cost about a dozen draw calls, which is what makes
 * it affordable to have a real landmark visible from a kilometre away.
 *
 * Each builder also emits collision volumes and interaction anchors, so level
 * design, physics and gameplay stay in sync by construction.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldMaterial } from '../chars/materials';
import { Textures } from './textures';
import { Random, lerp } from '../core/math';
import { terrainHeight } from './heightfield';
import { limb, roundedBox, V } from '../chars/geom';
import type { Physics } from '../game/physics';
import { AETHER } from '../chars/materials';

export type MatKey = 'stone' | 'stoneDark' | 'wood' | 'roof' | 'metal' | 'rune' | 'cloth' | 'thatch' | 'gold';

export interface InteractPoint {
  id: string;
  kind: 'npc' | 'loot' | 'shrine' | 'door' | 'lore' | 'boss';
  x: number; y: number; z: number;
  data?: Record<string, unknown>;
}

export function makeStructureMaterials() {
  const mk = (key: string, params: THREE.MeshStandardMaterialParameters, rim = 0.14) =>
    worldMaterial(params, key, rim);
  const detail = Textures.detail;
  // Masonry gets a rim too: a keep silhouetted against a bright sky is
  // otherwise a black hole in the frame.
  const mats: Record<MatKey, THREE.MeshStandardMaterial> = {
    stone: mk('st-stone', { color: '#a8a396', roughness: 0.93, metalness: 0.0, map: detail, bumpMap: detail, bumpScale: 0.5 }),
    stoneDark: mk('st-dark', { color: '#6a6d78', roughness: 0.86, metalness: 0.04, map: detail, bumpMap: detail, bumpScale: 0.7 }, 0.20),
    wood: mk('st-wood', { color: '#7c5c3e', roughness: 0.9, metalness: 0.0 }),
    roof: mk('st-roof', { color: '#6d4c42', roughness: 0.86, metalness: 0.02 }),
    metal: mk('st-metal', { color: '#5b626f', roughness: 0.40, metalness: 0.72 }, 0.24),
    rune: mk('st-rune', { color: '#05070b', emissive: AETHER.clone(), emissiveIntensity: 2.6, roughness: 0.4, metalness: 0.2 }, 0),
    cloth: mk('st-cloth', { color: '#8e363d', roughness: 0.95, metalness: 0, side: THREE.DoubleSide }, 0.18),
    thatch: mk('st-thatch', { color: '#b3924f', roughness: 0.98, metalness: 0 }),
    gold: mk('st-gold', { color: '#d4ad57', roughness: 0.32, metalness: 0.9 }, 0.22),
  };
  // world-space triplanar-ish UVs would be nicer, but repeating the detail map
  // at a small scale is enough at these distances
  mats.stone.map!.repeat.set(1, 1);
  return mats;
}

/* ------------------------------------------------------------------ *
 * Builder
 * ------------------------------------------------------------------ */

export class StructureBuilder {
  parts: Record<string, THREE.BufferGeometry[]> = {};
  colliders: Array<() => void> = [];
  points: InteractPoint[] = [];
  private physics: Physics | null;

  constructor(physics: Physics | null = null) {
    this.physics = physics;
  }

  add(mat: MatKey, geo: THREE.BufferGeometry) {
    (this.parts[mat] ??= []).push(geo);
    return geo;
  }

  xf(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    ));
    return geo;
  }

  /** A wall/block: geometry plus a matching box collider. */
  box(mat: MatKey, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, opts: { solid?: boolean; walkable?: boolean; round?: number } = {}) {
    const g = roundedBox(w, h, d, opts.round ?? 0.05, 1);
    this.xf(g, x, y, z, ry);
    this.add(mat, g);
    if (this.physics && (opts.solid ?? true)) {
      this.physics.addBox(x, y, z, w / 2, h / 2, d / 2, ry, { walkable: opts.walkable ?? true, solid: true });
    }
    return g;
  }

  /** Decorative geometry with no collision. */
  deco(mat: MatKey, geo: THREE.BufferGeometry) { return this.add(mat, geo); }

  cylinder(mat: MatKey, x: number, y: number, z: number, r: number, h: number, seg = 12, solid = true) {
    const g = new THREE.CylinderGeometry(r, r * 1.04, h, seg, 1);
    this.xf(g, x, y + h / 2, z);
    this.add(mat, g);
    if (this.physics && solid) this.physics.addCylinder(x, z, r * 0.92, y, y + h, { walkable: true, solid: true });
    return g;
  }

  point(p: InteractPoint) { this.points.push(p); return p; }

  finish(materials: Record<MatKey, THREE.MeshStandardMaterial>, name: string) {
    const group = new THREE.Group();
    group.name = name;
    for (const key of Object.keys(this.parts) as MatKey[]) {
      const arr = this.parts[key];
      if (!arr?.length) continue;
      const flat = arr.map((g) => {
        const c = g.index ? g.toNonIndexed() : g;
        const keep = new THREE.BufferGeometry();
        keep.setAttribute('position', c.getAttribute('position'));
        keep.setAttribute('normal', c.getAttribute('normal'));
        const uv = c.getAttribute('uv');
        keep.setAttribute('uv', uv ?? new THREE.Float32BufferAttribute(new Float32Array(c.getAttribute('position').count * 2), 2));
        return keep;
      });
      const merged = mergeGeometries(flat, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${name}_${key}`;
      group.add(mesh);
    }
    return group;
  }
}

/* ------------------------------------------------------------------ *
 * Kit of parts
 * ------------------------------------------------------------------ */

/** Crenellated parapet running along a wall segment. */
function crenellation(len: number, h: number, d: number, merlon = 0.9, gap = 0.75) {
  const parts: THREE.BufferGeometry[] = [];
  const step = merlon + gap;
  const n = Math.max(1, Math.floor(len / step));
  const start = -((n - 1) * step) / 2;
  for (let i = 0; i < n; i++) {
    const g = roundedBox(merlon, h, d, 0.06, 1);
    g.translate(start + i * step, h / 2, 0);
    parts.push(g);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}

/** Fluted column with base and capital. */
function column(h: number, r: number, flutes = 10) {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(r * 1.35, r * 1.5, h * 0.06, 12);
  base.translate(0, h * 0.03, 0);
  parts.push(base);
  const shaft = new THREE.CylinderGeometry(r * 0.86, r, h * 0.86, flutes, 3);
  shaft.translate(0, h * 0.06 + h * 0.43, 0);
  parts.push(shaft);
  const cap = new THREE.CylinderGeometry(r * 1.4, r * 0.95, h * 0.05, 12);
  cap.translate(0, h * 0.945, 0);
  parts.push(cap);
  const abacus = roundedBox(r * 3.0, h * 0.045, r * 3.0, 0.1, 1);
  abacus.translate(0, h * 0.975, 0);
  parts.push(abacus);
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}

/** Gable roof with overhang; returns geometry centred on the building. */
function gableRoof(w: number, d: number, h: number, overhang = 0.5) {
  const W = w / 2 + overhang, D = d / 2 + overhang;
  const pos = [
    -W, 0, -D, W, 0, -D, W, 0, D, -W, 0, D,       // eaves
    0, h, -D, 0, h, D,                             // ridge
  ];
  const idx = [
    0, 4, 1, /* front gable */
    3, 2, 5,
    0, 3, 4, 3, 5, 4,   // left slope
    1, 4, 5, 1, 5, 2,   // right slope
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const uv: number[] = [];
  for (let i = 0; i < 6; i++) uv.push(0, 0);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g.toNonIndexed();
}

function coneRoof(r: number, h: number, seg = 10) {
  const g = new THREE.ConeGeometry(r, h, seg, 1);
  g.translate(0, h / 2, 0);
  return g;
}

/** Semicircular arch made of voussoir blocks. */
function archRing(radius: number, thickness: number, depth: number, blocks = 11) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < blocks; i++) {
    const a = Math.PI * (i + 0.5) / blocks;
    const g = roundedBox(thickness, (Math.PI * radius) / blocks * 1.06, depth, 0.05, 1);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a + Math.PI / 2)),
      new THREE.Vector3(1, 1, 1),
    ));
    parts.push(g);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}

/** A hanging banner with a slight curl. */
function banner(w: number, h: number) {
  const cols = 5, rows = 8;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const x = (u - 0.5) * w;
      const y = -v * h;
      const z = Math.sin(u * Math.PI) * 0.10 * (0.3 + v) + Math.sin(v * 5.0) * 0.05;
      const notch = v > 0.9 ? Math.abs(u - 0.5) * h * 0.30 : 0;
      pos.push(x, y + notch, z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** An irregular boulder, from a subdivided icosahedron pushed around by noise. */
export function boulder(rng: Random, r: number) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + rng.gauss(0, 0.16);
    v.multiplyScalar(Math.max(0.55, n));
    v.y *= rng.range(0.62, 0.9);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ *
 * Amberfell — the village
 * ------------------------------------------------------------------ */

function cottage(b: StructureBuilder, x: number, z: number, w: number, d: number, ry: number, rng: Random, tall = false) {
  const gy = terrainHeight(x, z);
  const wallH = tall ? 5.4 : 3.5;
  // stone ground floor
  b.box('stone', x, gy + wallH * 0.34, z, w, wallH * 0.68, d, ry, { round: 0.03 });
  // timber upper storey, slightly jettied
  const upH = tall ? 3.0 : 2.3;
  b.box('wood', x, gy + wallH * 0.68 + upH / 2, z, w * 1.09, upH, d * 1.09, ry, { round: 0.03 });
  // corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + (Math.cos(ry) * sx * w * 0.54 - Math.sin(ry) * sz * d * 0.54);
    const pz = z + (Math.sin(ry) * sx * w * 0.54 + Math.cos(ry) * sz * d * 0.54);
    const g = roundedBox(0.22, wallH * 0.68 + upH, 0.22, 0.2, 1);
    b.deco('wood', b.xf(g, px, gy + (wallH * 0.68 + upH) / 2, pz, ry));
  }
  // roof
  const roofH = (tall ? 3.6 : 2.7) * rng.range(0.92, 1.1);
  const roof = gableRoof(w * 1.16, d * 1.16, roofH, 0.42);
  b.deco('roof', b.xf(roof, x, gy + wallH * 0.68 + upH, z, ry));
  // chimney
  if (rng.bool(0.75)) {
    const cx = x + Math.cos(ry + 1.2) * w * 0.36;
    const cz = z + Math.sin(ry + 1.2) * w * 0.36;
    b.box('stone', cx, gy + wallH * 0.68 + upH + roofH * 0.55, cz, 0.75, roofH * 1.35, 0.75, ry, { solid: false });
    b.point({ id: `smoke_${x.toFixed(0)}_${z.toFixed(0)}`, kind: 'lore', x: cx, y: gy + wallH * 0.68 + upH + roofH * 1.25, z: cz, data: { smoke: true } });
  }
  // door + shuttered windows as recessed dark panels
  const fx = Math.sin(ry), fz = Math.cos(ry);
  b.deco('wood', b.xf(roundedBox(1.0, 1.9, 0.14, 0.05, 1), x + fx * (d * 0.51), gy + 0.95, z + fz * (d * 0.51), ry));
  for (const s of [-1, 1]) {
    const wx = x + fx * (d * 0.55) + Math.cos(ry) * s * w * 0.28;
    const wz = z + fz * (d * 0.55) - Math.sin(ry) * s * w * 0.28;
    b.deco('rune', b.xf(roundedBox(0.62, 0.62, 0.06, 0.05, 1), wx, gy + wallH * 0.68 + upH * 0.55, wz, ry));
  }
  return gy;
}

export function buildAmberfell(b: StructureBuilder, cx: number, cz: number) {
  const rng = new Random('amberfell');
  const layout: Array<[number, number, number, number, number, boolean]> = [
    [-24, -6, 8.5, 7.0, 0.35, false],
    [-12, 16, 7.5, 6.5, -0.9, false],
    [10, 18, 9.0, 7.5, 2.6, false],
    [24, 2, 8.0, 7.0, 1.9, true],
    [16, -18, 7.0, 6.0, 3.6, false],
    [-4, -24, 10.0, 8.0, 0.1, true],
    [-26, 14, 6.5, 6.0, -2.1, false],
    [2, 2, 12.0, 10.0, 0.5, true],   // the hall
    [30, -16, 6.5, 5.5, 1.1, false],
  ];
  for (const [ox, oz, w, d, ry, tall] of layout) {
    cottage(b, cx + ox, cz + oz, w, d, ry, rng, tall);
  }

  // village well
  const wx = cx - 6, wz = cz + 6;
  const wy = terrainHeight(wx, wz);
  b.cylinder('stone', wx, wy, wz, 1.5, 1.1, 14);
  for (const s of [-1, 1]) {
    b.deco('wood', b.xf(roundedBox(0.22, 2.6, 0.22, 0.2, 1), wx + s * 1.3, wy + 2.4, wz));
  }
  b.deco('roof', b.xf(gableRoof(3.4, 2.0, 0.9, 0.3), wx, wy + 3.6, wz));

  // bonfire at the centre of the green
  const bx = cx + 12, bz = cz - 4;
  const by = terrainHeight(bx, bz);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.deco('wood', b.xf(
      limb(V(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2), V(Math.cos(a) * 0.2, 1.7, Math.sin(a) * 0.2), 0.14, 0.09, 6),
      bx, by, bz,
    ));
  }
  b.point({ id: 'amberfell_fire', kind: 'lore', x: bx, y: by + 0.6, z: bz, data: { fire: true } });
  b.point({ id: 'amberfell_shrine', kind: 'shrine', x: cx - 6, y: wy + 1.2, z: cz + 6, data: { name: 'Amberfell Well' } });

  // fences along the road side
  const fenceRng = new Random('fence');
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 46 + fenceRng.range(-3, 3);
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r * 0.8;
    const py = terrainHeight(px, pz);
    if (py < 0) continue;
    b.deco('wood', b.xf(roundedBox(0.16, 1.3, 0.16, 0.2, 1), px, py + 0.65, pz, a));
    b.deco('wood', b.xf(roundedBox(2.6, 0.10, 0.09, 0.2, 1), px, py + 1.0, pz, a + Math.PI / 2));
  }

  // NPCs
  b.point({ id: 'npc_elder', kind: 'npc', x: cx + 4, y: terrainHeight(cx + 4, cz - 8), z: cz - 8, data: { who: 'elder' } });
  b.point({ id: 'npc_smith', kind: 'npc', x: cx + 20, y: terrainHeight(cx + 20, cz + 6), z: cz + 6, data: { who: 'smith' } });
  b.point({ id: 'npc_scout', kind: 'npc', x: cx - 16, y: terrainHeight(cx - 16, cz + 2), z: cz + 2, data: { who: 'scout' } });
}

/* ------------------------------------------------------------------ *
 * The Sunken Colonnade
 * ------------------------------------------------------------------ */

export function buildColonnade(b: StructureBuilder, cx: number, cz: number) {
  const rng = new Random('colonnade');
  const gy = terrainHeight(cx, cz);
  // stepped platform
  for (let i = 0; i < 3; i++) {
    const s = 46 - i * 3.2;
    b.box('stone', cx, gy - 0.6 + i * 0.75, cz, s, 0.75, s * 0.66, 0, { round: 0.02 });
  }
  const top = gy - 0.6 + 3 * 0.75;

  // two rows of columns, several broken
  const cols = 9;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < cols; i++) {
      const px = cx - 18 + i * 4.5 + rng.range(-0.3, 0.3);
      const pz = cz + (row === 0 ? -9 : 9);
      const broken = rng.bool(0.32);
      const h = broken ? rng.range(2.4, 6.4) : 9.4;
      const g = column(h, 0.62);
      b.deco('stone', b.xf(g, px, top, pz, rng.range(-0.05, 0.05)));
      if (b) b.box('stone', px, top + h / 2, pz, 1.5, h, 1.5, 0, { solid: true, walkable: false });
      if (broken) {
        // the fallen drum
        const d = new THREE.CylinderGeometry(0.6, 0.62, rng.range(1.4, 3.0), 12);
        b.deco('stone', b.xf(d, px + rng.range(-3, 3), top + 0.6, pz + rng.range(1.5, 4) * (row === 0 ? -1 : 1), 0, Math.PI / 2, rng.angle()));
      } else if (i < cols - 1) {
        // architrave spanning to the next column
        b.deco('stone', b.xf(roundedBox(4.6, 1.0, 1.7, 0.05, 1), px + 2.25, top + h + 0.5, pz));
      }
    }
  }

  // the altar
  b.box('stoneDark', cx, top + 0.7, cz, 4.0, 1.4, 2.6, 0.2, { round: 0.06 });
  b.deco('rune', b.xf(new THREE.TorusGeometry(1.05, 0.09, 8, 24), cx, top + 1.9, cz, 0, Math.PI / 2));
  b.point({ id: 'colonnade_relic', kind: 'loot', x: cx, y: top + 1.9, z: cz, data: { item: 'sunstone', rarity: 'rare' } });
  b.point({ id: 'colonnade_lore', kind: 'lore', x: cx - 6, y: top + 1.2, z: cz + 3, data: { text: 'colonnade' } });

  // toppled architrave blocks scattered around
  for (let i = 0; i < 14; i++) {
    const a = rng.angle(); const r = rng.range(14, 30);
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r * 0.7;
    const py = terrainHeight(px, pz);
    b.deco('stone', b.xf(roundedBox(rng.range(2, 4.5), 1.0, 1.5, 0.05, 1), px, py + 0.4, pz, rng.angle(), rng.range(-0.2, 0.2), rng.range(-0.15, 0.15)));
  }
}

/* ------------------------------------------------------------------ *
 * The Riftspan
 * ------------------------------------------------------------------ */

export function buildRiftspan(b: StructureBuilder, x: number, southZ: number, northZ: number, y: number) {
  const len = southZ - northZ;
  const mid = (southZ + northZ) / 2;
  const deckW = 7.5;
  const segs = 26;

  // deck: a shallow arch
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const z = lerp(southZ, northZ, t);
    const rise = Math.sin(t * Math.PI) * 4.2;
    b.box('stone', x, y + rise, z, deckW, 0.9, (len / segs) * 1.02, 0, { round: 0.02, walkable: true });
  }
  // parapets, deliberately broken in two places
  for (const s of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const t = (i + 0.5) / segs;
      if ((t > 0.34 && t < 0.42) || (t > 0.68 && t < 0.73)) continue;
      const z = lerp(southZ, northZ, t);
      const rise = Math.sin(t * Math.PI) * 4.2;
      b.box('stone', x + s * (deckW / 2 - 0.3), y + rise + 0.85, z, 0.55, 0.8, (len / segs) * 1.02, 0, { round: 0.05, walkable: false });
    }
  }
  // ribs under the deck
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const z = lerp(southZ, northZ, t);
    const rise = Math.sin(t * Math.PI) * 4.2;
    const drop = 3.0 + Math.sin(t * Math.PI) * 5.5;
    b.deco('stone', b.xf(roundedBox(5.2, drop, 1.1, 0.05, 1), x, y + rise - drop / 2 - 0.4, z));
  }
  // sentinel statues at both heads
  for (const [z, face] of [[southZ + 2.5, 0], [northZ - 2.5, Math.PI]] as const) {
    for (const s of [-1, 1]) {
      const px = x + s * (deckW / 2 + 1.6);
      b.box('stoneDark', px, y + 2.0, z, 2.0, 4.0, 2.0, face, { round: 0.08 });
      b.deco('stoneDark', b.xf(roundedBox(1.3, 2.6, 1.1, 0.32, 2), px, y + 5.3, z, face));
      b.deco('stoneDark', b.xf(new THREE.SphereGeometry(0.52, 12, 10), px, y + 6.9, z));
      b.deco('rune', b.xf(new THREE.TorusGeometry(0.36, 0.055, 7, 18), px, y + 5.6, z + Math.cos(face) * 0.6, face, Math.PI / 2));
    }
  }
  b.point({ id: 'riftspan_mid', kind: 'lore', x, y: y + 4.6, z: mid, data: { text: 'riftspan' } });
}

/* ------------------------------------------------------------------ *
 * Skyfall Keep
 * ------------------------------------------------------------------ */

function tower(b: StructureBuilder, x: number, z: number, base: number, r: number, h: number, opts: { roof?: boolean; runes?: boolean } = {}) {
  b.cylinder('stoneDark', x, base, z, r, h, 14);
  // banding
  for (let i = 1; i < 4; i++) {
    const g = new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.5, 14);
    b.deco('stoneDark', b.xf(g, x, base + (h * i) / 4, z));
  }
  // machicolation + crenellations
  const corbel = new THREE.CylinderGeometry(r * 1.22, r * 1.05, 1.0, 14);
  b.deco('stoneDark', b.xf(corbel, x, base + h + 0.5, z));
  const merlons = 14;
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * Math.PI * 2;
    b.deco('stoneDark', b.xf(roundedBox(1.0, 1.5, 0.7, 0.06, 1), x + Math.cos(a) * r * 1.12, base + h + 1.75, z + Math.sin(a) * r * 1.12, -a));
  }
  if (opts.roof) {
    b.deco('roof', b.xf(coneRoof(r * 1.35, r * 2.6, 14), x, base + h + 1.0, z));
  }
  if (opts.runes) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      b.deco('rune', b.xf(roundedBox(0.7, 1.9, 0.14, 0.06, 1), x + Math.cos(a) * r * 1.02, base + h * 0.62, z + Math.sin(a) * r * 1.02, -a));
    }
  }
}

export function buildSkyfallKeep(b: StructureBuilder, cx: number, cz: number) {
  const gy = terrainHeight(cx, cz);
  const rng = new Random('keep');

  // ---- outer curtain wall with a gatehouse facing south ----
  const wallY = gy + 5;
  const halfW = 58, halfD = 44;
  const wallH = 13;
  const gateW = 9;
  // south wall, split around the gate
  for (const s of [-1, 1]) {
    const segW = halfW - gateW / 2;
    b.box('stoneDark', cx + s * (gateW / 2 + segW / 2), wallY, cz + halfD, segW, wallH, 4.5, 0, { walkable: true });
    b.deco('stoneDark', b.xf(crenellation(segW, 1.6, 3.4), cx + s * (gateW / 2 + segW / 2), wallY + wallH / 2, cz + halfD));
  }
  // side + rear walls
  b.box('stoneDark', cx - halfW, wallY, cz, 4.5, wallH, halfD * 2, 0, { walkable: true });
  b.box('stoneDark', cx + halfW, wallY, cz, 4.5, wallH, halfD * 2, 0, { walkable: true });
  b.deco('stoneDark', b.xf(crenellation(halfD * 2, 1.6, 3.4), cx - halfW, wallY + wallH / 2, cz, Math.PI / 2));
  b.deco('stoneDark', b.xf(crenellation(halfD * 2, 1.6, 3.4), cx + halfW, wallY + wallH / 2, cz, Math.PI / 2));

  // ---- gatehouse ----
  for (const s of [-1, 1]) {
    tower(b, cx + s * (gateW / 2 + 4.0), cz + halfD, gy, 5.4, 26, { runes: true });
  }
  b.deco('stoneDark', b.xf(archRing(gateW / 2 + 0.6, 1.4, 5.2, 13), cx, gy + 6.0, cz + halfD));
  b.box('stoneDark', cx, gy + 15.5, cz + halfD, gateW + 3, 4.0, 5.4, 0, { walkable: true });
  // portcullis
  for (let i = 0; i < 7; i++) {
    b.deco('metal', b.xf(roundedBox(0.22, 6.2, 0.22, 0.3, 1), cx - 3.6 + i * 1.2, gy + 3.2, cz + halfD - 1.8));
  }
  for (let i = 0; i < 4; i++) {
    b.deco('metal', b.xf(roundedBox(8.2, 0.22, 0.22, 0.3, 1), cx, gy + 1.0 + i * 1.7, cz + halfD - 1.8));
  }
  b.point({ id: 'keep_gate', kind: 'door', x: cx, y: gy + 1.4, z: cz + halfD - 3.4, data: { name: 'The Warden’s Gate' } });

  // ---- corner towers ----
  tower(b, cx - halfW, cz - halfD, gy, 7.6, 40, { runes: true });
  tower(b, cx + halfW, cz - halfD, gy, 7.6, 40, { runes: true });
  tower(b, cx - halfW, cz + halfD, gy, 6.4, 30, { roof: true });
  tower(b, cx + halfW, cz + halfD, gy, 6.4, 30, { roof: true });

  // ---- the keep proper: a great hall driven into the mountain ----
  const kz = cz - 16;
  b.box('stoneDark', cx, gy + 19, kz, 54, 38, 40, 0, { walkable: true });
  b.deco('stoneDark', b.xf(crenellation(54, 2.6, 5.0), cx, gy + 38, kz - 20));
  b.deco('stoneDark', b.xf(crenellation(54, 2.6, 5.0), cx, gy + 38, kz + 20));
  // buttresses
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    for (const s of [-1, 1]) {
      const px = cx + s * 28;
      const pz = kz + i * 10;
      b.box('stoneDark', px, gy + 13, pz, 4.0, 26, 3.2, 0, { walkable: false });
      b.deco('stoneDark', b.xf(roundedBox(4.0, 8.0, 3.0, 0.1, 1), px + s * 3.2, gy + 29, pz, 0, 0, -s * 0.55));
    }
  }
  // tall arched windows, lit from within
  for (let i = -2; i <= 2; i++) {
    b.deco('rune', b.xf(roundedBox(2.2, 11.0, 0.5, 0.06, 1), cx + i * 11, gy + 20, kz + 20.2));
    b.deco('stoneDark', b.xf(archRing(1.5, 0.8, 1.4, 9), cx + i * 11, gy + 25.8, kz + 20.2));
  }

  // ---- the spire: the thing you can see from the far side of the shelf ----
  const spireX = cx, spireZ = kz - 8;
  tower(b, spireX, spireZ, gy + 38, 12.5, 74, { runes: true });
  b.deco('roof', b.xf(coneRoof(15.5, 46, 16), spireX, gy + 38 + 75, spireZ));
  // the beacon, and a halo of rings around it
  b.deco('rune', b.xf(new THREE.SphereGeometry(3.4, 20, 14), spireX, gy + 38 + 122, spireZ));
  for (let i = 0; i < 3; i++) {
    b.deco('rune', b.xf(new THREE.TorusGeometry(6.0 + i * 2.4, 0.34, 8, 30),
      spireX, gy + 38 + 122, spireZ, i * 1.1, Math.PI / 2 + i * 0.4, i * 0.5));
  }
  b.point({ id: 'keep_beacon', kind: 'lore', x: spireX, y: gy + 38 + 122, z: spireZ, data: { beacon: true } });

  // flying banners on the gatehouse and the spire
  for (const s of [-1, 1]) {
    b.deco('cloth', b.xf(banner(4.0, 12.0), cx + s * 7.5, gy + 20.5, cz + halfD + 2.8));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    b.deco('cloth', b.xf(banner(3.4, 11.0), spireX + Math.cos(a) * 13.2, gy + 38 + 62, spireZ + Math.sin(a) * 13.2, -a));
  }

  // ---- courtyard: the boss arena ----
  b.point({ id: 'keep_courtyard', kind: 'boss', x: cx, y: gy, z: cz + 6, data: { name: 'The Warden of the Fall' } });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const px = cx + Math.cos(a) * 30, pz = cz + 8 + Math.sin(a) * 22;
    b.deco('stoneDark', b.xf(column(7.5, 0.8), px, gy, pz));
    b.deco('rune', b.xf(new THREE.TorusGeometry(0.55, 0.07, 7, 18), px, gy + 7.9, pz, 0, Math.PI / 2));
  }
  // braziers
  for (const [ox, oz] of [[-14, 20], [14, 20], [-14, -6], [14, -6]]) {
    b.cylinder('stoneDark', cx + ox, gy, cz + oz, 0.7, 2.4, 10, true);
    b.deco('metal', b.xf(new THREE.SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), cx + ox, gy + 2.4, cz + oz));
    b.point({ id: `keep_brazier_${ox}_${oz}`, kind: 'lore', x: cx + ox, y: gy + 3.0, z: cz + oz, data: { fire: true, cold: true } });
  }

  // rubble skirt so the keep sits into the rock rather than on it
  for (let i = 0; i < 30; i++) {
    const a = rng.angle();
    const r = rng.range(48, 74);
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r * 0.8;
    const py = terrainHeight(px, pz);
    b.deco('stoneDark', b.xf(boulder(rng, rng.range(1.6, 5.0)), px, py + 0.4, pz, rng.angle(), rng.range(-0.3, 0.3)));
  }
}

/* ------------------------------------------------------------------ *
 * The Warden's Gate — the outer ward you must open to reach the keep
 * ------------------------------------------------------------------ */

export function buildWardensGate(b: StructureBuilder, cx: number, cz: number) {
  const gy = terrainHeight(cx, cz);
  for (const s of [-1, 1]) {
    b.box('stoneDark', cx + s * 9, gy + 6, cz, 6, 12, 6, 0, { walkable: true });
    b.deco('stoneDark', b.xf(crenellation(6, 1.2, 5), cx + s * 9, gy + 12, cz));
    b.deco('rune', b.xf(roundedBox(0.6, 4.0, 0.2, 0.06, 1), cx + s * 6.1, gy + 6, cz + 0.1));
  }
  b.box('stoneDark', cx, gy + 13.5, cz, 24, 3, 6, 0, { walkable: true });
  b.deco('stoneDark', b.xf(archRing(5.4, 1.2, 5.6, 13), cx, gy + 6.2, cz));
  // the sealed door itself: two great leaves with a rune seam
  for (const s of [-1, 1]) {
    b.deco('metal', b.xf(roundedBox(5.2, 11.0, 0.5, 0.03, 1), cx + s * 2.7, gy + 5.5, cz));
  }
  b.deco('rune', b.xf(roundedBox(0.30, 10.4, 0.62, 0.06, 1), cx, gy + 5.5, cz));
  b.deco('rune', b.xf(new THREE.TorusGeometry(1.5, 0.16, 10, 28), cx, gy + 6.4, cz + 0.35, 0, 0));
  b.point({ id: 'wardens_gate', kind: 'door', x: cx, y: gy + 1.2, z: cz + 4.5, data: { name: 'The Warden’s Gate', locked: true } });
}

/* ------------------------------------------------------------------ *
 * Aether shrines — checkpoints, fast points of interest
 * ------------------------------------------------------------------ */

export function buildShrine(b: StructureBuilder, id: string, x: number, z: number, name: string) {
  const gy = terrainHeight(x, z);
  b.cylinder('stone', x, gy - 0.3, z, 2.4, 0.6, 12, false);
  b.deco('stone', b.xf(new THREE.CylinderGeometry(0.55, 0.75, 2.2, 8), x, gy + 1.4, z));
  b.deco('stoneDark', b.xf(roundedBox(1.5, 0.3, 1.5, 0.2, 1), x, gy + 2.6, z, 0.4));
  b.deco('rune', b.xf(new THREE.OctahedronGeometry(0.55, 0), x, gy + 3.4, z));
  for (let i = 0; i < 3; i++) {
    b.deco('rune', b.xf(new THREE.TorusGeometry(0.9 + i * 0.22, 0.035, 6, 22), x, gy + 3.4, z, 0, Math.PI / 2 + i * 0.5, i * 0.4));
  }
  b.point({ id, kind: 'shrine', x, y: gy + 1.6, z, data: { name } });
}

/* ------------------------------------------------------------------ *
 * Floating islands
 * ------------------------------------------------------------------ */

export function buildFloatingIsland(
  b: StructureBuilder, seed: string, x: number, y: number, z: number, r: number, h: number,
  opts: { ruin?: boolean; physics?: Physics } = {},
) {
  const rng = new Random(seed);
  // the rock: a squashed, spiked underside
  const geo = new THREE.IcosahedronGeometry(r, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let k = 1 + rng.gauss(0, 0.05);
    if (n.y > 0.1) {
      v.y *= 0.30;                                   // flat top
      k *= 1 + Math.sin(v.x * 0.4) * 0.03;
    } else {
      const t = -n.y;
      v.y *= 0.55 + t * (h / r) * 1.9;               // a long root of rock
      k *= 1 - t * 0.42;
    }
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  b.deco('stoneDark', b.xf(geo, x, y, z));

  // grass cap
  const cap = new THREE.SphereGeometry(r * 0.985, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.34);
  cap.scale(1, 0.34, 1);
  b.deco('thatch', b.xf(cap, x, y + r * 0.30 * 0.30, z));

  if (opts.physics) {
    opts.physics.addCylinder(x, z, r * 0.86, y - h, y + r * 0.30 * 0.30, { walkable: true, solid: false });
  }

  if (opts.ruin) {
    for (let i = 0; i < 4; i++) {
      const a = rng.angle();
      const rr = rng.range(r * 0.2, r * 0.55);
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      const ch = rng.range(2.5, 6.5);
      b.deco('stone', b.xf(column(ch, 0.42), px, y + r * 0.09, pz, rng.range(-0.06, 0.06)));
    }
    b.deco('rune', b.xf(new THREE.OctahedronGeometry(0.7, 0), x, y + r * 0.09 + 2.2, z));
  }
  return { x, y: y + r * 0.09, z };
}

/* ------------------------------------------------------------------ *
 * Scattered rocks
 * ------------------------------------------------------------------ */

export function buildRockScatter(count: number, accept: (x: number, z: number) => number) {
  const rng = new Random('rocks');
  const protos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) protos.push(boulder(new Random(`rock${i}`), 1));
  const lists: Array<Array<{ x: number; y: number; z: number; s: number; yaw: number; tilt: number }>> = [[], [], [], []];
  let tries = count * 8;
  while (tries-- > 0) {
    const x = rng.range(-850, 850);
    const z = rng.range(-850, 850);
    const a = accept(x, z);
    if (a <= 0 || rng.next() > a) continue;
    const y = terrainHeight(x, z);
    const p = rng.int(0, 3);
    lists[p].push({ x, y: y - rng.range(0.1, 0.5), z, s: rng.range(0.7, 4.2), yaw: rng.angle(), tilt: rng.range(0, 0.3) });
    if (lists.flat().length >= count) break;
  }
  return { protos, lists };
}
