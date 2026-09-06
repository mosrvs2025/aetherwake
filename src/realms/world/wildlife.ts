/**
 * REALMS — ambient life.
 *
 * A landscape with nothing moving in it reads as a diorama no matter how well
 * it is lit. Three systems put motion into the air and the middle distance,
 * all of them cheap enough to be free:
 *
 *   Birds — every flock is one instanced draw and the whole simulation lives in
 *     the vertex shader. Each bird knows its thermal, its orbit and its phase,
 *     so the CPU writes a single time uniform per frame and thirty birds wheel
 *     over the valley. They bank into their turns, which is most of what makes
 *     a distant speck read as a living thing rather than a sprite.
 *
 *   Motes — dust and pollen in a box that follows the camera and wraps around
 *     it, so they are always present and never need respawning. They are only
 *     visible when you look toward the sun, which is how real backlit dust
 *     behaves, and it keeps them from becoming glitter over the whole frame.
 *
 *   Critters — a handful of small animals that graze near the player and bolt
 *     when approached. Discovering that the world reacts to you at all, in a
 *     way no quest marker announced, is worth more than another particle.
 */

import * as THREE from 'three';
import { ATMO_PARS, atmo } from '../core/atmosphere';
import { Random, clamp01, lerp, smoothstep } from '../core/math';
import { terrainHeight, terrainSlope } from './heightfield';

/* ------------------------------------------------------------------ *
 * Birds
 * ------------------------------------------------------------------ */

/**
 * A bird is two wing quads meeting at a body. `position.x` is the spanwise
 * coordinate, so the shader can flap by lifting each vertex in proportion to
 * how far out the wing it sits.
 */
function birdGeometry() {
  const g = new THREE.BufferGeometry();
  // body triangle plus a quad per wing, all in the XZ plane facing +Z (nose)
  const v = [
    // body
    0, 0, 0.28, -0.05, 0, -0.22, 0.05, 0, -0.22,
    // left wing
    -0.04, 0, 0.10, -0.50, 0, -0.06, -0.04, 0, -0.16,
    -0.50, 0, -0.06, -0.44, 0, -0.20, -0.04, 0, -0.16,
    // right wing
    0.04, 0, 0.10, 0.04, 0, -0.16, 0.50, 0, -0.06,
    0.50, 0, -0.06, 0.04, 0, -0.16, 0.44, 0, -0.20,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const BIRD_VERT = /* glsl */ `
attribute vec4 iOrbit;   // xyz = thermal centre, w = radius
attribute vec4 iFlight;  // x = angular speed, y = phase, z = flap rate, w = scale
attribute vec2 iBob;     // x = vertical amplitude, y = vertical rate
varying vec3 vWorld;
varying float vShade;
uniform float uTime;

void main() {
  float a = iFlight.y + uTime * iFlight.x;
  vec3 centre = iOrbit.xyz;
  vec3 pos = centre + vec3(cos(a) * iOrbit.w, sin(uTime * iBob.y + iFlight.y) * iBob.x, sin(a) * iOrbit.w);

  // heading is the tangent to the orbit; bank into the turn like a real bird
  vec3 fwd = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(iFlight.x));
  float bank = 0.42;
  vec3 up = normalize(vec3(sin(a) * bank, 1.0, -cos(a) * bank) * sign(iFlight.x) + vec3(0.0, 0.6, 0.0));
  vec3 right = normalize(cross(fwd, up));
  up = cross(right, fwd);

  vec3 local = position * iFlight.w;
  // flap: wingtips travel furthest, and the downstroke is faster than the up
  float beat = sin(uTime * iFlight.z + iFlight.y * 3.1);
  local.y += abs(local.x) * (beat * 0.55 + 0.12) ;
  local.x *= 1.0 - abs(beat) * 0.16;

  vec3 world = pos + right * local.x + up * local.y + fwd * local.z;
  vWorld = world;
  // wings catch the sky on the upstroke; it is the only shading they need
  vShade = 0.55 + 0.45 * clamp(beat * 0.5 + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const BIRD_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying float vShade;
${ATMO_PARS}
uniform vec3 uColor;
void main() {
  vec3 col = uColor * vShade;
  col = realmsApplyFog(col, cameraPosition, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface FlockSpec {
  x: number; z: number;
  /** Metres above the terrain at the flock's centre. */
  altitude: number;
  radius: number;
  count: number;
  scale?: number;
  /** Negative circles the other way. */
  speed?: number;
}

export class Birds {
  mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(flocks: FlockSpec[], seed = 'realms-birds') {
    const rng = new Random(seed);
    const total = flocks.reduce((n, f) => n + f.count, 0);
    const geo = new THREE.InstancedBufferGeometry();
    const base = birdGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.instanceCount = total;

    const orbit = new Float32Array(total * 4);
    const flight = new Float32Array(total * 4);
    const bob = new Float32Array(total * 2);
    let i = 0;
    for (const f of flocks) {
      const cy = terrainHeight(f.x, f.z) + f.altitude;
      for (let k = 0; k < f.count; k++) {
        // spread the flock through the thermal rather than onto one ring
        const r = f.radius * rng.range(0.55, 1.0);
        orbit[i * 4] = f.x + rng.range(-f.radius, f.radius) * 0.18;
        orbit[i * 4 + 1] = cy + rng.range(-1, 1) * f.radius * 0.22;
        orbit[i * 4 + 2] = f.z + rng.range(-f.radius, f.radius) * 0.18;
        orbit[i * 4 + 3] = r;
        const sp = (f.speed ?? 1) * rng.range(0.055, 0.085) * (40 / Math.max(r, 8));
        flight[i * 4] = sp;
        flight[i * 4 + 1] = rng.angle();
        flight[i * 4 + 2] = rng.range(4.2, 6.4);
        flight[i * 4 + 3] = (f.scale ?? 1) * rng.range(0.8, 1.25);
        bob[i * 2] = rng.range(1.2, 4.0);
        bob[i * 2 + 1] = rng.range(0.15, 0.35);
        i++;
      }
    }
    geo.setAttribute('iOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
    geo.setAttribute('iFlight', new THREE.InstancedBufferAttribute(flight, 4));
    geo.setAttribute('iBob', new THREE.InstancedBufferAttribute(bob, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);

    this.material = new THREE.ShaderMaterial({
      vertexShader: BIRD_VERT,
      fragmentShader: BIRD_FRAG,
      side: THREE.DoubleSide,
      uniforms: { ...atmo, uColor: { value: new THREE.Color('#2b2f36') } },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'birds';
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ------------------------------------------------------------------ *
 * Sunlit motes
 * ------------------------------------------------------------------ */

const MOTE_VERT = /* glsl */ `
attribute vec3 iSeed;    // stable random position inside the unit box
attribute vec2 iSize;    // x = radius, y = drift rate
varying float vFade;
varying vec2 vUv;
varying vec3 vWorld;
uniform float uTime;
uniform float uBox;
uniform vec3 uCam;
uniform vec2 uWind;
uniform vec3 uSunDir;

void main() {
  // Drift the whole field downwind, then wrap it around the camera. Wrapping
  // rather than respawning means a mote never pops into existence in view.
  vec3 p = iSeed * uBox;
  p.x += uWind.x * uTime * iSize.y * 1.4;
  p.z += uWind.y * uTime * iSize.y * 1.4;
  p.y += sin(uTime * iSize.y * 0.9 + iSeed.x * 31.0) * 0.6 - uTime * iSize.y * 0.25;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 centre = uCam + rel;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = centre + (camRight * position.x + camUp * position.y) * iSize.x;
  vWorld = world;
  vUv = uv;

  // Only backlit dust is visible; dust with the sun behind you is not there.
  vec3 vd = normalize(centre - uCam);
  float back = pow(max(dot(vd, uSunDir), 0.0), 6.0);
  float near = smoothstep(0.9, 4.0, length(centre - uCam));
  float far = 1.0 - smoothstep(uBox * 0.30, uBox * 0.48, length(centre - uCam));
  vFade = back * near * far;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const MOTE_FRAG = /* glsl */ `
precision highp float;
varying float vFade;
varying vec2 vUv;
varying vec3 vWorld;
${ATMO_PARS}
uniform float uStrength;
void main() {
  if (vFade < 0.004) discard;
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * vFade * uStrength;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uSunColor * a, a);
}
`;

export class SunMotes {
  mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(count = 700, box = 46, seed = 'realms-motes') {
    const rng = new Random(seed);
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setIndex(quad.getIndex());
    geo.instanceCount = count;
    quad.dispose();

    const s = new Float32Array(count * 3);
    const size = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      s[i * 3] = rng.next(); s[i * 3 + 1] = rng.next(); s[i * 3 + 2] = rng.next();
      size[i * 2] = rng.range(0.012, 0.045);
      size[i * 2 + 1] = rng.range(0.25, 0.9);
    }
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(s, 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...atmo,
        uBox: { value: box },
        uCam: { value: new THREE.Vector3() },
        uWind: atmo.uWindDir,
        uStrength: { value: 0.85 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'motes';
  }

  update(camera: THREE.Camera) {
    (this.material.uniforms.uCam.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
  }

  set strength(v: number) { this.material.uniforms.uStrength.value = v; }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ------------------------------------------------------------------ *
 * Critters
 * ------------------------------------------------------------------ */

/** A hare: body, haunches, ears. Small enough that silhouette is all of it. */
function critterGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.16, 7, 5);
  body.scale(1, 0.86, 1.5);
  body.translate(0, 0.17, 0);
  parts.push(body);
  const head = new THREE.SphereGeometry(0.095, 6, 5);
  head.translate(0, 0.25, 0.20);
  parts.push(head);
  for (const sx of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.035, 5, 4);
    ear.scale(0.6, 2.4, 0.5);
    ear.translate(sx * 0.05, 0.37, 0.17);
    parts.push(ear);
  }
  const tail = new THREE.SphereGeometry(0.05, 5, 4);
  tail.translate(0, 0.19, -0.21);
  parts.push(tail);

  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of parts) {
    const gp = g.toNonIndexed();
    const a = gp.getAttribute('position');
    const n = gp.getAttribute('normal');
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    gp.dispose(); g.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return merged;
}

interface Critter {
  hx: number; hz: number;          // home
  x: number; z: number; y: number;
  yaw: number;
  /** 0 = grazing, 1 = fleeing. */
  fleeing: number;
  hop: number;
  timer: number;
  vx: number; vz: number;
  scale: number;
}

export class Critters {
  mesh: THREE.InstancedMesh;
  private list: Critter[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private rng: Random;
  private roam: number;

  constructor(material: THREE.Material, count = 10, roam = 70, seed = 'realms-critters') {
    this.rng = new Random(seed);
    this.roam = roam;
    this.mesh = new THREE.InstancedMesh(critterGeometry(), material, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      this.list.push({
        hx: 0, hz: 0, x: 0, y: -999, z: 0, yaw: 0,
        fleeing: 0, hop: this.rng.next() * 6, timer: this.rng.range(0, 5),
        vx: 0, vz: 0, scale: this.rng.range(0.8, 1.2),
      });
    }
  }

  /** Drop a critter somewhere plausible within the roam radius of the player. */
  private reseat(c: Critter, px: number, pz: number) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = this.rng.angle();
      const r = lerp(this.roam * 0.45, this.roam, this.rng.next());
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      if (terrainSlope(x, z) > 0.34) continue;
      const y = terrainHeight(x, z);
      if (y < 2 || y > 250) continue;
      c.hx = x; c.hz = z; c.x = x; c.z = z; c.y = y;
      c.yaw = this.rng.angle();
      c.fleeing = 0; c.vx = 0; c.vz = 0;
      return true;
    }
    return false;
  }

  update(dt: number, px: number, pz: number) {
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      const far = Math.hypot(c.x - px, c.z - pz);
      if (c.y < -900 || far > this.roam * 1.5) {
        if (!this.reseat(c, px, pz)) { this.park(i); continue; }
      }

      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < 11) {
        // bolt, and keep bolting for a moment after you stop chasing
        c.fleeing = 1;
        const inv = 1 / Math.max(d, 0.001);
        c.vx = lerp(c.vx, (c.x - px) * inv * 7.5, 1 - Math.exp(-9 * dt));
        c.vz = lerp(c.vz, (c.z - pz) * inv * 7.5, 1 - Math.exp(-9 * dt));
      } else {
        c.fleeing = Math.max(0, c.fleeing - dt * 0.55);
        if (c.fleeing <= 0) {
          c.timer -= dt;
          if (c.timer <= 0) {
            // grazing shuffle: a short hop to somewhere nearby, then a pause
            c.timer = this.rng.range(1.6, 5.5);
            const a = this.rng.angle();
            c.vx = Math.cos(a) * 1.4;
            c.vz = Math.sin(a) * 1.4;
          }
        }
        c.vx *= Math.exp(-2.4 * dt);
        c.vz *= Math.exp(-2.4 * dt);
      }

      c.x += c.vx * dt;
      c.z += c.vz * dt;
      const speed = Math.hypot(c.vx, c.vz);
      if (speed > 0.05) c.yaw = Math.atan2(c.vx, c.vz);
      c.hop += dt * (2.6 + speed * 1.6);
      c.y = terrainHeight(c.x, c.z);

      // hares do not run, they bound: the hop is the animation
      const bound = Math.max(0, Math.sin(c.hop)) * clamp01(speed * 0.5) * 0.32;
      const lean = -Math.cos(c.hop) * clamp01(speed * 0.35) * 0.34;
      this.p.set(c.x, c.y + bound, c.z);
      this.e.set(lean, c.yaw, 0);
      this.q.setFromEuler(this.e);
      const sc = c.scale * (1 - smoothstep(this.roam * 1.1, this.roam * 1.5, far));
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private park(i: number) {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
  }

  dispose() { this.mesh.geometry.dispose(); }
}
