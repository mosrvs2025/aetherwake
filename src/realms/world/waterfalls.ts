/**
 * REALMS — waterfalls.
 *
 * Each fall is a curtain (a slightly curved, tapering ribbon) with a shader
 * that scrolls two layers of stretched noise downward at different rates, adds
 * a leading-edge "throw" where the water leaves the lip, and dissolves the
 * bottom into haze. The Great Fall does not land: it fades out into the cloud
 * sea, which is the single clearest statement that this land is floating.
 */

import * as THREE from 'three';
import { ATMO_PARS, atmo } from '../core/atmosphere';
import { Textures } from './textures';
import { terrainHeight } from './heightfield';
import { Random } from '../core/math';

const FALL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying float vEdge;
uniform float uTime;
uniform float uWidthTop;
uniform float uWidthBottom;
uniform float uHeight;
uniform float uSway;
void main() {
  vUv = uv;
  float v = uv.y;                       // 0 at the lip, 1 at the bottom
  float w = mix(uWidthTop, uWidthBottom, pow(v, 0.7));
  float x = (uv.x - 0.5) * w;
  // the sheet is thrown outward as it leaves the lip, then falls vertically
  float throwZ = (1.0 - exp(-v * 5.0)) * 2.4;
  float sway = sin(uTime * 0.7 + v * 3.0) * uSway * v;
  vec3 local = vec3(x + sway, -v * uHeight, throwZ);
  vec4 wp = modelMatrix * vec4(local, 1.0);
  vWorld = wp.xyz;
  vEdge = abs(uv.x - 0.5) * 2.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FALL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorld;
varying float vEdge;
${ATMO_PARS}
uniform sampler2D uDetail;
uniform float uTime;
uniform float uHeight;
uniform vec3 uWaterColor;
uniform vec3 uFoamColor;
uniform float uFadeBottom;

void main() {
  float v = vUv.y;
  // stretched, fast-scrolling noise reads as falling water
  vec2 uvA = vec2(vUv.x * 3.2, v * 1.15 - uTime * 0.62);
  vec2 uvB = vec2(vUv.x * 6.4 + 0.31, v * 2.30 - uTime * 1.05);
  float a = texture2D(uDetail, uvA).r;
  float b = texture2D(uDetail, uvB).g;
  float streak = a * 0.62 + b * 0.55;

  // more aeration the further it falls
  float aer = smoothstep(0.02, 0.55, v);
  vec3 col = mix(uWaterColor, uFoamColor, clamp(streak * 0.8 + aer * 0.75, 0.0, 1.0));
  col += uSunColor * pow(clamp(streak, 0.0, 1.0), 3.0) * 0.35;

  float alpha = 0.90;
  alpha *= 1.0 - smoothstep(0.55, 1.0, vEdge) * 0.85;      // soft sides
  alpha *= mix(1.0, 0.55, aer);
  alpha *= smoothstep(0.0, 0.03, v);                        // hide the lip seam
  alpha *= 1.0 - smoothstep(uFadeBottom, 1.0, v);           // dissolve into mist
  alpha *= 0.55 + streak * 0.7;

  float f = realmsFogAmount(cameraPosition, vWorld);
  col = mix(col, realmsSkyColor(normalize(vWorld - cameraPosition)), f);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export interface FallSpec {
  x: number; y: number; z: number;
  yaw: number;
  height: number;
  widthTop: number;
  widthBottom: number;
  sway?: number;
  fadeBottom?: number;
  /** Emit mist at the base? */
  mist?: boolean;
}

export class Waterfalls {
  group = new THREE.Group();
  material: THREE.ShaderMaterial;
  specs: FallSpec[] = [];

  constructor(specs: FallSpec[]) {
    this.specs = specs;
    this.material = new THREE.ShaderMaterial({
      vertexShader: FALL_VERT,
      fragmentShader: FALL_FRAG,
      uniforms: {
        ...atmo,
        uTime: atmo.uTime,
        uDetail: { value: Textures.detail },
        uWaterColor: { value: new THREE.Color('#7fb4c9') },
        uFoamColor: { value: new THREE.Color('#eaf6fb') },
        uWidthTop: { value: 10 },
        uWidthBottom: { value: 16 },
        uHeight: { value: 60 },
        uSway: { value: 1.2 },
        uFadeBottom: { value: 0.86 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    for (const s of specs) {
      // each fall needs its own uniform values, so clone the material
      const mat = this.material.clone();
      mat.uniforms.uWidthTop.value = s.widthTop;
      mat.uniforms.uWidthBottom.value = s.widthBottom;
      mat.uniforms.uHeight.value = s.height;
      mat.uniforms.uSway.value = s.sway ?? 1.0;
      mat.uniforms.uFadeBottom.value = s.fadeBottom ?? 0.86;
      // share the animated uniforms by reference
      mat.uniforms.uTime = atmo.uTime;
      mat.uniforms.uSunDir = atmo.uSunDir;
      mat.uniforms.uSunColor = atmo.uSunColor;
      mat.uniforms.uSkyZenith = atmo.uSkyZenith;
      mat.uniforms.uSkyHorizon = atmo.uSkyHorizon;
      mat.uniforms.uFogDensity = atmo.uFogDensity;
      mat.uniforms.uFogFalloff = atmo.uFogFalloff;
      mat.uniforms.uFogBase = atmo.uFogBase;
      mat.uniforms.uFogSunPower = atmo.uFogSunPower;
      mat.uniforms.uFogSunStrength = atmo.uFogSunStrength;

      const geo = new THREE.PlaneGeometry(1, 1, 14, 40);
      geo.translate(0.5, -0.5, 0);   // uv-space authoring; the shader rebuilds positions
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.yaw;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      this.group.add(mesh);
    }
    this.group.name = 'waterfalls';
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
  }
}

/** The authored set of falls for the shelf. */
export function defaultFalls(): FallSpec[] {
  const rng = new Random('falls');
  const out: FallSpec[] = [
    // The Great Fall — the river leaves the world on the west rim
    { x: -662, y: terrainHeight(-662, 92) + 1.5, z: 92, yaw: -1.55, height: 340, widthTop: 26, widthBottom: 62, sway: 2.6, fadeBottom: 0.55, mist: true },
    // Cascade into Mirrowmere from the northern gorge
    { x: 198, y: terrainHeight(198, 8) + 1.0, z: 8, yaw: Math.PI, height: 46, widthTop: 11, widthBottom: 17, sway: 0.8, fadeBottom: 0.9, mist: true },
    // Falls off the keep massif, disappearing into cloud
    { x: -186, y: 214, z: -498, yaw: 0.5, height: 400, widthTop: 16, widthBottom: 40, sway: 2.2, fadeBottom: 0.5, mist: false },
    { x: 96, y: 236, z: -540, yaw: -0.35, height: 420, widthTop: 12, widthBottom: 34, sway: 2.0, fadeBottom: 0.5, mist: false },
    // Eastern rim falls, seen from the lake
    { x: 596, y: terrainHeight(596, 262) + 1, z: 262, yaw: 2.3, height: 300, widthTop: 14, widthBottom: 34, sway: 2.0, fadeBottom: 0.55, mist: false },
  ];
  // a few small rim falls for depth
  for (let i = 0; i < 5; i++) {
    const a = rng.range(-2.4, 2.4);
    const r = 720;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = terrainHeight(x, z);
    if (y < 20 || y > 240) continue;
    out.push({
      x, y: y + 1, z, yaw: -a + Math.PI / 2,
      height: 260 + rng.range(-40, 90),
      widthTop: rng.range(5, 11), widthBottom: rng.range(14, 26),
      sway: 1.8, fadeBottom: 0.5,
    });
  }
  return out;
}
