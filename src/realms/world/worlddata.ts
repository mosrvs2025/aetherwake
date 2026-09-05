/**
 * REALMS — the baked world-data map.
 *
 * One 512x512 RGBA texture, generated in about a fifth of a second at load,
 * carries four channels of information the terrain shader would otherwise have
 * to recompute per pixel:
 *
 *   R — the road/path network (rasterised from splines)
 *   G — multi-scale ambient occlusion baked from the heightfield
 *   B — moisture (proximity to the lake and the two rivers)
 *   A — region identity, used to shift the grass palette between biomes
 *
 * Baking it once is what lets the shelf read as an authored place rather than
 * as noise: roads carve, valleys darken, riverbanks green up.
 */

import * as THREE from 'three';
import { clamp01, lerp, smoothstep, splinePoint } from '../core/math';
import { terrainHeight, lakeMask, RIVER_A, RIVER_B } from './heightfield';
import { ROAD_MAIN, ROAD_LAKE, ROAD_RUIN } from './roads';
import { LAKE_Y } from './atlas';

export const WD_SIZE = 512;
export const WD_EXTENT = 2240;         // world units covered, centred on origin
export const WD_HALF = WD_EXTENT / 2;

export { ROAD_MAIN, ROAD_LAKE, ROAD_RUIN };

function densify(pts: Array<[number, number]>, per = 6) {
  const out: Array<[number, number]> = [];
  const n = Math.max(2, pts.length * per);
  for (let i = 0; i <= n; i++) out.push(splinePoint(pts, i / n));
  return out;
}

export const ROADS = [ROAD_MAIN, ROAD_LAKE, ROAD_RUIN].map((r) => densify(r, 10));

const w2t = (v: number) => ((v + WD_HALF) / WD_EXTENT) * WD_SIZE;
const t2w = (v: number) => (v / WD_SIZE) * WD_EXTENT - WD_HALF;

function stamp(buf: Float32Array, x: number, y: number, radius: number, value: number) {
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(x) - r), x1 = Math.min(WD_SIZE - 1, Math.floor(x) + r);
  const y0 = Math.max(0, Math.floor(y) - r), y1 = Math.min(WD_SIZE - 1, Math.floor(y) + r);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const d = Math.hypot(px - x, py - y) / radius;
      if (d > 1) continue;
      const f = value * (1 - d * d);
      const i = py * WD_SIZE + px;
      if (f > buf[i]) buf[i] = f;
    }
  }
}

function boxBlur(src: Float32Array, dst: Float32Array, radius: number) {
  const n = WD_SIZE;
  const tmp = new Float32Array(n * n);
  const inv = 1 / (radius * 2 + 1);
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * n + Math.min(n - 1, Math.max(0, x))];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = acc * inv;
      const add = Math.min(n - 1, x + radius + 1);
      const sub = Math.max(0, x - radius);
      acc += src[y * n + add] - src[y * n + sub];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(n - 1, Math.max(0, y)) * n + x];
    for (let y = 0; y < n; y++) {
      dst[y * n + x] = acc * inv;
      const add = Math.min(n - 1, y + radius + 1);
      const sub = Math.max(0, y - radius);
      acc += tmp[add * n + x] - tmp[sub * n + x];
    }
  }
}

export interface WorldDataResult {
  texture: THREE.DataTexture;
  /** Half-float R texture of terrain height, remapped to (h + 400) / 1200. */
  heightTexture: THREE.DataTexture;
  heights: Float32Array;
  roadMask: Float32Array;
  /** Sample the baked road mask in world space (0..1). */
  roadAt(x: number, z: number): number;
  aoAt(x: number, z: number): number;
}

export function buildWorldData(): WorldDataResult {
  const n = WD_SIZE;
  const heights = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const wz = t2w(y + 0.5);
    for (let x = 0; x < n; x++) {
      heights[y * n + x] = terrainHeight(t2w(x + 0.5), wz);
    }
  }

  // ---- ambient occlusion from multi-scale curvature ----
  const blurA = new Float32Array(n * n);
  const blurB = new Float32Array(n * n);
  boxBlur(heights, blurA, 3);
  boxBlur(heights, blurB, 13);
  const ao = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const h = heights[i];
    const local = clamp01((h - blurA[i]) / 18 + 0.5);
    const wide = clamp01((h - blurB[i]) / 70 + 0.5);
    ao[i] = clamp01(0.40 + local * 0.34 + wide * 0.42);
  }

  // ---- roads ----
  const road = new Float32Array(n * n);
  for (const path of ROADS) {
    for (let i = 0; i < path.length; i++) {
      const [wx, wz] = path[i];
      const h = terrainHeight(wx, wz);
      // roads do not survive on cliffs or over the void
      if (h < -100) continue;
      stamp(road, w2t(wx), w2t(wz), 1.25, 1.0);
    }
  }
  const roadSoft = new Float32Array(n * n);
  boxBlur(road, roadSoft, 2);
  for (let i = 0; i < n * n; i++) roadSoft[i] = clamp01(Math.max(road[i], roadSoft[i] * 1.45));

  // ---- moisture ----
  const moist = new Float32Array(n * n);
  for (const river of [RIVER_A, RIVER_B]) {
    for (const [wx, wz] of river) stamp(moist, w2t(wx), w2t(wz), 12, 1.0);
  }
  for (let y = 0; y < n; y++) {
    const wz = t2w(y + 0.5);
    for (let x = 0; x < n; x++) {
      const wx = t2w(x + 0.5);
      const i = y * n + x;
      const lm = lakeMask(wx, wz);
      if (lm > 0) moist[i] = Math.max(moist[i], smoothstep(0.0, 0.35, lm));
      // low ground near lake level stays lush
      const h = heights[i];
      if (h > LAKE_Y - 4 && h < LAKE_Y + 24) moist[i] = Math.max(moist[i], 0.35 * (1 - smoothstep(LAKE_Y + 6, LAKE_Y + 24, h)));
    }
  }
  const moistSoft = new Float32Array(n * n);
  boxBlur(moist, moistSoft, 4);

  // ---- regions ----
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const wz = t2w(y + 0.5);
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      // 0 = sunward downs, 0.34 = emberpine, 0.67 = ashen march, 1 = keep ward
      let region = 0;
      region = lerp(region, 0.34, smoothstep(560, 400, wz) * smoothstep(140, 300, wz));
      region = lerp(region, 0.67, smoothstep(60, -160, wz));
      region = lerp(region, 1.0, smoothstep(-330, -470, wz));
      const roadHere = clamp01(roadSoft[i]);
      data[i * 4 + 0] = Math.round(roadHere * 255);
      data[i * 4 + 1] = Math.round(clamp01(ao[i]) * 255);
      data[i * 4 + 2] = Math.round(clamp01(Math.max(moist[i], moistSoft[i] * 1.4)) * 255);
      data[i * 4 + 3] = Math.round(clamp01(region) * 255);
    }
  }

  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const sampleF = (buf: Float32Array, x: number, z: number) => {
    const tx = clamp01(w2t(x) / n) * (n - 1);
    const tz = clamp01(w2t(z) / n) * (n - 1);
    const x0 = Math.floor(tx), z0 = Math.floor(tz);
    const x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
    const fx = tx - x0, fz = tz - z0;
    return lerp(
      lerp(buf[z0 * n + x0], buf[z0 * n + x1], fx),
      lerp(buf[z1 * n + x0], buf[z1 * n + x1], fx),
      fz,
    );
  };

  // Height texture for water depth, shoreline foam and shoreline scatter.
  const hf = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) hf[i] = THREE.DataUtils.toHalfFloat(clamp01((heights[i] + 400) / 1200));
  const heightTexture = new THREE.DataTexture(hf, n, n, THREE.RedFormat, THREE.HalfFloatType);
  heightTexture.wrapS = heightTexture.wrapT = THREE.ClampToEdgeWrapping;
  heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.minFilter = THREE.LinearFilter;
  heightTexture.needsUpdate = true;

  return {
    texture,
    heightTexture,
    heights,
    roadMask: roadSoft,
    roadAt: (x, z) => sampleF(roadSoft, x, z),
    aoAt: (x, z) => sampleF(ao, x, z),
  };
}
