/**
 * REALMS — HDR post-processing chain.
 *
 * The scene is rendered linear into a half-float buffer and stays HDR all the
 * way to the final pass, so bloom and light shafts bloom off values above 1.0
 * (the sun disc is drawn at ~22.0) rather than off clipped white. Order:
 *
 *   scene -> light shafts (radial occlusion blur toward the sun)
 *         -> bloom
 *         -> grade: ACES filmic, lift/gamma/gain, chromatic aberration,
 *            grain, vignette, cinematic letterbox and fade
 *
 * Every stage can be scaled down or switched off by the quality setting.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

const GODRAY_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0.42 },
    uDecay: { value: 0.96 },
    uDensity: { value: 0.58 },
    uWeight: { value: 0.42 },
    uThreshold: { value: 1.35 },
    uSamples: { value: 40 },
    uVisible: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uSunScreen;
    uniform float uIntensity, uDecay, uDensity, uWeight, uThreshold, uVisible;
    uniform int uSamples;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uVisible < 0.01 || uIntensity < 0.001) { gl_FragColor = base; return; }

      vec2 delta = (vUv - uSunScreen) * (uDensity / float(uSamples));
      vec2 uv = vUv;
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 64; i++) {
        if (i >= uSamples) break;
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
        vec3 bright = s * smoothstep(uThreshold, uThreshold * 2.2, lum);
        acc += bright * illum * uWeight;
        illum *= uDecay;
      }
      // fade the shafts out as the sun leaves the frame
      float edge = 1.0 - smoothstep(0.42, 1.05, length(uSunScreen - vec2(0.5)) * 1.35);
      gl_FragColor = vec4(base.rgb + acc * uIntensity * edge * uVisible, base.a);
    }
  `,
};

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1.16 },
    uContrast: { value: 1.085 },
    uSaturation: { value: 1.14 },
    uLift: { value: new THREE.Vector3(0.006, 0.010, 0.020) },
    uGain: { value: new THREE.Vector3(1.02, 1.0, 0.985) },
    uVignette: { value: 0.36 },
    uAberration: { value: 0.0016 },
    uGrain: { value: 0.016 },
    uTime: { value: 0 },
    uFade: { value: 0.0 },          // 1 = fully black
    uLetterbox: { value: 0.0 },     // 0..1 bar height fraction
    uDamage: { value: 0.0 },        // red pulse when hurt
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uExposure, uContrast, uSaturation, uVignette, uAberration, uGrain, uTime, uFade, uLetterbox, uDamage;
    uniform vec3 uLift, uGain;
    uniform vec2 uResolution;
    varying vec2 vUv;

    // Narkowicz / Hill ACES fit
    vec3 aces(vec3 x) {
      const mat3 m1 = mat3(0.59719, 0.07600, 0.02840,
                           0.35458, 0.90834, 0.13383,
                           0.04823, 0.01566, 0.83777);
      const mat3 m2 = mat3( 1.60475, -0.10208, -0.00327,
                           -0.53108,  1.10813, -0.07276,
                           -0.07367, -0.00605,  1.07602);
      vec3 v = m1 * x;
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return clamp(m2 * (a / b), 0.0, 1.0);
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // chromatic aberration grows toward the edges
      float ab = uAberration * (0.25 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      col *= uExposure;
      col = aces(col);

      // lift / gain then contrast around 0.5
      col = col * uGain + uLift;
      col = (col - 0.5) * uContrast + 0.5;

      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation);

      // damage tint
      col = mix(col, vec3(min(1.0, lum * 0.5 + 0.55), lum * 0.10, lum * 0.10), uDamage * (0.35 + r2 * 1.6));

      // vignette
      float vig = 1.0 - uVignette * smoothstep(0.18, 0.92, r2 * 2.1);
      col *= vig;

      // grain
      float g = hash(gl_FragCoord.xy + fract(uTime) * 431.0) - 0.5;
      col += g * uGrain * (1.0 - lum * 0.6);

      col = max(col, 0.0);
      // sRGB encode (we render linear all the way to here)
      col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));

      col *= (1.0 - uFade);

      // cinematic bars
      float bar = step(uv.y, uLetterbox) + step(1.0 - uLetterbox, uv.y);
      col *= (1.0 - clamp(bar, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  renderPass: RenderPass;
  godrays: ShaderPass;
  bloom: UnrealBloomPass;
  fxaa: ShaderPass;
  grade: ShaderPass;
  private renderer: THREE.WebGLRenderer;
  private size = new THREE.Vector2(1, 1);
  private pixelRatio = 1;
  quality: Quality = 'high';

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: 0,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.godrays = new ShaderPass(GODRAY_SHADER);
    this.composer.addPass(this.godrays);

    this.bloom = new UnrealBloomPass(size, 0.34, 0.34, 1.15);
    this.composer.addPass(this.bloom);

    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);

    this.grade = new ShaderPass(GRADE_SHADER);
    this.grade.renderToScreen = true;
    this.composer.addPass(this.grade);
  }

  setQuality(q: Quality) {
    this.quality = q;
    const gr = this.godrays.uniforms;
    switch (q) {
      case 'low':
        this.godrays.enabled = false;
        this.bloom.enabled = true;
        this.bloom.strength = 0.28;
        this.fxaa.enabled = false;
        this.grade.uniforms.uGrain.value = 0.010;
        break;
      case 'medium':
        this.godrays.enabled = true;
        gr.uSamples.value = 22;
        gr.uIntensity.value = 0.34;
        this.bloom.enabled = true;
        this.bloom.strength = 0.30;
        this.fxaa.enabled = true;
        break;
      case 'high':
        this.godrays.enabled = true;
        gr.uSamples.value = 40;
        gr.uIntensity.value = 0.42;
        this.bloom.enabled = true;
        this.bloom.strength = 0.34;
        this.fxaa.enabled = true;
        break;
      case 'ultra':
        this.godrays.enabled = true;
        gr.uSamples.value = 60;
        gr.uIntensity.value = 0.48;
        this.bloom.enabled = true;
        this.bloom.strength = 0.38;
        this.fxaa.enabled = true;
        break;
    }
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.size.set(width, height);
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.setSize(width * pixelRatio, height * pixelRatio);
    const res = this.fxaa.material.uniforms.resolution;
    if (res) res.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
    this.grade.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
  }

  /** Project the sun into screen space for the light-shaft pass. */
  updateSun(camera: THREE.Camera, sunDir: THREE.Vector3) {
    const p = new THREE.Vector3().copy(sunDir).multiplyScalar(9000).add(camera.position);
    p.project(camera);
    const visible = p.z < 1 ? 1 : 0;
    this.godrays.uniforms.uSunScreen.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.godrays.uniforms.uVisible.value = visible;
  }

  render(dt: number) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
