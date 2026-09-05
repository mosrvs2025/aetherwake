/**
 * REALMS — the height function.
 *
 * One analytic function defines the shape of the shelf. The renderer tessellates
 * it at several densities, the character controller samples it directly, and the
 * scatterers query it a few hundred thousand times at load. Because everything
 * reads the same function there is never a mismatch between what you see and
 * what you stand on, and LOD transitions cannot crack: normals are derived
 * analytically rather than from the triangles.
 */

import { Noise, clamp01, lerp, smoothstep, segDist, splinePoint } from '../core/math';
import { ROAD_MAIN, ROAD_LAKE, ROAD_RUIN } from './roads';
import {
  LAKE_Y, PADS, RIFT_HALF_WIDTH, RIFT_LIP, RIVER_LOWER, RIVER_UPPER,
  SHELF_INNER, SHELF_OUTER, riftCenterZ, VOID_Y,
} from './atlas';

const nMain = new Noise('realms-shelf-2');
const nRidge = new Noise('realms-ridge-7');
const nWarp = new Noise('realms-warp-3');
const nDetail = new Noise('realms-detail-11');
const nEdge = new Noise('realms-edge-5');

/* Pre-flatten the river splines into dense polylines so distance queries are
 * a cheap segment scan rather than a spline solve. */
function densify(pts: Array<[number, number]>, n: number) {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) out.push(splinePoint(pts, i / n));
  return out;
}
const RIVER_A = densify(RIVER_UPPER, 44);
const RIVER_B = densify(RIVER_LOWER, 72);

function polyDist(px: number, pz: number, poly: Array<[number, number]>) {
  let best = Infinity;
  let bestT = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    // cheap reject
    if (Math.abs(px - a[0]) > 420 && Math.abs(px - b[0]) > 420) continue;
    const r = segDist(px, pz, a[0], a[1], b[0], b[1]);
    if (r.d < best) { best = r.d; bestT = (i + r.t) / (poly.length - 1); }
  }
  return { d: best, t: bestT };
}

/** Lake basin: Mirrowmere, slightly lobed rather than a circle. */
function lakeMask(x: number, z: number) {
  const dx = x - 190, dz = z - 150;
  const a = Math.atan2(dz, dx);
  const r = Math.hypot(dx, dz);
  const wobble = 1 + 0.16 * Math.sin(a * 3 + 0.7) + 0.09 * Math.sin(a * 5 - 1.3);
  const R = 148 * wobble;
  return 1 - smoothstep(R * 0.62, R, r);
}

/* ------------------------------------------------------------------ *
 * The height function
 * ------------------------------------------------------------------ */

export function terrainHeight(x: number, z: number): number {
  // Domain warp keeps the ridges from looking like filtered noise.
  const wx = x + nWarp.noise2(x * 0.0019, z * 0.0019) * 96;
  const wz = z + nWarp.noise2(x * 0.0019 + 41.3, z * 0.0019 - 12.7) * 96;

  // Mountain masks — a great massif in the north, teeth along the east.
  const north = smoothstep(-40, -430, z);
  const eastTeeth = smoothstep(240, 560, x) * smoothstep(280, 40, z) * 0.8;
  const westWall = smoothstep(-330, -560, x) * smoothstep(420, 120, z) * 0.55;
  const massif = Math.min(1, north + eastTeeth + westWall);

  const rolling = nMain.fbm2(wx * 0.00165, wz * 0.00165, 5) * 0.5 + 0.5;
  const ridge = nRidge.ridged2(wx * 0.00118 + 3.1, wz * 0.00118 - 7.4, 6);
  const detail = nDetail.fbm2(x * 0.0092, z * 0.0092, 4);
  const micro = nDetail.fbm2(x * 0.052, z * 0.052, 2);

  let h = 12 + rolling * 96 + detail * 7.5 + micro * 1.6;
  h += Math.pow(ridge, 1.35) * 430 * massif;

  // A shoulder that lifts the whole north so the Keep sits on a true massif.
  h += north * 92;
  // Southern downs stay open and gentle so the opening vista reads clearly.
  h -= smoothstep(300, 640, z) * 18;

  // ---- Mirrowmere basin ----
  const lm = lakeMask(x, z);
  if (lm > 0) {
    const basin = LAKE_Y - 16 - lm * 22;
    h = lerp(h, basin, lm * lm * 0.98);
  }

  // ---- rivers ----
  const ra = polyDist(x, z, RIVER_A);
  if (ra.d < 130) {
    const cut = 1 - smoothstep(16, 118, ra.d);
    const bed = lerp(LAKE_Y + 118, LAKE_Y - 3, clamp01(ra.t));
    h = lerp(h, Math.min(h, bed), cut * 0.9);
  }
  const rb = polyDist(x, z, RIVER_B);
  if (rb.d < 150) {
    const cut = 1 - smoothstep(20, 132, rb.d);
    const bed = lerp(LAKE_Y - 2, LAKE_Y - 26, clamp01(rb.t));
    h = lerp(h, Math.min(h, bed), cut * 0.94);
  }

  // ---- the Rift ----
  const rc = riftCenterZ(x);
  const rd = Math.abs(z - rc);
  if (rd < RIFT_HALF_WIDTH + RIFT_LIP + 46) {
    const inner = 1 - smoothstep(RIFT_HALF_WIDTH, RIFT_HALF_WIDTH + RIFT_LIP, rd);
    const jag = nEdge.fbm2(x * 0.02, z * 0.02, 3) * 12;
    h = lerp(h, VOID_Y - 300 + jag, inner * inner);
    // raise a lip on both sides so the canyon reads from a distance
    const lip = smoothstep(RIFT_HALF_WIDTH + RIFT_LIP + 46, RIFT_HALF_WIDTH + RIFT_LIP + 4, rd) * (1 - inner);
    h += lip * 22;
  }

  // ---- authored building pads ----
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.radius + p.falloff) continue;
    const w = (1 - smoothstep(p.radius, p.radius + p.falloff, d)) * (p.strength ?? 1);
    h = lerp(h, p.y, w);
  }

  // ---- the King's Road: cut a walkable corridor ----
  if (roadsReady) {
    const road = roadInfluence(x, z);
    if (road.w > 0.001) {
      const jitter = nDetail.fbm2(x * 0.05, z * 0.05, 2) * 0.6;
      h = lerp(h, road.y + jitter, road.w * 0.94);
    }
  }

  // ---- the shelf edge: land ends, sky begins ----
  const r = Math.hypot(x, z);
  const edgeNoise = nEdge.fbm2(x * 0.0031, z * 0.0031, 4) * 92 + nEdge.noise2(x * 0.011, z * 0.011) * 16;
  const rr = r + edgeNoise;
  const shelf = 1 - smoothstep(SHELF_INNER, SHELF_OUTER, rr);
  if (shelf < 1) {
    // Vertical break, then a plunge that keeps going past the cloud deck.
    const fall = Math.pow(1 - shelf, 1.7);
    h = lerp(h, VOID_Y - 620, fall);
    // A rocky lip right at the break
    h += (1 - Math.abs(shelf - 0.86) / 0.14 > 0 ? (1 - Math.abs(shelf - 0.86) / 0.14) : 0) * 16;
  }

  return h;
}

/* ------------------------------------------------------------------ *
 * The King's Road.
 *
 * A world you cannot walk across is a diorama. The road is graded once at
 * module load: raw terrain height is sampled along each spline, smoothed, then
 * clamped to a maximum grade so the route from the Watcher's Cliff to Skyfall
 * Keep is always climbable. `terrainHeight` then blends toward that profile
 * inside a narrow corridor, cutting into hillsides and bridging small dips.
 *
 * Segments are bucketed into a coarse grid so the per-sample cost is a handful
 * of distance tests rather than a scan of the whole network.
 * ------------------------------------------------------------------ */

interface RoadNode { x: number; z: number; y: number }

const ROAD_CELL = 72;
const roadCells = new Map<number, number[]>();
const roadNodes: RoadNode[][] = [];
const ROAD_WIDTH = 7.0;
const ROAD_SHOULDER = 34;
let roadsReady = false;

function roadKey(ix: number, iz: number) { return ix * 92837111 ^ iz * 689287499; }

function gradeRoad(pts: Array<[number, number]>, perSegment: number, maxGrade: number): RoadNode[] {
  const dense = densify(pts, Math.max(32, pts.length * perSegment));
  const raw = dense.map(([x, z]) => terrainHeight(x, z));
  // smooth
  const smooth = raw.slice();
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < smooth.length - 1; i++) {
      smooth[i] = (smooth[i - 1] + smooth[i] * 2 + smooth[i + 1]) * 0.25;
    }
  }
  // clamp the grade in both directions so the profile is monotone-ish and gentle
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < smooth.length; i++) {
      const d = Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]) || 1;
      const dy = smooth[i] - smooth[i - 1];
      const max = d * maxGrade;
      if (dy > max) smooth[i] = smooth[i - 1] + max;
      else if (dy < -max) smooth[i] = smooth[i - 1] - max;
    }
    for (let i = smooth.length - 2; i >= 0; i--) {
      const d = Math.hypot(dense[i][0] - dense[i + 1][0], dense[i][1] - dense[i + 1][1]) || 1;
      const dy = smooth[i] - smooth[i + 1];
      const max = d * maxGrade;
      if (dy > max) smooth[i] = smooth[i + 1] + max;
      else if (dy < -max) smooth[i] = smooth[i + 1] - max;
    }
  }
  return dense.map(([x, z], i) => ({ x, z, y: smooth[i] }));
}

function buildRoads() {
  if (roadsReady) return;
  const specs: Array<[Array<[number, number]>, number, number]> = [
    [ROAD_MAIN, 26, 0.30],
    [ROAD_LAKE, 14, 0.34],
    [ROAD_RUIN, 12, 0.34],
  ];
  for (const [pts, per, grade] of specs) {
    const nodes = gradeRoad(pts, per, grade);
    const idx = roadNodes.length;
    roadNodes.push(nodes);
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      const minX = Math.min(a.x, b.x) - ROAD_SHOULDER, maxX = Math.max(a.x, b.x) + ROAD_SHOULDER;
      const minZ = Math.min(a.z, b.z) - ROAD_SHOULDER, maxZ = Math.max(a.z, b.z) + ROAD_SHOULDER;
      for (let cz = Math.floor(minZ / ROAD_CELL); cz <= Math.floor(maxZ / ROAD_CELL); cz++) {
        for (let cx = Math.floor(minX / ROAD_CELL); cx <= Math.floor(maxX / ROAD_CELL); cx++) {
          const k = roadKey(cx, cz);
          let arr = roadCells.get(k);
          if (!arr) { arr = []; roadCells.set(k, arr); }
          arr.push(idx * 100000 + i);
        }
      }
    }
  }
  // only now may terrainHeight consult the corridor — grading must sample the
  // raw landscape, not a road that is still being laid
  roadsReady = true;
}

/** Corridor influence at a point: how strongly, and toward what elevation. */
export function roadInfluence(x: number, z: number): { w: number; y: number } {
  if (!roadsReady) return { w: 0, y: 0 };
  const arr = roadCells.get(roadKey(Math.floor(x / ROAD_CELL), Math.floor(z / ROAD_CELL)));
  if (!arr) return { w: 0, y: 0 };
  let bestD = Infinity, bestY = 0;
  for (let k = 0; k < arr.length; k++) {
    const packed = arr[k];
    const nodes = roadNodes[Math.floor(packed / 100000)];
    const i = packed % 100000;
    const a = nodes[i], b = nodes[i + 1];
    const r = segDist(x, z, a.x, a.z, b.x, b.z);
    if (r.d < bestD) { bestD = r.d; bestY = lerp(a.y, b.y, r.t); }
  }
  if (bestD > ROAD_WIDTH + ROAD_SHOULDER) return { w: 0, y: 0 };
  // A long, soft shoulder: the cut reads as a graded pass rather than a slot
  // canyon when the road has to cross a mountainside.
  const w = 1 - smoothstep(ROAD_WIDTH, ROAD_WIDTH + ROAD_SHOULDER, bestD);
  return { w: Math.pow(w, 1.55), y: bestY };
}

/** Graded elevation of the road network, for prop placement. */
export function roadHeightAt(x: number, z: number) {
  const r = roadInfluence(x, z);
  return r.w > 0.5 ? r.y : terrainHeight(x, z);
}

/** Analytic-ish normal via central differences. Stable across LODs. */
const EPS = 0.85;
export function terrainNormal(x: number, z: number, out: { x: number; y: number; z: number }) {
  const hL = terrainHeight(x - EPS, z);
  const hR = terrainHeight(x + EPS, z);
  const hD = terrainHeight(x, z - EPS);
  const hU = terrainHeight(x, z + EPS);
  const nx = hL - hR;
  const ny = 2 * EPS;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / len; out.y = ny / len; out.z = nz / len;
  return out;
}

const _n = { x: 0, y: 1, z: 0 };
/** 0 = flat ground, 1 = vertical wall. */
export function terrainSlope(x: number, z: number) {
  terrainNormal(x, z, _n);
  return 1 - clamp01(_n.y);
}

/** True where the shelf still exists (used to stop scatter over the void). */
export function onShelf(x: number, z: number) {
  return terrainHeight(x, z) > VOID_Y * 0.5;
}

/** Signed height above the lake surface; negative means submerged. */
export function aboveWater(x: number, z: number) {
  return terrainHeight(x, z) - LAKE_Y;
}

/** Is this point inside a body of water (lake or river channel)? */
export function isWaterSurface(x: number, z: number) {
  const h = terrainHeight(x, z);
  if (h > LAKE_Y) return false;
  if (h < VOID_Y) return false;
  if (lakeMask(x, z) > 0.05) return true;
  if (polyDist(x, z, RIVER_A).d < 42) return true;
  if (polyDist(x, z, RIVER_B).d < 46) return true;
  return false;
}

export function riverDistance(x: number, z: number) {
  return Math.min(polyDist(x, z, RIVER_A).d, polyDist(x, z, RIVER_B).d);
}

export { RIVER_A, RIVER_B, lakeMask };


// Grade the roads once the height function above is fully defined.
buildRoads();
