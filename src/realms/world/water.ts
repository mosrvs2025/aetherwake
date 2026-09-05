/**
 * REALMS — water.
 *
 * One material covers the lake, the rivers and the still pools. It uses:
 *   - summed Gerstner waves in the vertex stage (real displacement, so the
 *     shoreline actually laps),
 *   - two scrolling detail-normal layers whose direction comes from a per-vertex
 *     flow attribute, so rivers run downhill and the lake only breathes,
 *   - a Fresnel blend between the analytic sky colour (reflection) and a
 *     depth-tinted body colour sampled from the baked heightfield,
 *   - shoreline foam and flow-aligned whitewater derived from that same depth.
 */

import * as THREE from 'three';
import { ATMO_PARS, atmo } from '../core/atmosphere';
import { Textures } from './textures';
import { LAKE_Y } from './atlas';
import { WD_EXTENT } from './worlddata';
import { terrainHeight, RIVER_A, RIVER_B, lakeMask } from './heightfield';
import { lerp } from '../core/math';

const WATER_PARS = /* glsl */ `
uniform sampler2D uDetail;
uniform sampler2D uHeight;
uniform float uWorldExtent;
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec2 vFlow;
varying float vWaveH;
`;

const WATER_VERT_PARS = /* glsl */ `
attribute vec2 flow;
varying vec2 vFlow;
varying float vWaveH;
uniform float uTime;

vec3 gerstner(vec2 p, vec2 dir, float amp, float wavelength, float speed, float steep, out vec3 disp) {
  float k = 6.28318 / wavelength;
  float c = sqrt(9.8 / k) * speed;
  float f = k * (dot(dir, p) - c * uTime);
  float a = amp;
  disp = vec3(dir.x * (steep * a * cos(f)), a * sin(f), dir.y * (steep * a * cos(f)));
  return disp;
}
`;

const WATER_VERT_BODY = /* glsl */ `
  vFlow = flow;
`;

/** Applied at begin_vertex so the displacement is real geometry. */
const WATER_DISPLACE = /* glsl */ `
  vec3 transformed = vec3(position);
  {
    vec3 wpos = (modelMatrix * vec4(position, 1.0)).xyz;
    vec2 p = wpos.xz;
    float still = 1.0 - clamp(length(flow) * 3.0, 0.0, 1.0);
    vec3 d1, d2, d3;
    gerstner(p, normalize(vec2(0.86, 0.51)), 0.34 * still + 0.06, 21.0, 1.0, 0.55, d1);
    gerstner(p, normalize(vec2(-0.42, 0.91)), 0.20 * still + 0.05, 12.5, 1.2, 0.5, d2);
    gerstner(p, normalize(vec2(0.31, -0.95)), 0.10 * still + 0.04, 6.5, 1.5, 0.4, d3);
    vec3 sum = d1 + d2 + d3;
    transformed += sum;
    vWaveH = sum.y;
  }
`;

const WATER_FRAG = /* glsl */ `
  vec3 wp = vWorldPos_atmo;
  vec2 hUv = wp.xz / uWorldExtent + 0.5;
  float bed = texture2D(uHeight, hUv).r * 1200.0 - 400.0;
  float depth = clamp(wp.y - bed, 0.0, 40.0);

  // --- flowing detail normals ---
  vec2 fl = vFlow;
  float speed = length(fl);
  vec2 fdir = speed > 0.001 ? fl / speed : vec2(0.0, 1.0);
  vec2 scroll1 = -fdir * uTime * (0.6 + speed * 5.0);
  vec2 scroll2 = -fdir * uTime * (0.34 + speed * 3.1) + vec2(uTime * 0.02, uTime * -0.015);

  vec4 n1 = texture2D(uDetail, wp.xz * 0.145 + scroll1 * 0.06);
  vec4 n2 = texture2D(uDetail, wp.xz * 0.042 + scroll2 * 0.045 + 0.37);
  vec2 g = ((n1.gb - 0.5) * 1.8 + (n2.gb - 0.5) * 1.5);
  float rippleAmp = mix(1.15, 2.6, clamp(speed * 6.0, 0.0, 1.0));
  vec3 nrm = normalize(vec3(g.x * rippleAmp, 1.0, g.y * rippleAmp));

  vec3 viewDir = normalize(cameraPosition - wp);
  float fres = pow(1.0 - clamp(dot(viewDir, nrm), 0.0, 1.0), 4.0);
  fres = mix(0.030, 0.92, fres);

  vec3 refl = realmsSkyColor(reflect(-viewDir, nrm));
  // the sun's specular highlight, sharpened
  float spec = pow(clamp(dot(reflect(-viewDir, nrm), uSunDir), 0.0, 1.0), 340.0);
  refl += uSunColor * spec * 22.0;

  vec3 body = mix(uShallow, uDeep, clamp(depth / 10.0, 0.0, 1.0));
  // scatter a bit of sun through the shallows
  body += uSunColor * 0.075 * (1.0 - clamp(depth / 6.0, 0.0, 1.0));
  // a slow band of caustic-ish brightening reads as depth without a depth pass
  body *= 0.86 + texture2D(uDetail, wp.xz * 0.018 - scroll2 * 0.02).a * 0.42;

  vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0));

  // --- foam ---
  float shore = 1.0 - smoothstep(0.05, 1.5, depth);
  float wobble = texture2D(uDetail, wp.xz * 0.22 + scroll1 * 0.2).r;
  float foam = smoothstep(0.45, 0.95, shore * (0.55 + wobble * 0.9));
  float rapids = smoothstep(0.055, 0.16, speed) * smoothstep(0.35, 0.8, wobble * (0.6 + n2.r * 0.8));
  foam = clamp(foam + rapids * 0.85, 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.92);

  gl_FragColor = vec4(col, mix(0.86, 1.0, clamp(depth * 0.6, 0.0, 1.0)));
  gl_FragColor.a = max(gl_FragColor.a, foam);
  gl_FragColor.rgb = realmsApplyFog(gl_FragColor.rgb, cameraPosition, wp);
`;

const WATER_VERT = /* glsl */ `
${''}
varying vec3 vWorldPos_atmo;
${WATER_VERT_PARS}
void main() {
  ${WATER_DISPLACE}
  ${WATER_VERT_BODY}
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos_atmo = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG_FULL = /* glsl */ `
precision highp float;
${ATMO_PARS}
${WATER_PARS}
void main() {
${WATER_FRAG}
}
`;

export function makeWaterMaterial(heightTexture: THREE.Texture) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG_FULL,
    uniforms: {
      ...atmo,
      uTime: atmo.uTime,
      uDetail: { value: Textures.detail },
      uHeight: { value: heightTexture },
      uWorldExtent: { value: WD_EXTENT },
      uShallow: { value: new THREE.Color('#3e8f95') },
      uDeep: { value: new THREE.Color('#08283f') },
      uFoam: { value: new THREE.Color('#dbeef2') },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    fog: false,
  });
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/** Lake surface: a subdivided plane clipped to the basin. */
function buildLakeGeometry() {
  const size = 420, segs = 120;
  const cxw = 190, czw = 150;
  const pos: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const vpr = segs + 1;
  const map = new Int32Array(vpr * vpr).fill(-1);
  let count = 0;
  for (let j = 0; j < vpr; j++) {
    for (let i = 0; i < vpr; i++) {
      const x = cxw - size / 2 + (i / segs) * size;
      const z = czw - size / 2 + (j / segs) * size;
      if (lakeMask(x, z) < 0.012) continue;
      map[j * vpr + i] = count++;
      pos.push(x, LAKE_Y, z);
      flow.push(0, 0);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = map[j * vpr + i], b = map[j * vpr + i + 1];
      const c = map[(j + 1) * vpr + i], d = map[(j + 1) * vpr + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * River ribbon: follows the carved bed, widening downstream, with a per-vertex
 * flow vector so the shader scrolls the surface in the direction of travel.
 */
function buildRiverGeometry(
  spline: Array<[number, number]>,
  widthStart: number,
  widthEnd: number,
  liftStart: number,
  liftEnd: number,
) {
  const pos: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const n = spline.length;
  const cols = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [x, z] = spline[i];
    const [px, pz] = spline[Math.max(0, i - 1)];
    const [nx, nz] = spline[Math.min(n - 1, i + 1)];
    let dx = nx - px, dz = nz - pz;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const sx = -dz, sz = dx;
    const w = lerp(widthStart, widthEnd, t);
    // surface height: sit slightly above the carved bed, monotone downstream
    const bed = terrainHeight(x, z);
    const y = bed + lerp(liftStart, liftEnd, t);
    for (let c = 0; c < cols; c++) {
      const u = (c / (cols - 1)) * 2 - 1;
      const bank = 1 - u * u * 0.55;
      pos.push(x + sx * u * w, y - (1 - bank) * 0.9, z + sz * u * w);
      const sp = lerp(0.075, 0.055, t) * (0.55 + bank * 0.6);
      flow.push(dx * sp, dz * sp);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Monotone-ise river surface heights so water never appears to flow uphill. */
function flattenUphill(geo: THREE.BufferGeometry, cols: number) {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const rows = p.count / cols;
  let prev = Infinity;
  for (let i = 0; i < rows; i++) {
    let rowY = -Infinity;
    for (let c = 0; c < cols; c++) rowY = Math.max(rowY, p.getY(i * cols + c));
    const y = Math.min(rowY, prev);
    for (let c = 0; c < cols; c++) p.setY(i * cols + c, Math.min(p.getY(i * cols + c), y));
    prev = y + 0.02;
  }
  p.needsUpdate = true;
}

export class Water {
  group = new THREE.Group();
  material: THREE.ShaderMaterial;

  constructor(heightTexture: THREE.Texture) {
    this.material = makeWaterMaterial(heightTexture);

    const lake = new THREE.Mesh(buildLakeGeometry(), this.material);
    lake.renderOrder = 5;
    lake.name = 'lake';
    this.group.add(lake);

    const upper = buildRiverGeometry(RIVER_A, 9, 15, 1.6, 2.2);
    flattenUphill(upper, 9);
    const upperMesh = new THREE.Mesh(upper, this.material);
    upperMesh.renderOrder = 5;
    upperMesh.name = 'riverUpper';
    this.group.add(upperMesh);

    const lower = buildRiverGeometry(RIVER_B, 14, 22, 2.0, 2.6);
    flattenUphill(lower, 9);
    const lowerMesh = new THREE.Mesh(lower, this.material);
    lowerMesh.renderOrder = 5;
    lowerMesh.name = 'riverLower';
    this.group.add(lowerMesh);

    this.group.name = 'water';
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.material.dispose();
  }
}

/** Water height at a world point, or null if there is no water there. */
export function waterLevelAt(x: number, z: number): number | null {
  if (lakeMask(x, z) > 0.02) return LAKE_Y;
  const h = terrainHeight(x, z);
  let best: number | null = null;
  for (const river of [RIVER_A, RIVER_B]) {
    for (let i = 0; i < river.length; i++) {
      const [rx, rz] = river[i];
      const d = Math.hypot(rx - x, rz - z);
      if (d < 24) {
        const surf = terrainHeight(rx, rz) + 2.1;
        if (surf > h - 1.0) best = Math.max(best ?? -Infinity, surf);
      }
    }
  }
  return best;
}
