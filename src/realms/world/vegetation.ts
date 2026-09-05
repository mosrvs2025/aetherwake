/**
 * REALMS — vegetation.
 *
 * Two systems:
 *
 *   TreeScatter — static, seeded placement of three species, bucketed into a
 *     spatial grid of InstancedMeshes so frustum culling actually removes
 *     geometry (one big InstancedMesh would always be "visible"). Each species
 *     carries two material groups (bark + alpha-tested foliage) in a single
 *     instanced draw, and a per-instance tint/phase attribute so no two trees
 *     are the same colour or sway in sync.
 *
 *   GrassField — a ring buffer of tiles that follows the player. One
 *     InstancedMesh, one draw call; when the player crosses a tile boundary
 *     only the handful of tiles that changed are rewritten.
 *
 * Both use the same wind function so the whole landscape moves together.
 */

import * as THREE from 'three';
import { applyAtmosphere, atmo } from '../core/atmosphere';
import { Textures } from './textures';
import { Random, clamp01, lerp, smoothstep } from '../core/math';
import { terrainHeight, terrainSlope } from './heightfield';
import { LAKE_Y } from './atlas';
import { tube, limb, V } from '../chars/geom';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ *
 * Shared wind
 * ------------------------------------------------------------------ */

const WIND_PARS = /* glsl */ `
attribute vec3 iTint;
attribute vec2 iPhase;   // x = sway phase, y = stiffness (0 = trunk, 1 = tip)
varying vec3 vTint;
uniform float uWindTime;
uniform float uWindAmp;

vec3 realmsWind(vec3 world, vec3 local, float bend) {
  float t = uWindTime;
  vec2 dir = normalize(vec2(0.82, 0.57));
  float gust = 0.62 + 0.38 * sin(t * 0.23 + dot(world.xz, dir) * 0.010);
  float w1 = sin(t * 1.55 + world.x * 0.16 + world.z * 0.11);
  float w2 = sin(t * 3.10 + world.x * 0.42 - world.z * 0.31) * 0.4;
  float amp = bend * uWindAmp * gust;
  return vec3(dir.x * (w1 + w2) * amp, -abs(w1) * amp * 0.14, dir.y * (w1 + w2) * amp);
}
`;

const WIND_VERT = /* glsl */ `
  vTint = iTint;
  {
    vec3 worldNow = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
    float bend = iPhase.y * max(0.0, transformed.y);
    vec3 off = realmsWind(worldNow + vec3(iPhase.x * 13.0), transformed, bend);
    // Rotate the world-space gust back into instance space by hand: GLSL ES 1.00
    // has no inverse()/transpose(), and the instance basis is a rotation with
    // (possibly non-uniform) scale, so normalise the columns and dot against them.
    mat3 im = mat3(instanceMatrix);
    vec3 c0 = im[0], c1 = im[1], c2 = im[2];
    float l0 = max(length(c0), 1e-5), l1 = max(length(c1), 1e-5), l2 = max(length(c2), 1e-5);
    vec3 local = vec3(dot(off, c0 / l0) / l0, dot(off, c1 / l1) / l1, dot(off, c2 / l2) / l2);
    transformed += local;
  }
`;

const TINT_FRAG = /* glsl */ `
  diffuseColor.rgb *= vTint;
`;

export function makeFoliageMaterial(opts: {
  color: THREE.ColorRepresentation; map?: THREE.Texture; alphaTest?: number;
  roughness?: number; side?: THREE.Side; windAmp?: number; key: string;
  /** Multiply by the per-instance tint? Trunks should not take canopy colour. */
  tinted?: boolean;
}) {
  const m = new THREE.MeshStandardMaterial({
    color: opts.color,
    ...(opts.map ? { map: opts.map, alphaMap: opts.map } : {}),
    alphaTest: opts.alphaTest ?? 0,
    transparent: false,
    roughness: opts.roughness ?? 0.86,
    metalness: 0,
    side: opts.side ?? THREE.FrontSide,
  });
  applyAtmosphere(m, {
    key: opts.key,
    uniforms: {
      uWindTime: atmo.uTime,
      uWindAmp: { value: opts.windAmp ?? 0.055 },
    },
    vertexPars: WIND_PARS,
    fragmentPars: 'varying vec3 vTint;',
    vertexReplace: [['#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERT}`]],
    fragmentReplace: opts.tinted === false
      ? []
      : [['#include <color_fragment>', `#include <color_fragment>\n${TINT_FRAG}`]],
  });
  return m;
}

/* ------------------------------------------------------------------ *
 * Species geometry
 * ------------------------------------------------------------------ */

function leafCard(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, 1, 1);
  g.translate(0, h * 0.5, 0);
  return g;
}

/** A conifer: tapered trunk with dense whorls of needle cards and a spire. */
function buildConifer(rng: Random, height: number) {
  const bark: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const lean = rng.range(-0.04, 0.04);
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  const segs = 7;
  const trunkTop = height * 0.97;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push(V(lean * height * t * t, trunkTop * t, lean * 0.6 * height * t * t));
    radii.push(lerp(height * 0.042, height * 0.006, Math.pow(t, 0.75)) * rng.range(0.92, 1.12));
  }
  bark.push(tube(path, radii, { radial: 7 }));

  const whorls = 11;
  for (let i = 0; i < whorls; i++) {
    const t = 0.17 + (i / (whorls - 1)) * 0.81;
    const y = height * t;
    // a proper conic profile: widest low down, tapering to the spire
    const r = (Math.pow(1 - t, 0.78) * 0.30 + 0.035) * height * rng.range(0.9, 1.12);
    const cards = t > 0.86 ? 3 : 5;
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI * 2 + rng.range(-0.35, 0.35) + i * 0.7;
      const card = leafCard(r * 2.5, r * 1.9);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(
          lean * height * t * t + Math.cos(a) * r * 0.42,
          y,
          lean * 0.6 * height * t * t + Math.sin(a) * r * 0.42,
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.34, -0.12), a, rng.range(-0.18, 0.18))),
        new THREE.Vector3(1, 1, 1),
      );
      card.applyMatrix4(m);
      leaves.push(card);
    }
  }
  return { bark, leaves, height };
}

/** A broadleaf: forking trunk with clustered canopy cards. */
function buildBroadleaf(rng: Random, height: number) {
  const bark: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const trunkTop = height * rng.range(0.38, 0.50);
  const lean = rng.range(-0.1, 0.1);
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    path.push(V(lean * height * t * t, trunkTop * t, lean * 0.5 * height * t * t));
    radii.push(lerp(height * 0.055, height * 0.026, t));
  }
  bark.push(tube(path, radii, { radial: 7 }));

  const branches = rng.int(3, 4);
  const tips: THREE.Vector3[] = [];
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const len = height * rng.range(0.30, 0.46);
    const start = V(lean * height, trunkTop, lean * 0.5 * height);
    const end = V(
      start.x + Math.cos(a) * len * 0.72,
      trunkTop + len * rng.range(0.55, 0.85),
      start.z + Math.sin(a) * len * 0.72,
    );
    const mid = start.clone().lerp(end, 0.5).add(V(0, len * 0.10, 0));
    bark.push(tube([start, mid, end], [height * 0.020, height * 0.013, height * 0.007], { radial: 5 }));
    tips.push(end);
  }
  for (const tip of tips) {
    const clusters = rng.int(5, 7);
    for (let c = 0; c < clusters; c++) {
      const size = height * rng.range(0.26, 0.42);
      const card = leafCard(size * 2.3, size * 1.8);
      const off = V(rng.gauss(0, size * 0.36), rng.gauss(0, size * 0.26), rng.gauss(0, size * 0.36));
      const m = new THREE.Matrix4().compose(
        tip.clone().add(off),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.5, 0.3), rng.angle(), rng.range(-0.3, 0.3))),
        new THREE.Vector3(1, 1, 1),
      );
      card.applyMatrix4(m);
      leaves.push(card);
    }
  }
  return { bark, leaves, height };
}

/** Dead, wind-scoured wood — the ashen march and the cliff edges. */
function buildDeadwood(rng: Random, height: number) {
  const bark: THREE.BufferGeometry[] = [];
  const twist = rng.range(-0.35, 0.35);
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    path.push(V(Math.sin(t * 3.1 + twist) * height * 0.10, height * t, Math.cos(t * 2.4 + twist) * height * 0.08));
    radii.push(lerp(height * 0.048, height * 0.008, t));
  }
  bark.push(tube(path, radii, { radial: 6 }));
  const branches = rng.int(3, 6);
  for (let b = 0; b < branches; b++) {
    const t = rng.range(0.35, 0.9);
    const start = V(Math.sin(t * 3.1 + twist) * height * 0.10, height * t, Math.cos(t * 2.4 + twist) * height * 0.08);
    const a = rng.angle();
    const len = height * rng.range(0.18, 0.4);
    const end = start.clone().add(V(Math.cos(a) * len, len * rng.range(0.2, 0.7), Math.sin(a) * len));
    const mid = start.clone().lerp(end, 0.55).add(V(0, len * 0.12, 0));
    bark.push(limb(start, mid, height * 0.014, height * 0.008, 5));
    bark.push(limb(mid, end, height * 0.008, height * 0.003, 5));
  }
  return { bark, leaves: [] as THREE.BufferGeometry[], height };
}

function assembleSpecies(parts: { bark: THREE.BufferGeometry[]; leaves: THREE.BufferGeometry[] }) {
  const flat = (arr: THREE.BufferGeometry[]) => arr.map((g) => {
    const c = g.index ? g.toNonIndexed() : g;
    const keep = new THREE.BufferGeometry();
    keep.setAttribute('position', c.getAttribute('position'));
    keep.setAttribute('normal', c.getAttribute('normal'));
    keep.setAttribute('uv', c.getAttribute('uv'));
    return keep;
  });
  const groups: THREE.BufferGeometry[] = [];
  groups.push(mergeGeometries(flat(parts.bark), false)!);
  if (parts.leaves.length) groups.push(mergeGeometries(flat(parts.leaves), false)!);
  const merged = mergeGeometries(groups, true)!;
  merged.computeBoundingSphere();
  return merged;
}

/* ------------------------------------------------------------------ *
 * Static instanced scatter with spatial bucketing
 * ------------------------------------------------------------------ */

export interface ScatterInstance {
  x: number; y: number; z: number;
  scale: number; yaw: number; tilt: number;
  tint: THREE.Color;
}

export class InstancedScatter {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[] = [];

  constructor(
    geometry: THREE.BufferGeometry,
    materials: THREE.Material | THREE.Material[],
    instances: ScatterInstance[],
    opts: { bucket?: number; castShadow?: boolean; receiveShadow?: boolean; stiffness?: number } = {},
  ) {
    const bucket = opts.bucket ?? 150;
    const buckets = new Map<string, ScatterInstance[]>();
    for (const inst of instances) {
      const k = `${Math.floor(inst.x / bucket)},${Math.floor(inst.z / bucket)}`;
      let a = buckets.get(k);
      if (!a) { a = []; buckets.set(k, a); }
      a.push(inst);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sv = new THREE.Vector3();
    for (const list of buckets.values()) {
      const mesh = new THREE.InstancedMesh(geometry, materials, list.length);
      const tint = new Float32Array(list.length * 3);
      const phase = new Float32Array(list.length * 2);
      for (let i = 0; i < list.length; i++) {
        const inst = list[i];
        p.set(inst.x, inst.y, inst.z);
        e.set(inst.tilt * Math.cos(inst.yaw), inst.yaw, inst.tilt * Math.sin(inst.yaw));
        q.setFromEuler(e);
        sv.setScalar(inst.scale);
        m.compose(p, q, sv);
        mesh.setMatrixAt(i, m);
        tint[i * 3] = inst.tint.r; tint[i * 3 + 1] = inst.tint.g; tint[i * 3 + 2] = inst.tint.b;
        phase[i * 2] = (i * 0.618) % 1;
        phase[i * 2 + 1] = opts.stiffness ?? 0.05;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(tint, 3));
      mesh.geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phase, 2));
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  dispose() {
    for (const m of this.meshes) m.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Grass field: a tile ring buffer that follows the player
 * ------------------------------------------------------------------ */

export interface GrassOptions {
  tileSize: number;
  radiusTiles: number;
  perTile: number;
  /** Return 0..1 density at a world point; 0 = no grass here. */
  density: (x: number, z: number) => number;
  scale: [number, number];
  colorA: THREE.Color;
  colorB: THREE.Color;
}

export class GrassField {
  mesh: THREE.InstancedMesh;
  private opts: GrassOptions;
  private tiles: Array<{ tx: number; tz: number; used: boolean }> = [];
  private tileCount: number;
  private matrix = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3();
  private tint: Float32Array;
  private phase: Float32Array;
  private lastTx = 1e9;
  private lastTz = 1e9;
  private wanted: Array<[number, number]> = [];

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, opts: GrassOptions) {
    this.opts = opts;
    const r = opts.radiusTiles;
    const side = r * 2 + 1;
    this.tileCount = side * side;
    const total = this.tileCount * opts.perTile;
    this.mesh = new THREE.InstancedMesh(geometry, material, total);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.tint = new Float32Array(total * 3);
    this.phase = new Float32Array(total * 2);
    this.mesh.geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(this.tint, 3));
    this.mesh.geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(this.phase, 2));
    for (let i = 0; i < this.tileCount; i++) this.tiles.push({ tx: 1e9, tz: 1e9, used: false });
    // park everything at the origin, scaled to nothing
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < total; i++) this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(px: number, pz: number, budget = 6) {
    const T = this.opts.tileSize;
    const tx = Math.floor(px / T);
    const tz = Math.floor(pz / T);
    if (tx !== this.lastTx || tz !== this.lastTz) {
      this.lastTx = tx; this.lastTz = tz;
      const r = this.opts.radiusTiles;
      this.wanted.length = 0;
      for (let z = -r; z <= r; z++) {
        for (let x = -r; x <= r; x++) {
          if (x * x + z * z > (r + 0.4) * (r + 0.4)) continue;
          this.wanted.push([tx + x, tz + z]);
        }
      }
      this.wanted.sort((a, b) =>
        (a[0] - tx) ** 2 + (a[1] - tz) ** 2 - ((b[0] - tx) ** 2 + (b[1] - tz) ** 2));
      for (const t of this.tiles) {
        t.used = this.wanted.some(([wx, wz]) => wx === t.tx && wz === t.tz);
      }
    }

    let built = 0;
    for (const [wx, wz] of this.wanted) {
      if (built >= budget) break;
      if (this.tiles.some((t) => t.used && t.tx === wx && t.tz === wz)) continue;
      const slot = this.tiles.findIndex((t) => !t.used);
      if (slot < 0) break;
      this.buildTile(slot, wx, wz);
      built++;
    }
    if (built) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private buildTile(slot: number, tx: number, tz: number) {
    const o = this.opts;
    const base = slot * o.perTile;
    const rng = new Random(((tx & 0xffff) << 16) ^ (tz & 0xffff));
    const T = o.tileSize;
    for (let i = 0; i < o.perTile; i++) {
      const x = tx * T + rng.next() * T;
      const z = tz * T + rng.next() * T;
      const d = o.density(x, z);
      const idx = base + i;
      if (d < 0.03 || rng.next() > d) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(idx, this.matrix);
        continue;
      }
      const y = terrainHeight(x, z);
      this.pos.set(x, y - 0.06, z);
      this.e.set(0, rng.angle(), 0);
      this.q.setFromEuler(this.e);
      const s = rng.range(o.scale[0], o.scale[1]) * (0.7 + d * 0.5);
      this.scl.set(s * rng.range(0.85, 1.15), s * rng.range(0.85, 1.25), s);
      this.matrix.compose(this.pos, this.q, this.scl);
      this.mesh.setMatrixAt(idx, this.matrix);
      const t = rng.next();
      const c = o.colorA.clone().lerp(o.colorB, t * t);
      this.tint[idx * 3] = c.r; this.tint[idx * 3 + 1] = c.g; this.tint[idx * 3 + 2] = c.b;
      this.phase[idx * 2] = rng.next();
      this.phase[idx * 2 + 1] = 0.5;
    }
    (this.mesh.geometry.getAttribute('iTint') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('iPhase') as THREE.InstancedBufferAttribute).needsUpdate = true;
    const t = this.tiles[slot];
    t.tx = tx; t.tz = tz; t.used = true;
  }

  dispose() { this.mesh.dispose(); }
}

/** Two crossed quads — the classic grass clump, cheap and reads well in motion. */
export function grassClumpGeometry(height = 1) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.62, height, 1, 3);
    g.translate(0, height * 0.5, 0);
    g.rotateY((i / 3) * Math.PI);
    parts.push(g.toNonIndexed());
  }
  const m = mergeGeometries(parts, false)!;
  m.computeBoundingSphere();
  return m;
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

export interface VegetationDeps {
  roadAt: (x: number, z: number) => number;
  aoAt: (x: number, z: number) => number;
  /** Anything already occupying ground (buildings, ruins) rejects trees. */
  blocked: (x: number, z: number) => number;
}

export function forestDensity(x: number, z: number, deps: VegetationDeps) {
  const h = terrainHeight(x, z);
  if (h < LAKE_Y + 1.0 || h > 240) return 0;
  const slope = terrainSlope(x, z);
  if (slope > 0.52) return 0;
  if (deps.roadAt(x, z) > 0.18) return 0;
  if (deps.blocked(x, z) > 0.5) return 0;
  // the wood thickens toward Emberpine and thins out on the ashen march
  // a dense wood in the middle band, thinning to open downs and ashen north
  const band = smoothstep(640, 450, z) * smoothstep(90, 250, z);
  const north = smoothstep(-40, -230, z) * 0.30;
  const south = smoothstep(430, 660, z) * 0.30;
  const east = smoothstep(380, 200, x) * 0.35 + 0.65;
  const alt = 1 - smoothstep(150, 208, h);
  return clamp01((band * 1.15 + north + south + 0.16) * east * alt * (1 - smoothstep(0.30, 0.52, slope)));
}

export function buildVegetation(deps: VegetationDeps) {
  const rng = new Random('realms-forest');
  const bark = makeFoliageMaterial({ color: '#7c6549', roughness: 0.92, key: 'bark', windAmp: 0.014, tinted: false });
  const leaf = makeFoliageMaterial({
    color: '#ffffff', map: Textures.leaf, alphaTest: 0.36, side: THREE.DoubleSide,
    roughness: 0.88, key: 'leaf', windAmp: 0.075,
  });

  // three prototypes per species so a forest is not a copy-paste
  const speciesGeos: THREE.BufferGeometry[][] = [[], [], []];
  for (let v = 0; v < 3; v++) {
    speciesGeos[0].push(assembleSpecies(buildConifer(new Random(`conifer${v}`), 15 + v * 3.5)));
    speciesGeos[1].push(assembleSpecies(buildBroadleaf(new Random(`broad${v}`), 12 + v * 3)));
    speciesGeos[2].push(assembleSpecies(buildDeadwood(new Random(`dead${v}`), 9 + v * 2.5)));
  }

  const lists: ScatterInstance[][][] = [[[], [], []], [[], [], []], [[], [], []]];
  const CONIFER_TINTS = [new THREE.Color('#5f7a4a'), new THREE.Color('#7d8f4e'), new THREE.Color('#48603c')];
  const BROAD_TINTS = [new THREE.Color('#9aa24d'), new THREE.Color('#c08a3c'), new THREE.Color('#7f9a52')];
  const DEAD_TINTS = [new THREE.Color('#8b8378'), new THREE.Color('#6d675e')];

  const attempts = 120000;
  for (let i = 0; i < attempts; i++) {
    const x = rng.range(-860, 860);
    const z = rng.range(-860, 860);
    const d = forestDensity(x, z, deps);
    if (d <= 0 || rng.next() > d * 0.70) continue;
    const y = terrainHeight(x, z);
    const north = smoothstep(60, -220, z);
    const ashen = smoothstep(-120, -330, z);
    let species = 0;
    const r = rng.next();
    if (ashen > 0.5) species = r < 0.72 ? 2 : 0;
    else if (north > 0.4) species = r < 0.68 ? 0 : 2;
    else species = r < 0.52 ? 0 : r < 0.94 ? 1 : 2;
    const variant = rng.int(0, 2);
    const tints = species === 0 ? CONIFER_TINTS : species === 1 ? BROAD_TINTS : DEAD_TINTS;
    const tint = rng.pick(tints).clone().multiplyScalar(rng.range(0.82, 1.12));
    lists[species][variant].push({
      x, y: y - 0.35, z,
      scale: rng.range(0.62, 1.28) * (1 - ashen * 0.25),
      yaw: rng.angle(),
      tilt: rng.range(0, 0.055),
      tint,
    });
  }

  const scatters: InstancedScatter[] = [];
  const group = new THREE.Group();
  group.name = 'trees';
  let count = 0;
  for (let s = 0; s < 3; s++) {
    for (let v = 0; v < 3; v++) {
      const list = lists[s][v];
      if (!list.length) continue;
      count += list.length;
      const mats = s === 2 ? [bark] : [bark, leaf];
      const sc = new InstancedScatter(speciesGeos[s][v], mats, list, {
        bucket: 170, castShadow: true, receiveShadow: true,
        stiffness: s === 2 ? 0.012 : 0.045,
      });
      scatters.push(sc);
      group.add(sc.group);
    }
  }

  return { group, scatters, materials: { bark, leaf }, count };
}
