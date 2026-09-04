import * as THREE from "three";
import type { CreatureType } from "./data/creatures";
import type { PowerId } from "./data/powers";

export interface LiveCreature {
  id: string;
  type: CreatureType;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  radius: number;
  yaw: number;
  usingPower: boolean;
  residue: number;
  dead: boolean;
  home: THREE.Vector3;
}

export interface LivePickup {
  id: string;
  item: string;
  pos: THREE.Vector3;
  taken: boolean;
}

export interface LiveBuilding {
  id: string;
  kind: "camp" | "totem" | "wall" | "bell";
  pos: THREE.Vector3;
  rot: number;
  powerId?: PowerId;
}

export const runtime = {
  player: new THREE.Vector3(0, 9, 22),
  yaw: 0.15,
  pitch: -0.18,
  vel: new THREE.Vector3(),
  onGround: true,
  gliding: false,
  stamina: 100,
  hp: 100,
  invuln: 0,
  attackCd: 0,
  surgeCd: [0, 0, 0] as number[],
  absorbHold: 0,
  steam: 0,
  basalt: 0,
  decoy: null as THREE.Vector3 | null,
  decoyLife: 0,
  doubleJump: true,
  weftHeld: null as PowerId | null,
  cam: new THREE.Vector3(0, 12, 30),
  look: new THREE.Vector3(),
  creatures: new Map<string, LiveCreature>(),
  pickups: [] as LivePickup[],
  buildings: [] as LiveBuilding[],
  residues: [] as { power: PowerId; pos: THREE.Vector3; life: number }[],
  walls: [] as { pos: THREE.Vector3; life: number }[],
  time: 0,
  timeOfDay: 0.28,
  dt: 0,
  locked: false,
  keys: new Set<string>(),
  mouse: { x: 0, y: 0 },
  attackPressed: false,
  prompt: "",
  uiOpen: false,
  touch: {
    active: false,
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
  },
};

export function resetRuntime() {
  runtime.player.set(0, 9, 22);
  runtime.yaw = 0.15;
  runtime.pitch = -0.18;
  runtime.vel.set(0, 0, 0);
  runtime.hp = 100;
  runtime.stamina = 100;
  runtime.creatures.clear();
  runtime.pickups = [];
  runtime.buildings = [];
  runtime.residues = [];
  runtime.walls = [];
}
