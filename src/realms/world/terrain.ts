/**
 * REALMS — terrain rendering.
 *
 * The shelf is tessellated as a 14x14 grid of chunks, each of which can be
 * built at four densities. LOD is chosen per frame from camera distance, and
 * geometry is generated lazily with a strict per-frame budget so walking never
 * hitches. Because vertex normals come from the analytic height function
 * rather than from the triangles, chunks at different LODs shade identically
 * and the seams are invisible; a short vertical skirt hides the geometric gap.
 *
 * Shading is a five-way splat (grass / rock / snow / shore / road) driven by
 * slope, altitude and the baked world-data map, with a cliff-only triplanar
 * projection so vertical faces do not smear.
 */

import * as THREE from 'three';
import { applyAtmosphere } from '../core/atmosphere';
import { terrainHeight, terrainNormal } from './heightfield';
import { Textures } from './textures';
import { LAKE_Y, SEA_OF_CLOUD_Y } from './atlas';
import { WD_EXTENT } from './worlddata';

/** 0 = normal, 1 = albedo only, 2 = world normal, 3 = baked AO. */
const DEBUG_MODE = typeof location !== 'undefined'
  ? parseFloat(new URLSearchParams(location.search).get('tdbg') ?? '0')
  : 0;

const CHUNKS = 14;
const CHUNK_SIZE = 160;
const WORLD_MIN = -(CHUNKS * CHUNK_SIZE) / 2;
const LOD_SEGS = [64, 32, 20, 12];
const LOD_DIST = [300, 700, 1600, Infinity];
const SKIRT = 26;

interface ChunkRec {
  i: number; j: number;
  cx: number; cz: number;      // chunk min corner
  centerX: number; centerZ: number;
  mesh: THREE.Mesh;
  lod: number;
  wanted: number;
  cache: Map<number, THREE.BufferGeometry>;
  minY: number; maxY: number;
}

function buildChunkGeometry(cx: number, cz: number, size: number, segs: number) {
  const step = size / segs;
  const vpr = segs + 1;
  const inner = vpr * vpr;
  const skirtVerts = vpr * 4;
  const total = inner + skirtVerts;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const n = { x: 0, y: 1, z: 0 };
  let minY = Infinity, maxY = -Infinity;

  for (let j = 0; j < vpr; j++) {
    for (let i = 0; i < vpr; i++) {
      const idx = j * vpr + i;
      const x = cx + i * step;
      const z = cz + j * step;
      const y = terrainHeight(x, z);
      terrainNormal(x, z, n);
      pos[idx * 3] = x - cx - size / 2;
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = z - cz - size / 2;
      nrm[idx * 3] = n.x; nrm[idx * 3 + 1] = n.y; nrm[idx * 3 + 2] = n.z;
      uv[idx * 2] = i / segs; uv[idx * 2 + 1] = j / segs;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const tris = segs * segs * 2;
  const skirtTris = segs * 4 * 2;
  const index = new Uint32Array((tris + skirtTris) * 3);
  let t = 0;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * vpr + i;
      const b = a + 1;
      const c = a + vpr;
      const d = c + 1;
      index[t++] = a; index[t++] = c; index[t++] = b;
      index[t++] = b; index[t++] = c; index[t++] = d;
    }
  }

  // skirt: duplicate the border ring pushed downward
  let sv = inner;
  const edgeIndex = (side: number, k: number) => {
    switch (side) {
      case 0: return k;                          // z-
      case 1: return (vpr - 1) * vpr + k;        // z+
      case 2: return k * vpr;                    // x-
      default: return k * vpr + (vpr - 1);       // x+
    }
  };
  for (let side = 0; side < 4; side++) {
    const base = sv;
    for (let k = 0; k < vpr; k++) {
      const src = edgeIndex(side, k);
      pos[sv * 3] = pos[src * 3];
      pos[sv * 3 + 1] = pos[src * 3 + 1] - SKIRT;
      pos[sv * 3 + 2] = pos[src * 3 + 2];
      nrm[sv * 3] = nrm[src * 3]; nrm[sv * 3 + 1] = nrm[src * 3 + 1]; nrm[sv * 3 + 2] = nrm[src * 3 + 2];
      uv[sv * 2] = uv[src * 2]; uv[sv * 2 + 1] = uv[src * 2 + 1];
      sv++;
    }
    for (let k = 0; k < segs; k++) {
      const a = edgeIndex(side, k);
      const b = edgeIndex(side, k + 1);
      const c = base + k;
      const d = base + k + 1;
      if (side === 0 || side === 3) {
        index[t++] = a; index[t++] = b; index[t++] = c;
        index[t++] = b; index[t++] = d; index[t++] = c;
      } else {
        index[t++] = a; index[t++] = c; index[t++] = b;
        index[t++] = b; index[t++] = c; index[t++] = d;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const r = Math.hypot(size / 2, size / 2, (maxY - minY) / 2 + SKIRT);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (minY + maxY) / 2, 0), r);
  geo.boundingBox = new THREE.Box3(
    new THREE.Vector3(-size / 2, minY - SKIRT, -size / 2),
    new THREE.Vector3(size / 2, maxY, size / 2),
  );
  return { geo, minY, maxY };
}

const TERRAIN_FRAG_PARS = /* glsl */ `
uniform sampler2D uDetail;
uniform sampler2D uWorldData;
uniform float uWorldExtent;
uniform vec3 uGrassA;
uniform vec3 uGrassB;
uniform vec3 uGrassDry;
uniform vec3 uGrassAsh;
uniform vec3 uRockA;
uniform vec3 uRockB;
uniform vec3 uSnow;
uniform vec3 uShore;
uniform vec3 uRoad;
uniform float uLakeY;
uniform float uTerrainDebug;
varying vec3 vWNorm;
`;

const TERRAIN_MAP = /* glsl */ `
  vec3 wp = vWorldPos_atmo;
  vec2 wd_uv = wp.xz / uWorldExtent + 0.5;
  vec4 wd = texture2D(uWorldData, wd_uv);

  float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);

  vec4 dFine  = texture2D(uDetail, wp.xz * 0.075);
  vec4 dMed   = texture2D(uDetail, wp.xz * 0.0115);
  vec4 dMacro = texture2D(uDetail, wp.xz * 0.00165);

  // Cliffs get a vertical projection. Without this, every XZ-projected layer
  // is constant down a vertical face and the whole mountain reads as vertical
  // stripes — so the macro and mid bands are re-projected too, not just detail.
  vec2 steepUv = (abs(vWNorm.x) > abs(vWNorm.z)) ? wp.zy : wp.xy;
  float steepBlend = smoothstep(0.38, 0.72, slope);
  vec4 dSteep = texture2D(uDetail, steepUv * 0.062);
  vec4 dSteepB = texture2D(uDetail, steepUv * 0.0092);
  dFine = mix(dFine, dSteep, steepBlend);

  float macro = mix(dMacro.a, dSteepB.a, steepBlend);
  float med = mix(dMed.r, dSteepB.r, steepBlend);

  // ---- splat weights ----
  float wRock = smoothstep(0.30, 0.60, slope + (med - 0.5) * 0.30);
  // snow settles on ledges and shoulders, never on a sheer face
  float wSnow = smoothstep(206.0, 292.0, wp.y + (macro - 0.5) * 96.0)
              * (1.0 - smoothstep(0.34, 0.66, slope));
  float wShore = (1.0 - smoothstep(0.5, 8.0, abs(wp.y - uLakeY))) * (1.0 - wRock) * step(0.05, wd.b);
  float wRoad = wd.r * (1.0 - wRock * 0.85) * (1.0 - wSnow);

  // ---- base colours ----
  vec3 grass = mix(uGrassA, uGrassB, macro);
  grass = mix(grass, uGrassDry, smoothstep(0.15, 0.55, wd.a) * (1.0 - smoothstep(0.55, 0.85, wd.a)));
  grass = mix(grass, uGrassAsh, smoothstep(0.58, 0.95, wd.a));
  grass *= 0.80 + dFine.r * 0.42;
  grass = mix(grass * vec3(0.84, 0.94, 0.86), grass, 1.0 - wd.b * 0.55);

  vec3 rock = mix(uRockA, uRockB, clamp(dFine.r * 0.65 + med * 0.55, 0.0, 1.0));
  rock *= 0.78 + mix(dMed.a, dSteepB.a, steepBlend) * 0.44;
  // high rock goes cold and pale, low rock keeps a warm cast
  rock = mix(rock * vec3(1.06, 1.0, 0.92), rock * vec3(0.94, 0.98, 1.08), smoothstep(120.0, 260.0, wp.y));

  vec3 snow = uSnow * (0.88 + dFine.r * 0.24);
  vec3 shore = uShore * (0.82 + dFine.r * 0.4);
  vec3 road = uRoad * (0.80 + dFine.r * 0.45);

  vec3 albedo = grass;
  albedo = mix(albedo, shore, clamp(wShore, 0.0, 1.0));
  albedo = mix(albedo, road, clamp(wRoad, 0.0, 1.0));
  albedo = mix(albedo, rock, wRock);
  albedo = mix(albedo, snow, wSnow);

  // baked occlusion from the world-data map plus a touch of cavity
  float ao = mix(0.55, 1.06, wd.g) * (0.86 + dMed.r * 0.20);
  albedo *= clamp(ao, 0.25, 1.15);

  diffuseColor.rgb = albedo;
`;

const TERRAIN_ROUGH = /* glsl */ `
  float rough = mix(0.96, 0.80, wRock);
  rough = mix(rough, 0.55, wSnow);
  rough = mix(rough, 0.88, clamp(wRoad, 0.0, 1.0));
  rough = mix(rough, 0.42, clamp(wShore * wd.b, 0.0, 1.0));
  float roughnessFactor = rough;
`;

const TERRAIN_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 g = (dFine.gb - 0.5) * 2.0;
  float amp = mix(0.30, 0.80, wRock) * (1.0 - wSnow * 0.6);
  vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), vWNorm) + vec3(1e-4, 0.0, 0.0));
  vec3 b = cross(vWNorm, t);
  vec3 pert = normalize(vWNorm + (t * g.x + b * g.y) * amp);
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(pert, 0.0)).xyz), 0.62));
}
`;

export class Terrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  private chunks: ChunkRec[] = [];
  private queue: ChunkRec[] = [];
  private _v = new THREE.Vector3();

  constructor(worldData: THREE.Texture) {
    const detail = Textures.detail;
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
      dithering: true,
    });
    applyAtmosphere(this.material, {
      key: 'terrain',
      uniforms: {
        // NB: THREE.Color already converts hex/CSS input out of sRGB at
        // construction (ColorManagement is on by default), so these are handed
        // to the shader in linear space as-is. Converting again would darken
        // every surface by roughly 4x.
        uDetail: { value: detail },
        uWorldData: { value: worldData },
        uWorldExtent: { value: WD_EXTENT },
        uGrassA: { value: new THREE.Color('#57713f') },
        uGrassB: { value: new THREE.Color('#7d9450') },
        uGrassDry: { value: new THREE.Color('#8a7239') },
        uGrassAsh: { value: new THREE.Color('#5c6353') },
        uRockA: { value: new THREE.Color('#5c5b57') },
        uRockB: { value: new THREE.Color('#948f85') },
        uSnow: { value: new THREE.Color('#e8eef6') },
        uShore: { value: new THREE.Color('#b6a887') },
        uRoad: { value: new THREE.Color('#8a7a63') },
        uLakeY: { value: LAKE_Y },
        uTerrainDebug: { value: DEBUG_MODE },
      },
      vertexPars: 'varying vec3 vWNorm;',
      vertexBody: 'vWNorm = normalize(mat3(modelMatrix) * objectNormal);',
      fragmentPars: TERRAIN_FRAG_PARS,
      fragmentBody: `
        if (uTerrainDebug > 2.5) { gl_FragColor = vec4(vec3(wd.g), 1.0); return; }
        if (uTerrainDebug > 1.5) { gl_FragColor = vec4(vWNorm * 0.5 + 0.5, 1.0); return; }
        if (uTerrainDebug > 0.5) { gl_FragColor = vec4(albedo, 1.0); return; }
      `,
      fragmentReplace: [
        ['#include <map_fragment>', TERRAIN_MAP],
        ['#include <roughnessmap_fragment>', TERRAIN_ROUGH],
        ['#include <normal_fragment_maps>', TERRAIN_NORMAL],
      ],
    });

    for (let j = 0; j < CHUNKS; j++) {
      for (let i = 0; i < CHUNKS; i++) {
        const cx = WORLD_MIN + i * CHUNK_SIZE;
        const cz = WORLD_MIN + j * CHUNK_SIZE;
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        mesh.position.set(cx + CHUNK_SIZE / 2, 0, cz + CHUNK_SIZE / 2);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.visible = false;
        mesh.name = `terrain_${i}_${j}`;
        this.group.add(mesh);
        this.chunks.push({
          i, j, cx, cz,
          centerX: cx + CHUNK_SIZE / 2, centerZ: cz + CHUNK_SIZE / 2,
          mesh, lod: -1, wanted: 3, cache: new Map(), minY: 0, maxY: 0,
        });
      }
    }
    this.group.name = 'terrain';
  }

  /** Build the chunks nearest a point synchronously — used during loading. */
  primeAround(x: number, z: number, count = 26) {
    const sorted = [...this.chunks].sort((a, b) =>
      (a.centerX - x) ** 2 + (a.centerZ - z) ** 2 - ((b.centerX - x) ** 2 + (b.centerZ - z) ** 2));
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const d = Math.hypot(c.centerX - x, c.centerZ - z);
      let lod = 3;
      for (let l = 0; l < LOD_DIST.length; l++) { if (d < LOD_DIST[l]) { lod = l; break; } }
      if (i > count) lod = Math.max(lod, 2);
      this.applyLod(c, lod);
    }
  }

  private applyLod(c: ChunkRec, lod: number) {
    let geo = c.cache.get(lod);
    if (!geo) {
      const built = buildChunkGeometry(c.cx, c.cz, CHUNK_SIZE, LOD_SEGS[lod]);
      geo = built.geo;
      c.minY = built.minY;
      c.maxY = built.maxY;
      c.cache.set(lod, geo);
      if (c.cache.size > 3) {
        for (const [k, g] of c.cache) {
          if (k !== lod && k !== c.lod) { g.dispose(); c.cache.delete(k); break; }
        }
      }
    }
    c.mesh.geometry = geo;
    c.mesh.visible = c.maxY > SEA_OF_CLOUD_Y - 60;
    c.lod = lod;
  }

  update(camera: THREE.Camera, budget = 2) {
    camera.getWorldPosition(this._v);
    const cx = this._v.x, cz = this._v.z;
    this.queue.length = 0;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.centerX - cx, c.centerZ - cz) - CHUNK_SIZE * 0.7);
      let lod = 3;
      for (let l = 0; l < LOD_DIST.length; l++) { if (d < LOD_DIST[l]) { lod = l; break; } }
      c.wanted = lod;
      if (lod !== c.lod) this.queue.push(c);
    }
    if (this.queue.length) {
      this.queue.sort((a, b) =>
        Math.hypot(a.centerX - cx, a.centerZ - cz) - Math.hypot(b.centerX - cx, b.centerZ - cz));
      const n = Math.min(budget, this.queue.length);
      for (let i = 0; i < n; i++) this.applyLod(this.queue[i], this.queue[i].wanted);
    }
  }

  dispose() {
    for (const c of this.chunks) {
      for (const g of c.cache.values()) g.dispose();
      c.cache.clear();
    }
    this.material.dispose();
  }
}

export { CHUNK_SIZE, CHUNKS };
