/**
 * REALMS — villagers, shrines, loot and everything else you can walk up to.
 *
 * A single Interactable registry drives the contextual prompt, the compass
 * markers and the quest events, so adding a new thing to the world is one
 * object literal rather than a new system.
 */

import * as THREE from 'three';
import { Rig, autoSkin } from '../chars/rig';
import {
  humanoidBones, humanoidBody, humanoidSegments, registerHumanoidAnims,
  mergeParts, type HumanoidProfile,
} from '../chars/humanoid';
import { Character } from '../chars/character';
import { makeCharacterMaterials, AETHER } from '../chars/materials';
import { tube, roundedBox, V } from '../chars/geom';
import { Textures } from '../world/textures';
import { applyAtmosphere } from '../core/atmosphere';
import { terrainHeight } from '../world/heightfield';
import { RARITY_COLOR, type LootRarity } from '../world/atlas';
import { clamp01 } from '../core/math';

/* ------------------------------------------------------------------ *
 * Villagers
 * ------------------------------------------------------------------ */

const VILLAGER: HumanoidProfile = {
  height: 1.74, shoulder: 0.215, hip: 0.125, bulk: 0.95,
  neck: 0.05, headScale: 1.0, armLength: 1.0, legLength: 1.0, hunch: 0.04,
};

export interface NpcLook {
  skin: string;
  robe: string;
  trim: string;
  hood: boolean;
  hair: string | null;
}

export function buildVillager(look: NpcLook) {
  const p = VILLAGER;
  const s = p.height / 1.86;
  const rig = new Rig(humanoidBones(p));
  const w = (n: string) => rig.worldOf(n).clone();
  const body = humanoidBody(rig, p);
  const chest = w('chest'), hips = w('hips'), neck = w('neck'), head = w('head');

  const robe: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];

  // a simple robe over the torso, flaring to the knees
  robe.push(tube(
    [
      V(0, hips.y - 0.44 * s, 0.01 * s),
      V(0, hips.y - 0.10 * s, 0.005 * s),
      V(0, (hips.y + chest.y) / 2, chest.z),
      V(0, chest.y + 0.02 * s, chest.z),
      V(0, neck.y - 0.04 * s, 0),
    ],
    [0.235 * s, 0.190 * s, 0.168 * s, 0.176 * s, 0.112 * s],
    { radial: 14, squashX: [1.0, 1.10, 1.20, 1.28, 0.96], squashZ: [1.0, 0.92, 0.84, 0.84, 0.9], capStart: false, capEnd: false },
  ));
  // sleeves
  for (const side of [1, -1] as const) {
    const sh = w('upperArmL').clone(); sh.x *= side;
    const el = w('lowerArmL').clone(); el.x *= side;
    robe.push(tube([sh.clone().add(V(0, 0.03 * s, 0)), el.clone().lerp(sh, 0.15)], [0.088 * s, 0.072 * s], { radial: 9 }));
  }
  trim.push(tube(
    [V(0, hips.y + 0.02 * s, 0), V(0, hips.y + 0.02 * s, 0)],
    [0.001, 0.001], { radial: 3 },
  ));
  // belt
  {
    const path: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      path.push(V(Math.cos(a) * 0.165 * s * 1.2, hips.y + 0.03 * s, Math.sin(a) * 0.165 * s * 0.86));
      radii.push(0.022 * s);
    }
    trim.push(tube(path, radii, { radial: 5, capStart: false, capEnd: false }));
  }
  if (look.hood) {
    const hood = new THREE.SphereGeometry(0.155 * s, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72);
    hood.scale(1.0, 1.15, 1.10);
    hood.translate(head.x, head.y + 0.055 * s, head.z - 0.012 * s);
    robe.push(hood);
    trim.push(roundedBox(0.30 * s, 0.04 * s, 0.26 * s, 0.3, 1).translate(0, neck.y + 0.02 * s, head.z));
  }

  const hair: THREE.BufferGeometry[] = [];
  if (look.hair) {
    const cap = new THREE.SphereGeometry(0.126 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    cap.scale(1.0, 1.12, 1.06);
    cap.translate(head.x, head.y + 0.088 * s, head.z - 0.004 * s);
    hair.push(cap);
  }

  const materials = makeCharacterMaterials({
    key: `npc-${look.robe}`,
    skin: look.skin,
    suit: look.robe,
    armor: look.hair ?? look.trim,
    cloth: look.robe,
    leather: look.trim,
    energy: AETHER.clone(),
    energyPower: 1.4,
    metalness: 0.02,
    roughness: 0.88,
  });

  const geo = mergeParts([body.skin, [...body.suit, ...robe], hair, trim, []]);
  autoSkin(geo, rig, humanoidSegments(rig, p));
  const mesh = new THREE.SkinnedMesh(geo, [
    materials.skin, materials.suit, materials.armor, materials.leather, materials.energy,
  ]);
  mesh.bind(rig.skeleton);
  mesh.normalizeSkinWeights();

  const character = new Character(mesh, rig, { footIK: false, scale: s, castShadow: true });
  registerHumanoidAnims(character.anim, rig, { armed: false });
  character.anim.setState('idle');
  character.strideLength = 1.7 * s;
  return { character, materials };
}

/* ------------------------------------------------------------------ *
 * NPC entity
 * ------------------------------------------------------------------ */

export interface NpcDialogue {
  id: string;
  lines: Array<{ speaker: string; text: string }>;
  /** Quest event fired when the conversation ends. */
  onEnd?: string;
}

export class Npc {
  group: THREE.Group;
  character: Character;
  name: string;
  id: string;
  pos = new THREE.Vector3();
  yaw = 0;
  dialogues: NpcDialogue[];
  dialogueIndex = 0;
  private t = Math.random() * 10;

  constructor(id: string, name: string, look: NpcLook, x: number, z: number, yaw: number, dialogues: NpcDialogue[]) {
    this.id = id;
    this.name = name;
    const built = buildVillager(look);
    this.character = built.character;
    this.group = built.character.group;
    this.pos.set(x, terrainHeight(x, z), z);
    this.group.position.copy(this.pos);
    this.yaw = yaw;
    this.group.rotation.y = yaw;
    this.dialogues = dialogues;
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.t += dt;
    const d = this.pos.distanceTo(playerPos);
    if (d < 40) {
      this.character.lookTarget = d < 9 ? playerPos : null;
      this.character.lookWeight = d < 9 ? 0.9 : 0;
      this.character.update(dt, { speed01: 0 });
    }
  }

  currentDialogue() {
    return this.dialogues[Math.min(this.dialogueIndex, this.dialogues.length - 1)];
  }

  dispose() { this.character.dispose(); }
}

/* ------------------------------------------------------------------ *
 * Interactables
 * ------------------------------------------------------------------ */

export type InteractKind = 'npc' | 'shrine' | 'loot' | 'door' | 'lore';

export interface Interactable {
  id: string;
  kind: InteractKind;
  x: number; y: number; z: number;
  radius: number;
  prompt: string;
  label?: string;
  used?: boolean;
  once?: boolean;
  data?: Record<string, unknown>;
  object?: THREE.Object3D;
}

/* ------------------------------------------------------------------ *
 * Loot pickups
 * ------------------------------------------------------------------ */

export class LootPickup {
  group = new THREE.Group();
  private core: THREE.Mesh;
  private halo: THREE.Sprite;
  private t = Math.random() * 6;
  taken = false;

  constructor(x: number, y: number, z: number, rarity: LootRarity) {
    const color = new THREE.Color(RARITY_COLOR[rarity]);
    const mat = new THREE.MeshStandardMaterial({
      color: '#0a0d12',
      emissive: color,
      emissiveIntensity: 2.6,
      roughness: 0.25,
      metalness: 0.4,
    });
    applyAtmosphere(mat, { key: 'loot-' + rarity });
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), mat);
    this.core.castShadow = false;
    this.group.add(this.core);

    const cage = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.018, 6, 20),
      new THREE.MeshStandardMaterial({ color: '#25282f', roughness: 0.4, metalness: 0.8 }),
    );
    cage.rotation.x = Math.PI / 2;
    this.group.add(cage);

    const spriteMat = new THREE.SpriteMaterial({
      map: Textures.glow, color, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.halo = new THREE.Sprite(spriteMat);
    this.halo.scale.setScalar(2.4);
    this.group.add(this.halo);

    this.group.position.set(x, y, z);
  }

  update(dt: number) {
    this.t += dt;
    this.core.rotation.y += dt * 1.1;
    this.core.rotation.x += dt * 0.5;
    this.group.children[0].position.y = Math.sin(this.t * 1.6) * 0.14;
    this.group.children[1].rotation.z += dt * 0.6;
    this.halo.material.opacity = 0.45 + Math.sin(this.t * 2.3) * 0.12;
  }

  dispose() {
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Shrine flames — the visual for a checkpoint you have lit
 * ------------------------------------------------------------------ */

export class ShrineLight {
  group = new THREE.Group();
  light: THREE.PointLight;
  lit = false;
  private t = Math.random() * 5;

  constructor(x: number, y: number, z: number) {
    this.light = new THREE.PointLight(new THREE.Color(AETHER), 0, 22, 2);
    this.light.position.set(x, y + 1.9, z);
    this.group.add(this.light);
    this.group.position.set(0, 0, 0);
  }

  update(dt: number) {
    this.t += dt;
    const target = this.lit ? 9 + Math.sin(this.t * 5.1) * 1.6 + Math.sin(this.t * 11.3) * 0.8 : 0;
    this.light.intensity += (target - this.light.intensity) * clamp01(dt * 6);
  }
}
