/**
 * REALMS — the Warden: bald, dark plate, aether running through the seams.
 *
 * Built entirely in code: swept-tube musculature under layered plate, a cloak
 * skinned to a four-bone chain that the Character class drives from velocity,
 * and a longsword rigidly bound to the right grip with a lit fuller.
 *
 * Asset pipeline note — `AssetRegistry.override('player', url)` swaps this for
 * a Blender GLB with the same bone names and everything else (animation,
 * combat timing, IK, the sword socket) keeps working; see assets/registry.ts.
 */

import * as THREE from 'three';
import { Rig, autoSkin, rigidSkin } from './rig';
import {
  humanoidBones, humanoidBody, humanoidSegments, registerHumanoidAnims,
  mergeParts, PLAYER_PROFILE, type HumanoidProfile,
} from './humanoid';
import { limb, tube, roundedBox, plate, at, V } from './geom';
import { Character } from './character';
import { makeCharacterMaterials, AETHER, type CharacterMaterials } from './materials';
import type { SkinSegment } from './rig';
import { Assets, CANONICAL_BONES } from '../assets/registry';

/* ---------------- armour pieces ---------------- */

function shoulderShell(x: number, y: number, z: number, r: number, tilt: number, flip: number) {
  const g = new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  g.scale(1.18, 0.86, 1.02);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.10, 0, flip * tilt)),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

function ring(cx: number, cy: number, cz: number, radius: number, thickness: number, squashX = 1, squashZ = 1, segs = 24) {
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    path.push(V(cx + Math.cos(a) * radius * squashX, cy, cz + Math.sin(a) * radius * squashZ));
    radii.push(thickness);
  }
  return tube(path, radii, { radial: 6, capStart: false, capEnd: false });
}

/** A thin emissive line following a path — the aether in the seams. */
function energyLine(points: THREE.Vector3[], r = 0.009) {
  return tube(points, points.map(() => r), { radial: 5 });
}

/* ---------------- the cloak ---------------- */

function buildCloak(chestY: number, hipY: number, s: number) {
  const cols = 16, rows = 14;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const top = chestY + 0.115 * s;
  const bottom = hipY - 0.52 * s;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = THREE.MathUtils.lerp(top, bottom, v);
    // shoulders narrow, flares out toward the hem
    const width = (0.185 + 0.135 * Math.pow(v, 0.8)) * s;
    const depth = (0.075 + 0.115 * v * v) * s;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const a = (u - 0.5) * Math.PI * 0.80;
      const x = Math.sin(a) * width;
      const z = depth + (1 - Math.cos(a)) * 0.15 * s + Math.sin(u * Math.PI * 3) * 0.006 * s;
      // scalloped hem
      const hem = v > 0.94 ? Math.sin(u * Math.PI * 5) * 0.03 * s : 0;
      pos.push(x, y - hem, z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------- the sword ---------------- */

export function buildSword(scale = 1, energyLen = 0.86) {
  const bladeProfile: Array<[number, number]> = [
    [0.000, 0.00], [0.052, 0.05], [0.058, 0.30], [0.052, 0.66],
    [0.032, 0.90], [0.000, 1.00],
    [-0.032, 0.90], [-0.052, 0.66], [-0.058, 0.30], [-0.052, 0.05],
  ];
  const blade = plate(bladeProfile, 0.019, 0.30);
  blade.scale(scale, 1.02 * scale, scale);

  const guard = roundedBox(0.30 * scale, 0.038 * scale, 0.055 * scale, 0.4, 2);
  guard.translate(0, -0.012 * scale, 0);
  const grip = limb(V(0, -0.02 * scale, 0), V(0, -0.20 * scale, 0), 0.021 * scale, 0.019 * scale, 8, 1.1);
  const pommel = new THREE.SphereGeometry(0.032 * scale, 12, 10);
  pommel.scale(1, 0.85, 1);
  pommel.translate(0, -0.215 * scale, 0);

  const fuller = energyLine([
    V(0, 0.06 * scale, 0), V(0, 0.35 * scale, 0), V(0, 0.62 * scale, 0), V(0, energyLen * scale, 0),
  ], 0.0105 * scale);
  const gem = new THREE.SphereGeometry(0.020 * scale, 10, 8);
  gem.translate(0, 0.012 * scale, 0);

  return { steel: [blade, guard], leather: [grip], metal: [pommel], energy: [fuller, gem] };
}

/* ---------------- imported models ---------------- */

const IDENTITY_BONE_MAP: Record<string, string> = Object.fromEntries(
  CANONICAL_BONES.map((n) => [n, n]),
);

/**
 * If the manifest supplies a GLB for this id, wrap it so it is driven by the
 * same rig, animator, IK and sockets as the procedural character.
 */
export function buildImportedCharacter(id: string): BuiltCharacter | null {
  const inst = Assets.instance(id);
  if (!inst || !inst.skinned) return null;
  const map = Assets.boneMap(id) ?? IDENTITY_BONE_MAP;
  const rig = Rig.adopt(inst.skinned.skeleton, map);
  if (rig.bones.length < 6) {
    console.warn(`[realms] imported "${id}" mapped only ${rig.bones.length} bones; check boneMap.`);
    return null;
  }
  const materials = makeCharacterMaterials({ key: 'imported-' + id });
  const character = new Character(inst.skinned, rig, {
    footIK: rig.hasBone('footL') && rig.hasBone('footR'),
    scale: inst.entry.scale ?? 1,
    castShadow: true,
    attach: inst.root,
  });
  registerHumanoidAnims(character.anim, rig, { armed: true });
  character.anim.setState('idle');
  character.strideLength = 1.9 * (inst.entry.scale ?? 1);

  const hand = rig.byName.get('gripR') ?? rig.byName.get('handR') ?? rig.bones[0];
  const socket = new THREE.Group();
  hand.add(socket);
  const swordBase = new THREE.Object3D();
  swordBase.position.set(0, 0.06, 0);
  socket.add(swordBase);
  const swordTip = new THREE.Object3D();
  swordTip.position.set(0, 1.02, 0);
  socket.add(swordTip);

  return { character, materials, swordTip, swordBase, sword: null };
}

/* ---------------- the character ---------------- */

export interface WarriorOpts {
  profile?: HumanoidProfile;
  materials?: Partial<Parameters<typeof makeCharacterMaterials>[0]>;
  withCloak?: boolean;
  withSword?: boolean;
  key?: string;
}

export interface BuiltCharacter {
  character: Character;
  materials: CharacterMaterials;
  /** Socket objects on the right hand — VFX anchor points for the blade. */
  swordTip: THREE.Object3D;
  swordBase: THREE.Object3D;
  sword: THREE.Mesh | null;
}

export function buildWarrior(opts: WarriorOpts = {}): BuiltCharacter {
  const imported = buildImportedCharacter(opts.key ?? 'player');
  if (imported) return imported;
  const p = opts.profile ?? PLAYER_PROFILE;
  const s = p.height / 1.86;
  const rig = new Rig(humanoidBones(p));
  const w = (n: string) => rig.worldOf(n).clone();

  const body = humanoidBody(rig, p);
  const chest = w('chest'), hips = w('hips'), neck = w('neck');

  /* ---- armour ---- */
  const armorParts: THREE.BufferGeometry[] = [];
  const energyParts: THREE.BufferGeometry[] = [];
  const leatherParts: THREE.BufferGeometry[] = [];

  // cuirass — a second skin over the torso with a raised sternum
  const cuPath = [
    V(0, hips.y + 0.02 * s, 0),
    V(0, (hips.y + chest.y) / 2, chest.z - 0.006),
    V(0, chest.y, chest.z),
    V(0, chest.y + 0.115 * s, chest.z + 0.006),
    V(0, neck.y - 0.028 * s, 0),
  ];
  const cuR = [0.157, 0.161, 0.176, 0.170, 0.118].map((r) => r * s);
  armorParts.push(tube(cuPath, cuR, {
    radial: 18,
    squashX: [1.22, 1.26, 1.34, 1.26, 0.94],
    squashZ: [0.83, 0.80, 0.82, 0.82, 0.88],
    capStart: false, capEnd: false,
  }));
  // sternum ridge + collar
  armorParts.push(at(roundedBox(0.055 * s, 0.30 * s, 0.05 * s, 0.5, 2), 0, chest.y + 0.01 * s, chest.z + 0.150 * s, -0.05, 0, 0));
  armorParts.push(ring(0, neck.y - 0.02 * s, 0, 0.105 * s, 0.028 * s, 1.05, 0.92, 20));

  // chest sigil: a ring of aether with a core
  energyParts.push(ring(0, chest.y + 0.055 * s, chest.z + 0.163 * s, 0.052 * s, 0.010 * s, 1, 0.35, 20));
  const core = new THREE.SphereGeometry(0.024 * s, 12, 10);
  core.scale(1, 1, 0.45);
  core.translate(0, chest.y + 0.055 * s, chest.z + 0.166 * s);
  energyParts.push(core);

  // pauldrons: two lames per side, plus an aether rim
  for (const side of [1, -1] as const) {
    const sh = w('upperArmL'); const x = sh.x * side;
    armorParts.push(shoulderShell(x * 1.02, sh.y + 0.030 * s, sh.z, 0.108 * s, 0.30, side));
    armorParts.push(shoulderShell(x * 1.10, sh.y - 0.048 * s, sh.z, 0.096 * s, 0.42, side));
    const rimPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * (0.06 + 0.88 * (i / 16));
      rimPts.push(V(
        x * 1.10 + Math.cos(a) * 0.010 * s * side,
        sh.y - 0.048 * s - Math.abs(Math.sin(a)) * 0.014 * s,
        Math.sin(a - Math.PI / 2) * 0.098 * s,
      ));
    }
    energyParts.push(energyLine(rimPts, 0.0058 * s));

    // bracers
    const el = w('lowerArmL').clone(); el.x *= side;
    const hd = w('handL').clone(); hd.x *= side;
    const bA = el.clone().lerp(hd, 0.12);
    const bB = el.clone().lerp(hd, 0.86);
    armorParts.push(limb(bA, bB, 0.063 * s, 0.049 * s, 12, 1.02));
    energyParts.push(energyLine([
      bA.clone().add(V(0.045 * s * side, 0, 0.02 * s)),
      bB.clone().add(V(0.036 * s * side, 0, 0.018 * s)),
    ], 0.0052 * s));

    // gauntlet
    const fg = w('fingersL').clone(); fg.x *= side;
    armorParts.push(at(roundedBox(0.070 * s, 0.10 * s, 0.095 * s, 0.45, 2),
      hd.x, (hd.y + fg.y) / 2 + 0.012 * s, hd.z));

    // greaves + sabatons
    const knee = w('lowerLegL').clone(); knee.x *= side;
    const foot = w('footL').clone(); foot.x *= side;
    const toe = w('toeL').clone(); toe.x *= side;
    armorParts.push(limb(knee.clone().lerp(foot, 0.06), knee.clone().lerp(foot, 0.94), 0.079 * s, 0.058 * s, 12, 1.02));
    armorParts.push(at(roundedBox(0.10 * s, 0.055 * s, 0.15 * s, 0.4, 2),
      foot.x, foot.y - 0.028 * s, toe.z + 0.035 * s));
    // knee cop
    armorParts.push(at(new THREE.SphereGeometry(0.062 * s, 12, 10), knee.x, knee.y + 0.012 * s, knee.z - 0.014 * s, 0, 0, 0, 1, 0.9, 0.95));
    energyParts.push(energyLine([
      knee.clone().lerp(foot, 0.16).add(V(0, 0, -0.062 * s)),
      knee.clone().lerp(foot, 0.88).add(V(0, 0, -0.050 * s)),
    ], 0.0048 * s));
  }

  // belt + tassets
  leatherParts.push(ring(0, hips.y + 0.015 * s, 0, 0.150 * s, 0.032 * s, 1.20, 0.86, 22));
  energyParts.push(at(roundedBox(0.062 * s, 0.052 * s, 0.028 * s, 0.4, 1), 0, hips.y + 0.015 * s, 0.140 * s));
  for (const side of [1, -1] as const) {
    for (const off of [0.30, 0.72]) {
      const ang = side * off;
      const px = Math.sin(ang) * 0.175 * s;
      const pz = Math.cos(ang) * 0.115 * s;
      armorParts.push(at(roundedBox(0.10 * s, 0.20 * s, 0.035 * s, 0.35, 2),
        px, hips.y - 0.10 * s, pz, 0.06, -ang, 0));
    }
  }
  // back plate ridge
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    armorParts.push(at(roundedBox(0.070 * s, 0.052 * s, 0.030 * s, 0.5, 1),
      0, THREE.MathUtils.lerp(hips.y + 0.10 * s, chest.y + 0.10 * s, t), -0.145 * s));
  }

  /* ---- assemble ---- */
  const materials = makeCharacterMaterials({ key: opts.key ?? 'warden', ...opts.materials });

  const geo = mergeParts([
    body.skin,       // 0 skin
    body.suit,       // 1 under-layer
    armorParts,      // 2 armour
    leatherParts,    // 3 leather
    energyParts,     // 4 energy
  ]);

  const segs: SkinSegment[] = humanoidSegments(rig, p);
  autoSkin(geo, rig, segs);

  const mesh = new THREE.SkinnedMesh(geo, [
    materials.skin, materials.suit, materials.armor, materials.leather, materials.energy,
  ]);
  mesh.bind(rig.skeleton);
  mesh.normalizeSkinWeights();

  /* ---- cloak: its own skinned mesh so it can never drag the legs ---- */
  let cloakMesh: THREE.SkinnedMesh | null = null;
  if (opts.withCloak !== false) {
    const cloakGeo = buildCloak(chest.y, hips.y, s).toNonIndexed();
    const cl = ['cloak1', 'cloak2', 'cloak3', 'cloak4'];
    const cloakSegs: SkinSegment[] = [
      { bone: 'chest', a: chest.clone(), b: chest.clone().add(V(0, 0.16 * s, 0.10 * s)), radius: 0.26 * s, falloff: 1.4 },
    ];
    for (let i = 0; i < cl.length; i++) {
      const a = rig.worldOf(cl[i]).clone();
      const b = (i + 1 < cl.length ? rig.worldOf(cl[i + 1]).clone() : a.clone().add(V(0, -0.32 * s, 0.05 * s)));
      cloakSegs.push({ bone: cl[i], a, b, radius: 0.60 * s, falloff: 1.1 });
    }
    autoSkin(cloakGeo, rig, cloakSegs);
    cloakMesh = new THREE.SkinnedMesh(cloakGeo, materials.cloth);
    cloakMesh.bind(rig.skeleton);
    cloakMesh.normalizeSkinWeights();
    cloakMesh.castShadow = true;
    cloakMesh.receiveShadow = true;
    cloakMesh.frustumCulled = false;
  }

  const character = new Character(mesh, rig, { footIK: true, scale: s, castShadow: true });
  if (cloakMesh) character.group.add(cloakMesh);
  registerHumanoidAnims(character.anim, rig, { armed: opts.withSword !== false });
  character.anim.setState('idle');
  character.strideLength = 1.9 * s;

  /* ---- sword: a socketed mesh on the right hand, not a skinned part ---- */
  const handWorld = rig.worldOf('handR');
  const socket = new THREE.Group();
  socket.position.set(-0.012 * s, 0.0, 0.02 * s).add(rig.worldOf('gripR')).sub(handWorld);
  socket.rotation.set(-2.34, 0.10, 0.14);
  socket.scale.setScalar(s);
  rig.get('handR').add(socket);

  let sword: THREE.Mesh | null = null;
  if (opts.withSword !== false) {
    const sp = buildSword(1.05);
    const swordGeo = mergeParts([[...sp.steel, ...sp.metal], sp.leather, sp.energy]);
    sword = new THREE.Mesh(swordGeo, [materials.armor, materials.leather, materials.energy]);
    sword.castShadow = true;
    sword.frustumCulled = false;
    socket.add(sword);
  }

  // sockets for VFX (sword trail, impact spawn points)
  const swordBase = new THREE.Object3D();
  swordBase.position.set(0, 0.06, 0);
  socket.add(swordBase);
  const swordTip = new THREE.Object3D();
  swordTip.position.set(0, 1.02, 0);
  socket.add(swordTip);

  return { character, materials, swordTip, swordBase, sword };
}

export { AETHER, rigidSkin };
