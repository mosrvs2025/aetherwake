/**
 * REALMS — shared atmosphere.
 *
 * Every lit material in the world runs the same aerial-perspective model:
 * exponential height fog, analytically integrated along the view ray, tinted
 * toward the sun so that distant ridges glow where they face the light. One
 * uniform block is shared by reference across all materials, so a single write
 * per frame updates the whole world (sun movement, weather, the intro fade).
 */

import * as THREE from 'three';

export const atmo = {
  uSunDir: { value: new THREE.Vector3(0.32, 0.36, -0.88).normalize() },
  uSunColor: { value: new THREE.Color(1.0, 0.845, 0.63) },
  uSkyZenith: { value: new THREE.Color(0.115, 0.285, 0.66) },
  uSkyHorizon: { value: new THREE.Color(0.60, 0.705, 0.83) },
  uFogDensity: { value: 0.00040 },
  uFogFalloff: { value: 0.0042 },
  uFogBase: { value: -20.0 },
  uFogSunPower: { value: 7.0 },
  uFogSunStrength: { value: 0.42 },
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.82, 0.57) },
  uWindStrength: { value: 1.0 },
  /** 0 during the black-screen open, 1 when the world is fully revealed. */
  uReveal: { value: 1.0 },
};

export const ATMO_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uFogSunPower;
uniform float uFogSunStrength;
varying vec3 vWorldPos_atmo;

vec3 realmsSkyColor(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  float t = pow(clamp(dir.y, 0.0, 1.0), 0.42);
  vec3 base = mix(uSkyHorizon, uSkyZenith, t);
  // below the horizon we look into the cloud sea, which is bright
  base = mix(base * vec3(0.96, 0.97, 1.02), base, smoothstep(-0.14, 0.06, dir.y));
  float sun = max(dot(dir, uSunDir), 0.0);
  base += uSunColor * pow(sun, uFogSunPower) * uFogSunStrength;
  base += uSunColor * pow(sun, 2.0) * 0.10 * (1.0 - up * 0.5);
  return base;
}

float realmsFogAmount(vec3 camPos, vec3 worldPos) {
  vec3 d = worldPos - camPos;
  float dist = length(d);
  float cy = camPos.y - uFogBase;
  float dy = d.y;
  float k = uFogFalloff;
  float f;
  if (abs(dy) < 0.0015) {
    f = uFogDensity * dist * exp(-k * cy);
  } else {
    f = uFogDensity * dist * (exp(-k * cy) - exp(-k * (cy + dy))) / (k * dy);
  }
  return 1.0 - exp(-max(f, 0.0));
}

vec3 realmsApplyFog(vec3 color, vec3 camPos, vec3 worldPos) {
  vec3 dir = normalize(worldPos - camPos);
  float f = realmsFogAmount(camPos, worldPos);
  vec3 sky = realmsSkyColor(dir);
  return mix(color, sky, clamp(f, 0.0, 1.0));
}
`;

const VERT_HOOK = /* glsl */ `
#include <worldpos_vertex>
vWorldPos_atmo = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_HOOK = /* glsl */ `
gl_FragColor.rgb = realmsApplyFog(gl_FragColor.rgb, cameraPosition, vWorldPos_atmo);
`;

const patched = new WeakSet<THREE.Material>();

/**
 * Patch a standard-library material so it participates in the world atmosphere.
 * `extra` lets callers inject their own vertex/fragment code in the same pass
 * (used by terrain splatting, foliage wind and water).
 */
export function applyAtmosphere(
  material: THREE.Material,
  extra?: {
    vertexPars?: string;
    vertexBody?: string;
    fragmentPars?: string;
    fragmentBody?: string;
    uniforms?: Record<string, THREE.IUniform>;
    defines?: Record<string, string | number>;
    /** Arbitrary chunk replacements applied after the atmosphere hooks. */
    vertexReplace?: Array<[string, string]>;
    fragmentReplace?: Array<[string, string]>;
    /** Stable cache key so variants do not share compiled programs. */
    key?: string;
  },
) {
  if (patched.has(material)) return material;
  patched.add(material);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, atmo);
    if (extra?.uniforms) Object.assign(shader.uniforms, extra.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos_atmo;\n${extra?.vertexPars ?? ''}`)
      .replace('#include <worldpos_vertex>', `${VERT_HOOK}\n${extra?.vertexBody ?? ''}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ATMO_PARS}\n${extra?.fragmentPars ?? ''}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${extra?.fragmentBody ?? ''}\n${FRAG_HOOK}`);

    for (const [find, rep] of extra?.vertexReplace ?? []) shader.vertexShader = shader.vertexShader.replace(find, rep);
    for (const [find, rep] of extra?.fragmentReplace ?? []) shader.fragmentShader = shader.fragmentShader.replace(find, rep);
  };
  const key = extra?.key ?? 'default';
  material.customProgramCacheKey = () => 'realms-atmo-' + key;
  material.needsUpdate = true;
  return material;
}

/** Colour presets the day cycle interpolates between. */
export interface SkyPreset {
  sunElevation: number;      // radians above horizon
  sunAzimuth: number;        // radians, 0 = +X
  sunColor: THREE.Color;
  sunIntensity: number;
  ambientSky: THREE.Color;
  ambientGround: THREE.Color;
  ambientIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  fogDensity: number;
  exposure: number;
}

export function makePreset(p: Partial<SkyPreset> & { sunElevation: number; sunAzimuth: number }): SkyPreset {
  return {
    sunColor: new THREE.Color('#ffd9a8'),
    sunIntensity: 3.0,
    ambientSky: new THREE.Color('#9fc4ee'),
    ambientGround: new THREE.Color('#4a4034'),
    ambientIntensity: 0.9,
    zenith: new THREE.Color('#2c5aa8'),
    horizon: new THREE.Color('#cfd8e2'),
    fogDensity: 0.0020,
    exposure: 1.0,
    ...p,
  };
}
