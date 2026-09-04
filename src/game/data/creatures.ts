export type CreatureType =
  | "stormkite"
  | "basalt"
  | "embermaw"
  | "sporestag"
  | "tidewight"
  | "rootwraith"
  | "glassmoth"
  | "nightbloom"
  | "lodestone"
  | "skybreaker";

export interface CreatureDef {
  type: CreatureType;
  name: string;
  power: string;
  hp: number;
  speed: number;
  radius: number;
  damage: number;
  aggressive: boolean;
  fly: boolean;
  peacefulAbsorb?: boolean;
  color: [number, number, number];
}

export const CREATURES: Record<CreatureType, CreatureDef> = {
  stormkite: {
    type: "stormkite",
    name: "Stormkite",
    power: "gale_feather",
    hp: 42,
    speed: 7.5,
    radius: 1.1,
    damage: 8,
    aggressive: false,
    fly: true,
    color: [0.85, 0.92, 1],
  },
  basalt: {
    type: "basalt",
    name: "Basalt Sentinel",
    power: "basalt_hide",
    hp: 90,
    speed: 2.1,
    radius: 1.4,
    damage: 16,
    aggressive: true,
    fly: false,
    color: [0.4, 0.38, 0.36],
  },
  embermaw: {
    type: "embermaw",
    name: "Embermaw",
    power: "ember_tongue",
    hp: 55,
    speed: 4.2,
    radius: 1.05,
    damage: 12,
    aggressive: true,
    fly: false,
    color: [0.7, 0.22, 0.08],
  },
  sporestag: {
    type: "sporestag",
    name: "Sporecap Stag",
    power: "spore_sight",
    hp: 60,
    speed: 5.4,
    radius: 1.15,
    damage: 10,
    aggressive: false,
    fly: false,
    color: [0.45, 0.2, 0.55],
  },
  tidewight: {
    type: "tidewight",
    name: "Tidewight",
    power: "tide_step",
    hp: 48,
    speed: 3.6,
    radius: 0.9,
    damage: 9,
    aggressive: false,
    fly: false,
    color: [0.25, 0.7, 0.72],
  },
  rootwraith: {
    type: "rootwraith",
    name: "Rootwraith",
    power: "root_bind",
    hp: 70,
    speed: 3.2,
    radius: 1.2,
    damage: 11,
    aggressive: true,
    fly: false,
    color: [0.22, 0.38, 0.16],
  },
  glassmoth: {
    type: "glassmoth",
    name: "Glasswing Moth",
    power: "glass_echo",
    hp: 28,
    speed: 4.8,
    radius: 0.7,
    damage: 6,
    aggressive: false,
    fly: true,
    peacefulAbsorb: true,
    color: [0.92, 0.82, 1],
  },
  nightbloom: {
    type: "nightbloom",
    name: "Nightbloom",
    power: "night_veil",
    hp: 20,
    speed: 0,
    radius: 0.8,
    damage: 0,
    aggressive: false,
    fly: false,
    peacefulAbsorb: true,
    color: [0.35, 0.3, 0.7],
  },
  lodestone: {
    type: "lodestone",
    name: "Lodestone Titan",
    power: "lodestone_blood",
    hp: 180,
    speed: 2.4,
    radius: 2.4,
    damage: 22,
    aggressive: true,
    fly: false,
    color: [0.45, 0.5, 0.58],
  },
  skybreaker: {
    type: "skybreaker",
    name: "Skybreaker",
    power: "skybreaker_heart",
    hp: 320,
    speed: 6.2,
    radius: 3.4,
    damage: 24,
    aggressive: true,
    fly: true,
    color: [0.95, 0.85, 0.45],
  },
};

export interface Spawn {
  id: string;
  type: CreatureType;
  x: number;
  z: number;
  rare?: boolean;
}

export const SPAWNS: Spawn[] = [
  { id: "kite-1", type: "stormkite", x: 18, z: -72 },
  { id: "kite-2", type: "stormkite", x: -8, z: -96 },
  { id: "kite-3", type: "stormkite", x: 48, z: -88 },
  { id: "kite-4", type: "stormkite", x: 28, z: -118, rare: true },
  { id: "sentinel-1", type: "basalt", x: -12, z: -58 },
  { id: "sentinel-2", type: "basalt", x: 22, z: -64 },
  { id: "sentinel-3", type: "basalt", x: 36, z: -78 },
  { id: "ember-1", type: "embermaw", x: 78, z: 8 },
  { id: "ember-2", type: "embermaw", x: 96, z: -12 },
  { id: "ember-3", type: "embermaw", x: 70, z: 28 },
  { id: "ember-4", type: "embermaw", x: 110, z: 16 },
  { id: "stag-1", type: "sporestag", x: 12, z: 88 },
  { id: "stag-2", type: "sporestag", x: -20, z: 102 },
  { id: "stag-3", type: "sporestag", x: 36, z: 96 },
  { id: "stag-4", type: "sporestag", x: 28, z: 118, rare: true },
  { id: "tide-1", type: "tidewight", x: -88, z: 8 },
  { id: "tide-2", type: "tidewight", x: -102, z: -16 },
  { id: "tide-3", type: "tidewight", x: -78, z: -28 },
  { id: "root-1", type: "rootwraith", x: -28, z: 48 },
  { id: "root-2", type: "rootwraith", x: 8, z: 56 },
  { id: "root-3", type: "rootwraith", x: -10, z: 38 },
  { id: "moth-1", type: "glassmoth", x: -16, z: 8 },
  { id: "moth-2", type: "glassmoth", x: -52, z: 12 },
  { id: "bloom-1", type: "nightbloom", x: -40, z: 22 },
  { id: "bloom-2", type: "nightbloom", x: 8, z: -12 },
  { id: "titan-1", type: "lodestone", x: 8, z: -108 },
  { id: "boss", type: "skybreaker", x: 108, z: -122 },
];
