/**
 * REALMS — the things that live on the shelf.
 *
 * Husks and Stalkers reuse the humanoid rig with different proportions,
 * palettes and gear, so they inherit the whole animation set for free.
 * Riftwisps are a separate construction (a core with orbiting shards, no
 * skeleton). The Warden of the Fall is a humanoid at 2.4x scale with a stone
 * mantle, a two-handed maul and its own attack timings.
 */

import * as THREE from 'three';
import { Rig, autoSkin, type SkinSegment } from './rig';
import {
  humanoidBones, humanoidBody, humanoidSegments, registerHumanoidAnims,
  mergeParts, type HumanoidProfile,
} from './humanoid';
import { limb, tube, roundedBox, plate, at, V } from './geom';
import { Character } from './character';
import { makeCharacterMaterials, WRAITH, AETHER, EMBER } from './materials';

export type EnemyKind = 'husk' | 'stalker' | 'wisp' | 'warden';

const HUSK_PROFILE: HumanoidProfile = {
  height: 1.78, shoulder: 0.225, hip: 0.128, bulk: 0.94,
  neck: 0.05, headScale: 0.94, armLength: 1.06, legLength: 0.98, hunch: 0.12,
};
const STALKER_PROFILE: HumanoidProfile = {
  height: 2.05, shoulder: 0.205, hip: 0.112, bulk: 0.74,
  neck: 0.05, headScale: 0.86, armLength: 1.26, legLength: 1.12, hunch: 0.2,
};
const WARDEN_PROFILE: HumanoidProfile = {
  height: 4.35, shoulder: 0.63, hip: 0.30, bulk: 1.55,
  neck: 0.08, headScale: 1.05, armLength: 1.10, legLength: 0.92, hunch: 0.06,
};

function ring(cx: number, cy: number, cz: number, radius: number, thickness: number, sx = 1, sz = 1, segs = 18) {
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    path.push(V(cx + Math.cos(a) * radius * sx, cy, cz + Math.sin(a) * radius * sz));
    radii.push(thickness);
  }
  return tube(path, radii, { radial: 5, capStart: false, capEnd: false });
}

/** Ragged cloth strips that hang off the husks. */
function tatters(chestY: number, hipY: number, s: number, count: number, seed: number) {
  const parts: THREE.BufferGeometry[] = [];
  const rnd = (i: number) => { const t = Math.sin((i + seed) * 91.7) * 43758.5; return t - Math.floor(t); };
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd(i) * 0.4;
    const len = (0.35 + rnd(i * 3) * 0.75) * s;
    const w = (0.10 + rnd(i * 5) * 0.12) * s;
    const g = new THREE.PlaneGeometry(w, len, 1, 3);
    g.translate(0, -len / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(a) * 0.17 * s, chestY - (chestY - hipY) * 0.2, Math.cos(a) * 0.13 * s),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(i * 7) * 0.2, -a, rnd(i * 11) * 0.3 - 0.15)),
      new THREE.Vector3(1, 1, 1),
    ));
    parts.push(g);
  }
  return parts;
}

export interface BuiltEnemy {
  character: Character;
  materials: ReturnType<typeof makeCharacterMaterials>;
  weaponTip: THREE.Object3D;
  height: number;
  radius: number;
}

function buildHumanoidEnemy(kind: 'husk' | 'stalker' | 'warden'): BuiltEnemy {
  const p = kind === 'husk' ? HUSK_PROFILE : kind === 'stalker' ? STALKER_PROFILE : WARDEN_PROFILE;
  const s = p.height / 1.86;
  const rig = new Rig(humanoidBones(p));
  const w = (n: string) => rig.worldOf(n).clone();
  const body = humanoidBody(rig, p);
  const chest = w('chest'), hips = w('hips'), neck = w('neck');

  const armor: THREE.BufferGeometry[] = [];
  const leather: THREE.BufferGeometry[] = [];
  const energy: THREE.BufferGeometry[] = [];
  const cloth: THREE.BufferGeometry[] = [];

  const glow = kind === 'warden' ? AETHER.clone() : kind === 'stalker' ? EMBER.clone() : WRAITH.clone();

  if (kind === 'husk') {
    // rusted breastplate and a helm with a single burning slit
    armor.push(tube(
      [V(0, hips.y + 0.06 * s, 0), V(0, chest.y, chest.z), V(0, neck.y - 0.05 * s, 0)],
      [0.158 * s, 0.174 * s, 0.115 * s],
      { radial: 14, squashX: [1.22, 1.32, 0.95], squashZ: [0.82, 0.82, 0.9], capStart: false, capEnd: false },
    ));
    armor.push(at(roundedBox(0.24 * s, 0.26 * s, 0.25 * s, 0.42, 2), 0, w('head').y + 0.085 * s, w('head').z));
    energy.push(at(roundedBox(0.17 * s, 0.032 * s, 0.03 * s, 0.2, 1), 0, w('head').y + 0.075 * s, w('head').z - 0.115 * s));
    for (const side of [1, -1] as const) {
      const sh = w('upperArmL'); const x = sh.x * side;
      const g = new THREE.SphereGeometry(0.095 * s, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.55);
      g.scale(1.1, 0.8, 1.0);
      g.translate(x * 1.04, sh.y + 0.026 * s, sh.z);
      armor.push(g);
    }
    leather.push(ring(0, hips.y + 0.01 * s, 0, 0.148 * s, 0.028 * s, 1.2, 0.86, 18));
    cloth.push(...tatters(chest.y, hips.y, s, 11, 3));
    energy.push(ring(0, chest.y + 0.03 * s, chest.z + 0.16 * s, 0.035 * s, 0.010 * s, 1, 0.4, 14));
  } else if (kind === 'stalker') {
    // long, starved, wrapped in bandage-cloth with ember cracks
    cloth.push(...tatters(chest.y, hips.y, s, 16, 11));
    for (const side of [1, -1] as const) {
      const el = w('lowerArmL').clone(); el.x *= side;
      const hd = w('handL').clone(); hd.x *= side;
      // long claws
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.035 * s;
        armor.push(limb(
          hd.clone().add(V(off, -0.02 * s, 0.01 * s)),
          hd.clone().add(V(off * 1.6, -0.30 * s, -0.09 * s)),
          0.017 * s, 0.003 * s, 6,
        ));
      }
      energy.push(limb(el.clone().lerp(hd, 0.2), el.clone().lerp(hd, 0.9), 0.006 * s, 0.004 * s, 5));
    }
    energy.push(limb(V(0, hips.y, -0.10 * s), V(0, neck.y, -0.06 * s), 0.011 * s, 0.006 * s, 6));
    const head = w('head');
    armor.push(at(roundedBox(0.20 * s, 0.30 * s, 0.22 * s, 0.5, 2), 0, head.y + 0.09 * s, head.z + 0.01 * s));
    energy.push(at(new THREE.SphereGeometry(0.020 * s, 8, 6), 0.055 * s, head.y + 0.10 * s, head.z - 0.095 * s));
    energy.push(at(new THREE.SphereGeometry(0.020 * s, 8, 6), -0.055 * s, head.y + 0.10 * s, head.z - 0.095 * s));
  } else {
    // ---- the Warden: stone mantle, no face, a cage of aether in the chest ----
    armor.push(tube(
      [V(0, hips.y - 0.05 * s, 0), V(0, (hips.y + chest.y) / 2, chest.z), V(0, chest.y, chest.z), V(0, neck.y - 0.02 * s, 0)],
      [0.20 * s, 0.205 * s, 0.225 * s, 0.15 * s],
      { radial: 18, squashX: [1.25, 1.30, 1.42, 1.0], squashZ: [0.88, 0.86, 0.90, 0.94], capStart: false, capEnd: false },
    ));
    // the cage
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + (i / 6) * 1.8;
      armor.push(limb(
        V(Math.sin(a) * 0.20 * s, chest.y - 0.14 * s, Math.cos(a) * 0.17 * s),
        V(Math.sin(a) * 0.17 * s, chest.y + 0.16 * s, Math.cos(a) * 0.14 * s),
        0.016 * s, 0.014 * s, 5,
      ));
    }
    const core = new THREE.SphereGeometry(0.115 * s, 16, 12);
    core.translate(0, chest.y + 0.01 * s, chest.z + 0.06 * s);
    energy.push(core);

    // mantle of hanging stone slabs
    for (let i = 0; i < 11; i++) {
      const a = -1.5 + (i / 10) * 3.0;
      const len = (0.45 + Math.cos(a) * 0.22) * s;
      armor.push(at(roundedBox(0.13 * s, len, 0.07 * s, 0.15, 1),
        Math.sin(a) * 0.30 * s, chest.y + 0.12 * s - len / 2, Math.cos(a) * 0.24 * s - 0.05 * s, -a, 0.12, 0));
    }
    // helm: a blank slab with a burning seam
    const head = w('head');
    armor.push(at(roundedBox(0.30 * s, 0.40 * s, 0.30 * s, 0.24, 2), 0, head.y + 0.11 * s, head.z));
    armor.push(at(roundedBox(0.09 * s, 0.46 * s, 0.09 * s, 0.3, 1), 0, head.y + 0.26 * s, head.z - 0.06 * s, 0, -0.3, 0));
    energy.push(at(roundedBox(0.24 * s, 0.035 * s, 0.03 * s, 0.2, 1), 0, head.y + 0.10 * s, head.z - 0.152 * s));
    // horns
    for (const side of [1, -1] as const) {
      armor.push(limb(
        V(side * 0.13 * s, head.y + 0.22 * s, head.z + 0.02 * s),
        V(side * 0.34 * s, head.y + 0.50 * s, head.z + 0.15 * s),
        0.045 * s, 0.010 * s, 7,
      ));
    }
    // pauldrons: slabs, not shells
    for (const side of [1, -1] as const) {
      const sh = w('upperArmL'); const x = sh.x * side;
      for (let i = 0; i < 3; i++) {
        armor.push(at(roundedBox(0.30 * s, 0.10 * s, 0.34 * s, 0.2, 1),
          x * (1.02 + i * 0.05), sh.y + 0.10 * s - i * 0.11 * s, sh.z, 0, 0, side * (0.20 + i * 0.14)));
      }
      energy.push(at(roundedBox(0.26 * s, 0.020 * s, 0.30 * s, 0.2, 1),
        x * 1.14, sh.y - 0.135 * s, sh.z, 0, 0, side * 0.50));
      // greaves
      const knee = w('lowerLegL').clone(); knee.x *= side;
      const foot = w('footL').clone(); foot.x *= side;
      armor.push(limb(knee.clone().lerp(foot, 0.05), knee.clone().lerp(foot, 0.95), 0.098 * s, 0.075 * s, 12, 1.05));
      energy.push(limb(knee.clone().lerp(foot, 0.2).add(V(0, 0, -0.08 * s)), knee.clone().lerp(foot, 0.85).add(V(0, 0, -0.07 * s)), 0.008 * s, 0.006 * s, 5));
    }
    leather.push(ring(0, hips.y, 0, 0.21 * s, 0.045 * s, 1.2, 0.9, 20));
  }

  const materials = makeCharacterMaterials({
    key: `enemy-${kind}`,
    skin: kind === 'warden' ? '#3b3d44' : kind === 'stalker' ? '#5e5348' : '#6b6154',
    suit: kind === 'warden' ? '#24262c' : '#2b2a2c',
    armor: kind === 'warden' ? '#3a3d46' : kind === 'stalker' ? '#3a3129' : '#4a4038',
    cloth: kind === 'stalker' ? '#6a5c48' : '#3a3340',
    leather: '#33291f',
    energy: glow,
    energyPower: kind === 'warden' ? 3.2 : 2.4,
    metalness: kind === 'warden' ? 0.35 : 0.55,
    roughness: kind === 'warden' ? 0.72 : 0.55,
  });

  const geo = mergeParts([body.skin, body.suit, armor, leather, energy]);
  autoSkin(geo, rig, humanoidSegments(rig, p));
  const mesh = new THREE.SkinnedMesh(geo, [
    materials.skin, materials.suit, materials.armor, materials.leather, materials.energy,
  ]);
  mesh.bind(rig.skeleton);
  mesh.normalizeSkinWeights();

  const character = new Character(mesh, rig, { footIK: kind === 'warden', scale: s, castShadow: true });

  // hanging cloth as its own skinned mesh
  if (cloth.length) {
    const clothGeo = mergeParts([cloth]);
    const segs: SkinSegment[] = [
      { bone: 'hips', a: hips.clone().add(V(0, -0.5 * s, 0)), b: hips.clone().add(V(0, 0.1 * s, 0)), radius: 0.9 * s, falloff: 1.2 },
      { bone: 'spine', a: w('spine'), b: chest.clone(), radius: 0.5 * s, falloff: 1.4 },
      { bone: 'chest', a: chest.clone(), b: neck.clone(), radius: 0.45 * s, falloff: 1.4 },
    ];
    autoSkin(clothGeo, rig, segs);
    const cm = new THREE.SkinnedMesh(clothGeo, materials.cloth);
    cm.bind(rig.skeleton);
    cm.normalizeSkinWeights();
    cm.castShadow = true;
    cm.frustumCulled = false;
    character.group.add(cm);
  }

  registerHumanoidAnims(character.anim, rig, { armed: kind !== 'stalker' });
  character.anim.setState('idle');
  character.strideLength = (kind === 'warden' ? 3.4 : kind === 'stalker' ? 2.3 : 1.85) * s;

  // ---- weapons ----
  const handWorld = rig.worldOf('handR');
  const socket = new THREE.Group();
  socket.position.copy(rig.worldOf('gripR')).sub(handWorld);
  socket.rotation.set(-2.34, 0.10, 0.14);
  socket.scale.setScalar(s);
  rig.get('handR').add(socket);

  if (kind === 'husk') {
    const bladeParts = [
      plate([[0, 0], [0.05, 0.05], [0.055, 0.55], [0.03, 0.76], [0, 0.84], [-0.03, 0.76], [-0.055, 0.55], [-0.05, 0.05]], 0.02, 0.3),
      roundedBox(0.20, 0.03, 0.05, 0.4, 1),
    ];
    const gripG = [limb(V(0, -0.02, 0), V(0, -0.18, 0), 0.018, 0.016, 7)];
    const glowG = [limb(V(0, 0.06, 0), V(0, 0.72, 0), 0.008, 0.005, 5)];
    const g = mergeParts([bladeParts, gripG, glowG]);
    const m = new THREE.Mesh(g, [materials.armor, materials.leather, materials.energy]);
    m.castShadow = true;
    m.frustumCulled = false;
    socket.add(m);
  } else if (kind === 'warden') {
    // a two-handed maul of shelf-stone
    const headG = [roundedBox(0.60, 0.62, 0.60, 0.14, 2)];
    headG[0].translate(0, 1.32, 0);
    const spikes: THREE.BufferGeometry[] = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      spikes.push(at(new THREE.ConeGeometry(0.13, 0.36, 6), dx * 0.34, 1.32, dz * 0.34, 0, dz !== 0 ? Math.PI / 2 : 0, dx !== 0 ? -dx * Math.PI / 2 : 0));
    }
    const haft = [limb(V(0, -0.55, 0), V(0, 1.30, 0), 0.058, 0.070, 8)];
    const glowG = [
      ring(0, 1.32, 0, 0.315, 0.024, 1, 1, 16),
      limb(V(0, -0.30, 0), V(0, 1.05, 0), 0.014, 0.010, 6),
    ];
    const g = mergeParts([[...headG, ...spikes], haft, glowG]);
    const m = new THREE.Mesh(g, [materials.armor, materials.leather, materials.energy]);
    m.castShadow = true;
    m.frustumCulled = false;
    socket.add(m);
  }

  const weaponTip = new THREE.Object3D();
  weaponTip.position.set(0, kind === 'warden' ? 1.5 : 0.8, 0);
  socket.add(weaponTip);

  return {
    character, materials, weaponTip,
    height: p.height,
    radius: kind === 'warden' ? 1.5 : 0.42,
  };
}

/* ------------------------------------------------------------------ *
 * Riftwisp — no skeleton, just a core and orbiting shards
 * ------------------------------------------------------------------ */

export class Riftwisp {
  group = new THREE.Group();
  core: THREE.Mesh;
  shards: THREE.Mesh[] = [];
  private t = Math.random() * 10;
  materials: ReturnType<typeof makeCharacterMaterials>;

  constructor() {
    this.materials = makeCharacterMaterials({
      key: 'wisp', armor: '#2a2333', energy: WRAITH.clone(), energyPower: 3.4,
      metalness: 0.3, roughness: 0.5,
    });
    const coreGeo = new THREE.IcosahedronGeometry(0.34, 1);
    this.core = new THREE.Mesh(coreGeo, this.materials.energy);
    this.core.castShadow = false;
    this.group.add(this.core);

    const cage = new THREE.TorusGeometry(0.62, 0.028, 6, 20);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(cage, this.materials.armor);
      m.rotation.set(i * 1.1, i * 0.7, i * 0.4);
      this.group.add(m);
      this.shards.push(m);
    }
    for (let i = 0; i < 5; i++) {
      const g = new THREE.TetrahedronGeometry(0.16 + Math.random() * 0.10, 0);
      const m = new THREE.Mesh(g, this.materials.armor);
      m.userData.orbit = { r: 0.75 + Math.random() * 0.5, a: Math.random() * 6.28, s: 0.6 + Math.random() * 1.2, y: (Math.random() - 0.5) * 0.7 };
      this.group.add(m);
      this.shards.push(m);
    }
  }

  update(dt: number) {
    this.t += dt;
    this.core.rotation.y += dt * 0.7;
    this.core.rotation.x += dt * 0.4;
    const pulse = 1 + Math.sin(this.t * 3.1) * 0.09;
    this.core.scale.setScalar(pulse);
    for (const s of this.shards) {
      const o = s.userData.orbit as { r: number; a: number; s: number; y: number } | undefined;
      if (o) {
        o.a += dt * o.s;
        s.position.set(Math.cos(o.a) * o.r, o.y + Math.sin(this.t * 1.3 + o.a) * 0.12, Math.sin(o.a) * o.r);
        s.rotation.x += dt * 1.5;
        s.rotation.z += dt * 1.1;
      } else {
        s.rotation.x += dt * 0.35;
        s.rotation.y += dt * 0.22;
      }
    }
  }

  dispose() {
    this.core.geometry.dispose();
    for (const s of this.shards) s.geometry.dispose();
  }
}

export function buildEnemy(kind: EnemyKind) {
  if (kind === 'wisp') return null;
  return buildHumanoidEnemy(kind);
}

export { HUSK_PROFILE, STALKER_PROFILE, WARDEN_PROFILE };
