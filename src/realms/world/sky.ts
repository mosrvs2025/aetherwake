/**
 * REALMS — sky, cloud sea and drifting cloud banks.
 *
 * The shelf floats above an endless deck of cloud. Three layers sell it:
 *   1. an analytic sky dome (Rayleigh-ish gradient + sun disc + cirrus),
 *   2. a shaded, domain-warped cloud sea 140 units below the land, and
 *   3. soft volumetric-looking cloud banks that drift through the world and
 *      swallow the waterfalls.
 * All three read the shared atmosphere uniforms so they stay colour-matched.
 */

import * as THREE from 'three';
import { atmo, ATMO_PARS } from '../core/atmosphere';
import { SEA_OF_CLOUD_Y } from './atlas';

const GLSL_NOISE = /* glsl */ `
vec3 hash33(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(mix(dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
                        dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                    mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                        dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
                mix(mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                        dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                    mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                        dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  return n * 0.5 + 0.5;
}
float fbm3(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    s += a * vnoise(p); n += a; a *= 0.5; p *= 2.02;
  }
  return s / n;
}
`;

/* ------------------------------------------------------------------ *
 * Sky dome
 * ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mvp = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = mvp.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uTime;
uniform float uCirrus;
uniform float uReveal;
${GLSL_NOISE}

void main() {
  vec3 dir = normalize(vDir);
  float y = dir.y;

  // --- base gradient -------------------------------------------------
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 col = mix(uSkyHorizon, uSkyZenith, t);

  // horizon bloom: light scattered through a lot of air
  float hb = pow(1.0 - abs(y), 10.0);
  col += uSkyHorizon * hb * 0.22;

  // below the horizon we are looking into the cloud sea's glow
  col = mix(col * vec3(1.02, 1.0, 0.96), col, smoothstep(-0.30, 0.02, y));

  // --- sun -----------------------------------------------------------
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * pow(sd, 11.0) * 0.24;
  col += uSunColor * pow(sd, 90.0) * 0.42;
  float disc = smoothstep(0.99958, 0.99986, sd);
  col += uSunColor * disc * 13.0;
  // a tight halo that post-processing turns into real glare
  col += uSunColor * pow(sd, 1600.0) * 1.5;

  // --- cirrus --------------------------------------------------------
  if (y > 0.008) {
    vec2 p = dir.xz / max(y, 0.008);
    vec3 q = vec3(p * 0.055, uTime * 0.004);
    float c1 = fbm3(q + vec3(uTime * 0.008, 0.0, 0.0), 5);
    float c2 = fbm3(q * 2.7 + vec3(11.0, 3.0, uTime * 0.01), 4);
    float sheet = smoothstep(0.52, 0.86, c1 * 0.7 + c2 * 0.42);
    sheet *= smoothstep(0.0, 0.30, y) * smoothstep(1.0, 0.35, y);
    float lit = pow(clamp(dot(dir, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
    vec3 cc = mix(vec3(0.80, 0.84, 0.92), uSunColor * 1.35, lit);
    col = mix(col, cc, sheet * uCirrus);
  }

  // --- very high, very slow contrail-like streaks for scale ----------
  col *= uReveal;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uSunDir: atmo.uSunDir,
        uSunColor: atmo.uSunColor,
        uSkyZenith: atmo.uSkyZenith,
        uSkyHorizon: atmo.uSkyHorizon,
        uTime: atmo.uTime,
        uReveal: atmo.uReveal,
        uCirrus: { value: 0.62 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 28), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10000;
    this.mesh.name = 'sky';
  }
}

/* ------------------------------------------------------------------ *
 * Cloud sea — the floor of the world
 * ------------------------------------------------------------------ */

const SEA_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SEA_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
${ATMO_PARS}
${GLSL_NOISE}
uniform float uTime;
uniform float uReveal;

float clouds(vec2 p, out float hgt) {
  vec2 drift = vec2(uTime * 0.55, uTime * 0.31);
  vec3 q = vec3((p + drift) * 0.0022, uTime * 0.012);
  float base = fbm3(q, 5);
  // domain warp so the billows curl instead of looking like static
  vec2 w = vec2(fbm3(q * 1.7 + 3.1, 3), fbm3(q * 1.7 - 7.3, 3)) - 0.5;
  float det = fbm3(vec3((p + drift + w * 420.0) * 0.0075, uTime * 0.02), 5);
  float d = base * 0.68 + det * 0.42;
  hgt = d;
  return smoothstep(0.36, 0.78, d);
}

void main() {
  vec2 p = vWorld.xz;
  float h;
  float c = clouds(p, h);

  // fake relief lighting from the noise gradient
  float e = 26.0;
  float ha, hb, hc;
  clouds(p + vec2(e, 0.0), ha);
  clouds(p + vec2(0.0, e), hb);
  clouds(p - vec2(e, 0.0), hc);
  vec3 n = normalize(vec3((hc - ha) * 260.0, 1.0, (h - hb) * 260.0));
  float ndl = clamp(dot(n, uSunDir) * 0.5 + 0.55, 0.0, 1.2);

  vec3 shadow = vec3(0.46, 0.52, 0.66);
  vec3 lit = uSunColor * 1.32;
  vec3 col = mix(shadow, lit, pow(ndl, 1.5));
  // silver linings
  col += uSunColor * pow(clamp(c, 0.0, 1.0), 5.0) * 0.35;
  // the gaps between clouds fall away into blue depth
  vec3 deep = vec3(0.30, 0.40, 0.58);
  col = mix(deep, col, clamp(c * 1.25, 0.0, 1.0));

  col = realmsApplyFog(col, cameraPosition, vWorld);
  gl_FragColor = vec4(col * uReveal, 1.0);
}
`;

export class CloudSea {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor(radius = 9000) {
    const geo = new THREE.CircleGeometry(radius, 96);
    geo.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      uniforms: {
        ...atmo,
        uTime: atmo.uTime,
        uReveal: atmo.uReveal,
      },
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = SEA_OF_CLOUD_Y;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;
    this.mesh.name = 'cloudSea';
  }
}

/* ------------------------------------------------------------------ *
 * Cloud banks — soft camera-facing volumes that pass through the world
 * ------------------------------------------------------------------ */

const BANK_VERT = /* glsl */ `
attribute vec4 aInst;    // xyz = center, w = radius
attribute vec4 aParam;   // x = seed, y = opacity, z = squash, w = speed
varying vec2 vUv;
varying float vSeed;
varying float vOpacity;
varying vec3 vWorld;
uniform float uTime;
void main() {
  vUv = uv;
  vSeed = aParam.x;
  vOpacity = aParam.y;
  vec3 center = aInst.xyz;
  center.x += sin(uTime * aParam.w * 0.11 + aParam.x) * 60.0 + uTime * aParam.w * 2.4;
  center.z += cos(uTime * aParam.w * 0.09 + aParam.x * 1.7) * 40.0;
  center.x = mod(center.x + 4000.0, 8000.0) - 4000.0;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center
    + camRight * position.x * aInst.w
    + camUp * position.y * aInst.w * aParam.z;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const BANK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vSeed;
varying float vOpacity;
varying vec3 vWorld;
${ATMO_PARS}
${GLSL_NOISE}
uniform float uTime;
uniform float uReveal;

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float shape = fbm3(vec3(c * 1.9 + vSeed, uTime * 0.03 + vSeed), 4);
  float a = smoothstep(1.0, 0.12, r + (shape - 0.5) * 0.85);
  a *= vOpacity;
  if (a < 0.004) discard;

  // Light the puff from the sun using the fake sphere normal.
  vec3 n = normalize(vec3(c, sqrt(max(0.0, 1.0 - r * r))));
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 wn = normalize(camRight * n.x + camUp * n.y - camFwd * n.z);
  float ndl = clamp(dot(wn, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.52, 0.58, 0.72), uSunColor * 1.25, pow(ndl, 1.6));
  col += uSunColor * pow(ndl, 8.0) * 0.5;

  // A bank that the camera has walked into must not white out the frame.
  float dist = length(vWorld - cameraPosition);
  a *= smoothstep(30.0, 150.0, dist);
  if (a < 0.004) discard;

  float f = realmsFogAmount(cameraPosition, vWorld);
  col = mix(col, realmsSkyColor(normalize(vWorld - cameraPosition)), f * 0.85);
  gl_FragColor = vec4(col * uReveal, a);
}
`;

export class CloudBanks {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor(count = 90, opts: { yMin: number; yMax: number; spread: number; radius: [number, number] }) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    const inst = new Float32Array(count * 4);
    const param = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * opts.spread;
      inst[i * 4 + 0] = Math.cos(a) * rr;
      inst[i * 4 + 1] = opts.yMin + Math.random() * (opts.yMax - opts.yMin);
      inst[i * 4 + 2] = Math.sin(a) * rr;
      inst[i * 4 + 3] = opts.radius[0] + Math.random() * (opts.radius[1] - opts.radius[0]);
      param[i * 4 + 0] = Math.random() * 40;
      param[i * 4 + 1] = 0.35 + Math.random() * 0.5;
      param[i * 4 + 2] = 0.42 + Math.random() * 0.35;
      param[i * 4 + 3] = 0.4 + Math.random() * 1.4;
    }
    geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
    geo.setAttribute('aParam', new THREE.InstancedBufferAttribute(param, 4));

    this.material = new THREE.ShaderMaterial({
      vertexShader: BANK_VERT,
      fragmentShader: BANK_FRAG,
      uniforms: { ...atmo, uTime: atmo.uTime, uReveal: atmo.uReveal },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.name = 'cloudBanks';
  }
}
