/**
 * REALMS — particles and weapon trails.
 *
 * One pooled particle system per blend mode (additive for anything that emits
 * light, alpha for anything that occludes it), each a single instanced draw
 * with billboard construction in the vertex shader. Simulation is on the CPU
 * because the counts are small (a few thousand) and gameplay needs to spawn
 * bursts at exact animation frames.
 */

import * as THREE from 'three';
import { ATMO_PARS, atmo } from '../core/atmosphere';
import { Textures } from '../world/textures';

const PART_VERT = /* glsl */ `
attribute vec4 iPos;     // xyz = world position, w = size
attribute vec4 iColor;   // rgb + alpha
attribute float iRot;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vColor = iColor;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iRot), s = sin(iRot);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iPos.w;
  vec3 world = iPos.xyz + camRight * p.x + camUp * p.y;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const PART_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vWorld;
${ATMO_PARS}
uniform sampler2D uMap;
uniform float uFogged;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 col = vColor.rgb * t.rgb;
  if (uFogged > 0.5) {
    float f = realmsFogAmount(cameraPosition, vWorld);
    col = mix(col, realmsSkyColor(normalize(vWorld - cameraPosition)), f * 0.9);
  }
  gl_FragColor = vec4(col, a);
}
`;

export interface SpawnOpts {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  size: number;
  sizeEnd?: number;
  color: THREE.Color;
  colorEnd?: THREE.Color;
  alpha?: number;
  life: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  /** Fade in over this fraction of life. */
  fadeIn?: number;
}

export class ParticleSystem {
  mesh: THREE.Mesh;
  private capacity: number;
  private posArr: Float32Array;
  private colArr: Float32Array;
  private rotArr: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private phys: Float32Array;   // gravity, drag, spin, fadeIn
  private alpha0: Float32Array;
  private cursor = 0;
  live = 0;

  constructor(capacity: number, map: THREE.Texture, additive: boolean, fogged = true) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = capacity;

    this.posArr = new Float32Array(capacity * 4);
    this.colArr = new Float32Array(capacity * 4);
    this.rotArr = new Float32Array(capacity);
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.posArr, 4));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.colArr, 4));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(this.rotArr, 1));

    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.col0 = new Float32Array(capacity * 3);
    this.col1 = new Float32Array(capacity * 3);
    this.phys = new Float32Array(capacity * 4);
    this.alpha0 = new Float32Array(capacity);

    const mat = new THREE.ShaderMaterial({
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      uniforms: { ...atmo, uMap: { value: map }, uFogged: { value: fogged ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 30 : 20;
  }

  spawn(o: SpawnOpts) {
    let i = -1;
    for (let k = 0; k < this.capacity; k++) {
      const c = (this.cursor + k) % this.capacity;
      if (this.life[c] <= 0) { i = c; this.cursor = (c + 1) % this.capacity; break; }
    }
    if (i < 0) return;
    this.posArr[i * 4] = o.x; this.posArr[i * 4 + 1] = o.y; this.posArr[i * 4 + 2] = o.z;
    this.posArr[i * 4 + 3] = o.size;
    this.vel[i * 3] = o.vx ?? 0; this.vel[i * 3 + 1] = o.vy ?? 0; this.vel[i * 3 + 2] = o.vz ?? 0;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size0[i] = o.size;
    this.size1[i] = o.sizeEnd ?? o.size;
    this.col0[i * 3] = o.color.r; this.col0[i * 3 + 1] = o.color.g; this.col0[i * 3 + 2] = o.color.b;
    const ce = o.colorEnd ?? o.color;
    this.col1[i * 3] = ce.r; this.col1[i * 3 + 1] = ce.g; this.col1[i * 3 + 2] = ce.b;
    this.phys[i * 4] = o.gravity ?? 0;
    this.phys[i * 4 + 1] = o.drag ?? 0.6;
    this.phys[i * 4 + 2] = o.spin ?? 0;
    this.phys[i * 4 + 3] = o.fadeIn ?? 0.08;
    this.alpha0[i] = o.alpha ?? 1;
    this.rotArr[i] = Math.random() * Math.PI * 2;
    this.colArr[i * 4 + 3] = 0;
  }

  update(dt: number) {
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      const l = this.life[i];
      if (l <= 0) { this.colArr[i * 4 + 3] = 0; continue; }
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) { this.colArr[i * 4 + 3] = 0; this.posArr[i * 4 + 3] = 0; continue; }
      live++;
      const t = 1 - nl / this.maxLife[i];
      const g = this.phys[i * 4], drag = this.phys[i * 4 + 1], spin = this.phys[i * 4 + 2], fin = this.phys[i * 4 + 3];
      const d = Math.exp(-drag * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - g * dt;
      this.vel[i * 3 + 2] *= d;
      this.posArr[i * 4] += this.vel[i * 3] * dt;
      this.posArr[i * 4 + 1] += this.vel[i * 3 + 1] * dt;
      this.posArr[i * 4 + 2] += this.vel[i * 3 + 2] * dt;
      this.posArr[i * 4 + 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.rotArr[i] += spin * dt;
      const fade = (fin > 0 ? Math.min(1, t / fin) : 1) * (1 - t) * (1 - t * 0.2);
      this.colArr[i * 4] = this.col0[i * 3] + (this.col1[i * 3] - this.col0[i * 3]) * t;
      this.colArr[i * 4 + 1] = this.col0[i * 3 + 1] + (this.col1[i * 3 + 1] - this.col0[i * 3 + 1]) * t;
      this.colArr[i * 4 + 2] = this.col0[i * 3 + 2] + (this.col1[i * 3 + 2] - this.col0[i * 3 + 2]) * t;
      this.colArr[i * 4 + 3] = fade * this.alpha0[i];
    }
    this.live = live;
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    (g.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (g.getAttribute('iColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (g.getAttribute('iRot') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Weapon trail
 * ------------------------------------------------------------------ */

const TRAIL_VERT = /* glsl */ `
attribute float aAge;
varying float vAge;
varying vec2 vUv;
void main() {
  vAge = aAge;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const TRAIL_FRAG = /* glsl */ `
precision highp float;
varying float vAge;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uStrength;
void main() {
  float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float a = pow(1.0 - vAge, 1.8) * edge * uStrength;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor * (0.6 + edge * 1.6), a);
}
`;

export class WeaponTrail {
  mesh: THREE.Mesh;
  private segments: number;
  private base: Float32Array;
  private tip: Float32Array;
  private count = 0;
  private pos: THREE.BufferAttribute;
  private age: THREE.BufferAttribute;
  private material: THREE.ShaderMaterial;
  active = false;

  constructor(segments = 20, color = new THREE.Color('#7ec8ff')) {
    this.segments = segments;
    this.base = new Float32Array(segments * 3);
    this.tip = new Float32Array(segments * 3);
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array(segments * 2 * 3);
    const ages = new Float32Array(segments * 2);
    const uvs = new Float32Array(segments * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < segments - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    for (let i = 0; i < segments; i++) {
      uvs[i * 4] = i / (segments - 1); uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = i / (segments - 1); uvs[i * 4 + 3] = 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.pos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.age = geo.getAttribute('aAge') as THREE.BufferAttribute;
    this.material = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: { uColor: { value: color }, uStrength: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 32;
    this.mesh.visible = false;
  }

  begin() { this.count = 0; this.active = true; this.mesh.visible = true; this.material.uniforms.uStrength.value = 1; }
  end() { this.active = false; }

  push(base: THREE.Vector3, tip: THREE.Vector3) {
    if (!this.active) return;
    // shift the ring
    for (let i = Math.min(this.count, this.segments - 1); i > 0; i--) {
      for (let k = 0; k < 3; k++) {
        this.base[i * 3 + k] = this.base[(i - 1) * 3 + k];
        this.tip[i * 3 + k] = this.tip[(i - 1) * 3 + k];
      }
    }
    this.base[0] = base.x; this.base[1] = base.y; this.base[2] = base.z;
    this.tip[0] = tip.x; this.tip[1] = tip.y; this.tip[2] = tip.z;
    this.count = Math.min(this.count + 1, this.segments);
    for (let i = 0; i < this.segments; i++) {
      const src = Math.min(i, this.count - 1);
      this.pos.setXYZ(i * 2, this.base[src * 3], this.base[src * 3 + 1], this.base[src * 3 + 2]);
      this.pos.setXYZ(i * 2 + 1, this.tip[src * 3], this.tip[src * 3 + 1], this.tip[src * 3 + 2]);
      const a = i / (this.segments - 1);
      this.age.setX(i * 2, a);
      this.age.setX(i * 2 + 1, a);
    }
    this.pos.needsUpdate = true;
    this.age.needsUpdate = true;
  }

  update(dt: number) {
    if (!this.active) {
      const u = this.material.uniforms.uStrength;
      u.value = Math.max(0, u.value - dt * 4.5);
      if (u.value <= 0) this.mesh.visible = false;
    }
  }

  setColor(c: THREE.Color) { this.material.uniforms.uColor.value.copy(c); }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ------------------------------------------------------------------ *
 * The effects director
 * ------------------------------------------------------------------ */

const C_AETHER = new THREE.Color('#66baff');
const C_AETHER_HOT = new THREE.Color('#d8f0ff');
const C_EMBER = new THREE.Color('#ff9540');
const C_EMBER_DIM = new THREE.Color('#8a2c10');
const C_DUST = new THREE.Color('#c8bda6');
const C_MIST = new THREE.Color('#dfeaf2');
const C_WRAITH = new THREE.Color('#c07dff');
const C_BLOOD = new THREE.Color('#6d1420');

export class Fx {
  group = new THREE.Group();
  additive: ParticleSystem;
  soft: ParticleSystem;
  trail: WeaponTrail;

  constructor() {
    this.additive = new ParticleSystem(2600, Textures.glow, true, true);
    this.soft = new ParticleSystem(2200, Textures.smoke, false, true);
    this.trail = new WeaponTrail(22, C_AETHER);
    this.group.add(this.additive.mesh, this.soft.mesh, this.trail.mesh);
    this.group.name = 'fx';
  }

  update(dt: number) {
    this.additive.update(dt);
    this.soft.update(dt);
    this.trail.update(dt);
  }

  /* ---------- combat ---------- */

  hitSpark(x: number, y: number, z: number, dirX: number, dirZ: number, power = 1, color = C_AETHER) {
    const n = Math.round(10 + power * 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const sp = 4 + Math.random() * 12 * power;
      this.additive.spawn({
        x, y, z,
        vx: dirX * sp * 0.6 + Math.cos(a) * Math.cos(e) * sp * 0.7,
        vy: Math.sin(e) * sp * 0.7 + 2.5,
        vz: dirZ * sp * 0.6 + Math.sin(a) * Math.cos(e) * sp * 0.7,
        size: 0.10 + Math.random() * 0.18 * power,
        sizeEnd: 0.01,
        color: Math.random() < 0.4 ? C_AETHER_HOT : color,
        life: 0.22 + Math.random() * 0.38,
        gravity: 14, drag: 2.4, spin: 4,
      });
    }
    for (let i = 0; i < 5; i++) {
      this.soft.spawn({
        x, y, z,
        vx: (Math.random() - 0.5) * 2.5, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 2.5,
        size: 0.4, sizeEnd: 1.6 * power, color: C_DUST, alpha: 0.28,
        life: 0.5 + Math.random() * 0.4, gravity: -1.2, drag: 1.8, spin: 1.2,
      });
    }
  }

  bloodBurst(x: number, y: number, z: number, dirX: number, dirZ: number, color = C_BLOOD) {
    for (let i = 0; i < 14; i++) {
      this.soft.spawn({
        x, y, z,
        vx: dirX * 5 + (Math.random() - 0.5) * 5,
        vy: 2 + Math.random() * 4,
        vz: dirZ * 5 + (Math.random() - 0.5) * 5,
        size: 0.12 + Math.random() * 0.2, sizeEnd: 0.03,
        color, alpha: 0.85, life: 0.35 + Math.random() * 0.3,
        gravity: 18, drag: 1.0,
      });
    }
  }

  dissolve(x: number, y: number, z: number, radius = 0.7, color = C_WRAITH) {
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this.additive.spawn({
        x: x + Math.cos(a) * r, y: y + Math.random() * 1.9, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.7, vy: 1.4 + Math.random() * 2.6, vz: Math.sin(a) * 0.7,
        size: 0.12 + Math.random() * 0.22, sizeEnd: 0.01,
        color, colorEnd: C_AETHER,
        life: 0.7 + Math.random() * 0.9, gravity: -0.9, drag: 0.9, spin: 2,
      });
    }
  }

  shockwave(x: number, y: number, z: number, radius: number, color = C_AETHER) {
    const n = 70;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.08;
      this.additive.spawn({
        x, y: y + 0.15, z,
        vx: Math.cos(a) * radius * 2.1, vy: 1.6 + Math.random() * 2.2, vz: Math.sin(a) * radius * 2.1,
        size: 0.42, sizeEnd: 0.05,
        color: C_AETHER_HOT, colorEnd: color,
        life: 0.44, gravity: 2, drag: 3.4,
      });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      this.soft.spawn({
        x, y: y + 0.1, z,
        vx: Math.cos(a) * radius * 1.5, vy: 0.9 + Math.random() * 1.6, vz: Math.sin(a) * radius * 1.5,
        size: 0.7, sizeEnd: 3.4, color: C_DUST, alpha: 0.34,
        life: 0.7, gravity: -0.5, drag: 2.6, spin: 1.4,
      });
    }
  }

  castCharge(x: number, y: number, z: number, color = C_AETHER) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.1 + Math.random() * 0.7;
      this.additive.spawn({
        x: x + Math.cos(a) * r, y: y + (Math.random() - 0.5) * 1.2, z: z + Math.sin(a) * r,
        vx: -Math.cos(a) * r * 2.4, vy: 0.5, vz: -Math.sin(a) * r * 2.4,
        size: 0.09 + Math.random() * 0.1, sizeEnd: 0.24,
        color: C_AETHER_HOT, colorEnd: color,
        life: 0.42, drag: 0.3,
      });
    }
  }

  riftTrail(x: number, y: number, z: number) {
    for (let i = 0; i < 5; i++) {
      this.additive.spawn({
        x: x + (Math.random() - 0.5) * 0.7, y: y + Math.random() * 1.7, z: z + (Math.random() - 0.5) * 0.7,
        vx: (Math.random() - 0.5) * 1.2, vy: 0.7 + Math.random(), vz: (Math.random() - 0.5) * 1.2,
        size: 0.22, sizeEnd: 0.02, color: C_AETHER_HOT, colorEnd: C_AETHER,
        life: 0.45, drag: 1.5,
      });
    }
  }

  heal(x: number, y: number, z: number) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.5;
      this.additive.spawn({
        x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r,
        vx: 0, vy: 2.4 + Math.random() * 1.6, vz: 0,
        size: 0.14, sizeEnd: 0.02,
        color: new THREE.Color('#9dffc4'), colorEnd: C_AETHER,
        life: 0.9, drag: 0.6,
      });
    }
  }

  /* ---------- ambience ---------- */

  footDust(x: number, y: number, z: number, speed: number, wet = false) {
    const n = speed > 6 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      this.soft.spawn({
        x: x + (Math.random() - 0.5) * 0.3, y: y + 0.06, z: z + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 1.2, vy: 0.5 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 1.2,
        size: 0.16, sizeEnd: 0.75 + speed * 0.06,
        color: wet ? C_MIST : C_DUST, alpha: wet ? 0.30 : 0.20,
        life: 0.5 + Math.random() * 0.35, gravity: -0.6, drag: 2.2, spin: 0.9,
      });
    }
  }

  landPuff(x: number, y: number, z: number, power: number) {
    for (let i = 0; i < 8 + power * 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.soft.spawn({
        x, y: y + 0.08, z,
        vx: Math.cos(a) * (1.6 + power * 5), vy: 0.6 + Math.random() * 1.4, vz: Math.sin(a) * (1.6 + power * 5),
        size: 0.25, sizeEnd: 1.5 + power * 2.2, color: C_DUST, alpha: 0.32,
        life: 0.6 + Math.random() * 0.4, gravity: -0.4, drag: 2.6, spin: 1.1,
      });
    }
  }

  ember(x: number, y: number, z: number) {
    this.additive.spawn({
      x: x + (Math.random() - 0.5) * 0.7, y, z: z + (Math.random() - 0.5) * 0.7,
      vx: (Math.random() - 0.5) * 0.7, vy: 1.4 + Math.random() * 1.9, vz: (Math.random() - 0.5) * 0.7,
      size: 0.055 + Math.random() * 0.06, sizeEnd: 0.008,
      color: C_EMBER, colorEnd: C_EMBER_DIM,
      life: 1.5 + Math.random() * 1.8, gravity: -0.55, drag: 0.55, spin: 1.2,
    });
  }

  smoke(x: number, y: number, z: number, scale = 1) {
    this.soft.spawn({
      x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
      vx: (Math.random() - 0.2) * 0.5, vy: 1.0 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.5,
      size: 0.6 * scale, sizeEnd: 3.4 * scale,
      color: new THREE.Color('#8f9299'), alpha: 0.24,
      life: 2.6 + Math.random() * 2.0, gravity: -0.4, drag: 0.35, spin: 0.35,
    });
  }

  mist(x: number, y: number, z: number, spread: number, rise: number, scale = 1) {
    this.soft.spawn({
      x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.3, z: z + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 1.6, vy: rise * (0.5 + Math.random()), vz: (Math.random() - 0.5) * 1.6,
      size: 1.6 * scale, sizeEnd: 7 * scale,
      color: C_MIST, alpha: 0.24,
      life: 2.4 + Math.random() * 2.4, gravity: -0.25, drag: 0.5, spin: 0.25,
    });
  }

  drift(x: number, y: number, z: number, color = C_AETHER) {
    this.additive.spawn({
      x, y, z,
      vx: (Math.random() - 0.5) * 0.7, vy: 0.25 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.7,
      size: 0.05 + Math.random() * 0.07, sizeEnd: 0.005,
      color, life: 2.5 + Math.random() * 3, gravity: -0.1, drag: 0.25,
    });
  }

  leaf(x: number, y: number, z: number) {
    this.soft.spawn({
      x, y, z,
      vx: 1.2 + Math.random() * 1.6, vy: -0.5 - Math.random() * 0.5, vz: 0.8 + Math.random(),
      size: 0.10 + Math.random() * 0.08, sizeEnd: 0.10,
      color: new THREE.Color('#b39a4a'), alpha: 0.7,
      life: 4 + Math.random() * 3, gravity: 0.55, drag: 0.35, spin: 2.2,
    });
  }

  dispose() {
    this.additive.dispose();
    this.soft.dispose();
    this.trail.dispose();
  }
}

export { C_AETHER, C_AETHER_HOT, C_EMBER, C_WRAITH };
