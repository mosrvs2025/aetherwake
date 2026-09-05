/**
 * REALMS — character geometry primitives.
 *
 * Characters are built from swept tubes and extruded plates rather than
 * primitive spheres and boxes, which is what lets a bald warrior in plate
 * armour read as a sculpted character instead of a snowman. Everything here
 * produces plain BufferGeometry in bind-pose world space so it can be merged
 * and then skinned in one pass.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export { mergeGeometries };

export interface TubeOpts {
  radial?: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** Per-ring elliptical squash: >1 widens X, <1 narrows. */
  squashX?: number[];
  squashZ?: number[];
  /** Twist in radians per ring. */
  twist?: number[];
}

/**
 * Sweep a variable-radius tube along a polyline using parallel transport, so
 * limbs do not flip or pinch at bends.
 */
export function tube(path: THREE.Vector3[], radii: number[], opts: TubeOpts = {}) {
  const radial = opts.radial ?? 10;
  const n = path.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // parallel-transport frames
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  const normal = new THREE.Vector3(1, 0, 0);
  if (Math.abs(tangents[0].dot(normal)) > 0.9) normal.set(0, 0, 1);
  normal.crossVectors(tangents[0], normal).normalize();

  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    if (i > 0) {
      const prev = tangents[i - 1];
      const axis = new THREE.Vector3().crossVectors(prev, t);
      const len = axis.length();
      if (len > 1e-5) {
        const ang = Math.atan2(len, prev.dot(t));
        normal.applyAxisAngle(axis.divideScalar(len), ang);
      }
      normal.addScaledVector(t, -normal.dot(t)).normalize();
    }
    const binormal = new THREE.Vector3().crossVectors(t, normal).normalize();
    const r = radii[i];
    const sx = opts.squashX?.[i] ?? 1;
    const sz = opts.squashZ?.[i] ?? 1;
    const tw = opts.twist?.[i] ?? 0;
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2 + tw;
      const cx = Math.cos(a) * r * sx;
      const cz = Math.sin(a) * r * sz;
      const px = path[i].x + normal.x * cx + binormal.x * cz;
      const py = path[i].y + normal.y * cx + binormal.y * cz;
      const pz = path[i].z + normal.z * cx + binormal.z * cz;
      positions.push(px, py, pz);
      const nx = normal.x * (cx / (r * sx || 1)) + binormal.x * (cz / (r * sz || 1));
      const ny = normal.y * (cx / (r * sx || 1)) + binormal.y * (cz / (r * sz || 1));
      const nz = normal.z * (cx / (r * sx || 1)) + binormal.z * (cz / (r * sz || 1));
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nl, ny / nl, nz / nl);
      uvs.push(k / radial, i / (n - 1));
    }
  }

  const vpr = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * vpr + k, b = a + 1, c = a + vpr, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  if (opts.capStart !== false) {
    const ci = positions.length / 3;
    positions.push(path[0].x, path[0].y, path[0].z);
    normals.push(-tangents[0].x, -tangents[0].y, -tangents[0].z);
    uvs.push(0.5, 0);
    for (let k = 0; k < radial; k++) indices.push(ci, k + 1, k);
  }
  if (opts.capEnd !== false) {
    const ci = positions.length / 3;
    const last = (n - 1) * vpr;
    positions.push(path[n - 1].x, path[n - 1].y, path[n - 1].z);
    normals.push(tangents[n - 1].x, tangents[n - 1].y, tangents[n - 1].z);
    uvs.push(0.5, 1);
    for (let k = 0; k < radial; k++) indices.push(ci, last + k, last + k + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Straight tube between two points — the common case. */
export function limb(a: THREE.Vector3, b: THREE.Vector3, rA: number, rB: number, radial = 10, mid = 1) {
  const steps = 5;
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(new THREE.Vector3().lerpVectors(a, b, t));
    const bulge = Math.sin(t * Math.PI) * (mid - 1);
    radii.push((rA + (rB - rA) * t) * (1 + bulge));
  }
  return tube(path, radii, { radial });
}

/**
 * Extrude a closed 2D polygon into a plate with bevelled edges. Used for
 * pauldrons, sword blades, banners and gate ironwork.
 */
export function plate(points: Array<[number, number]>, thickness: number, bevel = 0.16) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness * (1 - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: thickness * bevel,
    bevelSize: thickness * bevel * 1.2,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

/** A rounded box built by spherifying a subdivided cube. */
export function roundedBox(w: number, h: number, d: number, round = 0.35, seg = 3) {
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const hx = w / 2, hy = h / 2, hz = d / 2;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const sx = v.x / hx, sy = v.y / hy, sz = v.z / hz;
    const l = Math.max(1e-5, Math.sqrt(sx * sx + sy * sy + sz * sz));
    const nx = (sx / l) * hx, ny = (sy / l) * hy, nz = (sz / l) * hz;
    v.set(THREE.MathUtils.lerp(v.x, nx, round), THREE.MathUtils.lerp(v.y, ny, round), THREE.MathUtils.lerp(v.z, nz, round));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Human-ish skull: a sphere squashed and lengthened, with a jaw wedge. */
export function skull(r = 0.115) {
  const head = new THREE.SphereGeometry(r, 20, 16);
  head.scale(0.94, 1.12, 1.04);
  const pos = head.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // flatten the back of the skull slightly, push the brow forward
    if (v.z < 0) v.z *= 0.92;
    if (v.y < 0) {
      const t = Math.min(1, -v.y / r);
      v.z += t * r * 0.22;          // jaw forward
      v.x *= 1 - t * 0.30;          // taper to the chin
      v.y -= t * r * 0.10;
    }
    if (v.y > r * 0.4 && v.z > 0) v.z += r * 0.04;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  head.computeVertexNormals();
  return head;
}

export function transformed(geo: THREE.BufferGeometry, m: THREE.Matrix4) {
  const g = geo.clone();
  g.applyMatrix4(m);
  return g;
}

export function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  return transformed(geo, m);
}

/** Mirror a geometry across X, flipping winding so normals stay outward. */
export function mirrorX(geo: THREE.BufferGeometry) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
  }
  const n = g.getAttribute('normal');
  if (n) { for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i)); n.needsUpdate = true; }
  return g;
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
