/**
 * REALMS — shared atmosphere.
 *
 * Every lit material in the world runs the same model, from the terrain to the
 * warrior's pauldrons, because one uniform block is shared by reference across
 * all of them. A single write per frame moves the whole world's air.
 *
 * Three things live here:
 *
 *   Aerial perspective — distance eats saturation and pushes colour toward the
 *   sky's blue *before* fog takes over, and sunlight scattered forward warms
 *   whatever lies in the sun's direction. Without this, distant ridges are just
 *   near ridges drawn smaller, which is the single biggest tell that a
 *   landscape is synthetic.
 *
 *   Height fog — exponential, analytically integrated along the view ray, so
 *   valleys fill and peaks stay clear.
 *
 *   Cloud shadows — a domain-warped mask drifting with the wind, applied to
 *   every lit surface. Vast slow shadows crossing a landscape do more for a
 *   sense of scale and weather than any amount of post-processing, and they
 *   cost two texture taps.
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
  uWindDir: { value: new THREE.Vector2(0.82, 0.57).normalize() },
  uWindStrength: { value: 1.0 },
  /** Distance over which aerial perspective reaches full strength, in metres. */
  uAerialRange: { value: 1050.0 },
  uAerialDesat: { value: 0.56 },
  uAerialTint: { value: 0.40 },
  /** x = uv scale, y = drift speed, z = strength, w = coverage threshold. */
  uCloudShadow: { value: new THREE.Vector4(0.00085, 0.0022, 0.46, 0.44) },
  uCloudTex: { value: null as THREE.Texture | null },
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
uniform float uAerialRange;
uniform float uAerialDesat;
uniform float uAerialTint;
uniform vec4 uCloudShadow;
uniform sampler2D uCloudTex;
uniform vec2 uWindDir;
uniform float uTime;
varying vec3 vWorldPos_atmo;

/**
 * Coverage of the drifting cloud deck over a world point. 1 = full sun.
 * Two taps at different scales, both drifting downwind, so the shapes are
 * cloud-sized rather than tiling-sized.
 */
float realmsCloudShadow(vec3 wp) {
  if (uCloudShadow.z <= 0.001) return 1.0;
  vec2 drift = uWindDir * (uTime * uCloudShadow.y);
  vec2 uv = wp.xz * uCloudShadow.x + drift;
  float a = texture2D(uCloudTex, uv).a;
  float b = texture2D(uCloudTex, uv * 2.31 + vec2(0.37, 0.11) + drift * 0.55).r;
  float d = a * 0.62 + b * 0.46;
  float cover = smoothstep(uCloudShadow.w, uCloudShadow.w + 0.26, d);
  return 1.0 - cover * uCloudShadow.z;
}

/** Apply that coverage: shadowed ground loses the sun's warmth, keeps sky blue. */
vec3 realmsCloudLight(vec3 color, vec3 wp) {
  float s = realmsCloudShadow(wp);
  return color * s * mix(vec3(0.86, 0.92, 1.08), vec3(1.0), s);
}

/** A gust front travelling downwind — vegetation and cloud shadows share it. */
float realmsGust(vec2 xz) {
  float phase = dot(xz, uWindDir) * 0.0075 - uTime * 0.62;
  return 0.55 + 0.45 * sin(phase) * (0.6 + 0.4 * sin(phase * 0.37 + 1.7));
}

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
  vec3 d = worldPos - camPos;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);

  // Aerial perspective runs ahead of the fog: air between here and there
  // scatters away saturation and shifts what is left toward the sky.
  float ap = clamp(dist / uAerialRange, 0.0, 1.0);
  ap *= ap;
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(color, vec3(lum), ap * uAerialDesat);
  color = mix(color, uSkyHorizon * (0.46 + lum * 0.72), ap * uAerialTint);

  float f = realmsFogAmount(camPos, worldPos);
  vec3 sky = realmsSkyColor(dir);
  // forward scattering: haze in front of the sun glows
  sky += uSunColor * pow(max(dot(dir, uSunDir), 0.0), 5.0) * 0.22;
  return mix(color, sky, clamp(f, 0.0, 1.0));
}
`;

const VERT_HOOK = /* glsl */ `
#include <worldpos_vertex>
// Mirror what <worldpos_vertex> does internally: instanced and batched meshes
// carry their placement in a per-draw matrix, not in modelMatrix. Skipping it
// leaves every blade of grass reporting a position near the origin, and the fog
// integrator then dutifully paints it sky-blue.
vec4 wpAtmo = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  wpAtmo = batchingMatrix * wpAtmo;
#endif
#ifdef USE_INSTANCING
  wpAtmo = instanceMatrix * wpAtmo;
#endif
vWorldPos_atmo = (modelMatrix * wpAtmo).xyz;
`;

const FRAG_HOOK = /* glsl */ `
gl_FragColor.rgb = realmsCloudLight(gl_FragColor.rgb, vWorldPos_atmo);
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
