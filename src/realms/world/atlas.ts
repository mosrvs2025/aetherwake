/**
 * REALMS — the atlas.
 *
 * A single authored description of the vertical slice. The terrain height
 * function, the prop scatterers, the quest system, the minimap and the AI
 * spawner all read from here, so moving a landmark moves everything that
 * belongs to it.
 *
 * Convention: +X is east, -Z is north, +Y is up. The playable land is a
 * sky-continent — "the Sundered Shelf" — whose edges fall away into a cloud
 * sea, so the world has no invisible walls, only cliffs.
 */

export const SEA_OF_CLOUD_Y = -140;   // top of the cloud deck under the shelf
export const VOID_Y = -260;           // below this, you have fallen off the world
export const LAKE_Y = 26;             // Mirrowmere water plane

/** Radius at which the shelf begins to break away, and where it is gone. */
export const SHELF_INNER = 690;
export const SHELF_OUTER = 880;

export interface Region {
  id: string;
  name: string;
  x: number; z: number;
  radius: number;
}

export interface Landmark {
  id: string;
  name: string;
  subtitle: string;
  x: number; z: number;
  /** Radius at which the "discovered" banner fires. */
  discoverRadius: number;
  /** Shown on the compass before discovery? */
  beacon?: boolean;
  icon: 'keep' | 'ruin' | 'village' | 'shrine' | 'water' | 'island' | 'cliff' | 'cave' | 'bridge';
  xp: number;
}

export interface FlatPad {
  x: number; z: number;
  radius: number;   // fully flat inside
  falloff: number;  // blend distance outside
  y: number;        // target elevation
  /** 0..1 — how strongly to force `y` (1 = perfectly flat plateau). */
  strength?: number;
}

/* ------------------------------------------------------------------ *
 * Named places
 * ------------------------------------------------------------------ */

export const START_POS = { x: 74, z: 686 };

export const LANDMARKS: Landmark[] = [
  {
    id: 'watchers_cliff', name: "The Watcher's Cliff", subtitle: 'Where the road begins',
    x: 74, z: 672, discoverRadius: 40, icon: 'cliff', xp: 0,
  },
  {
    id: 'skyfall_keep', name: 'SKYFALL KEEP', subtitle: 'Built into the mountain that never stops falling',
    x: -60, z: -560, discoverRadius: 150, beacon: true, icon: 'keep', xp: 400,
  },
  {
    id: 'amberfell', name: 'Amberfell', subtitle: 'The last village on the shelf',
    x: -140, z: 250, discoverRadius: 78, beacon: true, icon: 'village', xp: 120,
  },
  {
    id: 'mirrowmere', name: 'Mirrowmere', subtitle: 'A lake that remembers the sky',
    x: 190, z: 150, discoverRadius: 110, icon: 'water', xp: 90,
  },
  {
    id: 'colonnade', name: 'The Sunken Colonnade', subtitle: 'Older than the Keep. Older than the fall.',
    x: -372, z: 336, discoverRadius: 82, icon: 'ruin', xp: 140,
  },
  {
    id: 'greatfall', name: 'The Great Fall', subtitle: 'The river leaves the world here',
    x: -600, z: 96, discoverRadius: 105, icon: 'water', xp: 120,
  },
  {
    id: 'riftbridge', name: 'The Riftspan', subtitle: 'One arch. A very long drop.',
    x: -66, z: -108, discoverRadius: 46, icon: 'bridge', xp: 110,
  },
  {
    id: 'skyshards', name: 'The Skyshards', subtitle: 'Stones that refused to fall',
    x: 336, z: -186, discoverRadius: 110, icon: 'island', xp: 220,
  },
  {
    id: 'emberpine', name: 'Emberpine Wood', subtitle: 'The trees here burn slowly, all year',
    x: 30, z: 400, discoverRadius: 100, icon: 'shrine', xp: 80,
  },
  {
    id: 'wardens_gate', name: "The Warden's Gate", subtitle: 'Something is awake behind it',
    x: -60, z: -430, discoverRadius: 70, icon: 'shrine', xp: 150,
  },
];

export const REGIONS: Region[] = [
  { id: 'south_downs', name: 'The Sunward Downs', x: 60, z: 520, radius: 320 },
  { id: 'emberpine', name: 'Emberpine Wood', x: 30, z: 380, radius: 300 },
  { id: 'amberfell', name: 'Amberfell', x: -140, z: 250, radius: 150 },
  { id: 'mirrowmere', name: 'Mirrowmere', x: 190, z: 150, radius: 220 },
  { id: 'colonnade', name: 'The Sunken Colonnade', x: -372, z: 336, radius: 170 },
  { id: 'greatfall', name: 'The Great Fall', x: -600, z: 96, radius: 190 },
  { id: 'rift', name: 'The Rift', x: -30, z: -170, radius: 260 },
  { id: 'skyshards', name: 'The Skyshards', x: 336, z: -186, radius: 220 },
  { id: 'ashen_march', name: 'The Ashen March', x: -120, z: -330, radius: 260 },
  { id: 'keep', name: 'Skyfall Keep', x: -60, z: -560, radius: 300 },
];

/* ------------------------------------------------------------------ *
 * Terrain shaping data
 * ------------------------------------------------------------------ */

/** The river: from the north mountains, into Mirrowmere, out to the west edge. */
export const RIVER_UPPER: Array<[number, number]> = [
  [140, -300], [150, -215], [186, -120], [214, -30], [206, 46], [192, 104],
];
export const RIVER_LOWER: Array<[number, number]> = [
  [120, 208], [40, 236], [-70, 226], [-190, 190], [-320, 150], [-440, 122], [-560, 104], [-660, 92],
];

/** Flattened building sites, keyed to landmarks above. */
export const PADS: FlatPad[] = [
  { x: -140, z: 250, radius: 66, falloff: 95, y: 58 },                  // Amberfell
  { x: -372, z: 336, radius: 62, falloff: 90, y: 74 },                  // Colonnade
  { x: -60, z: -430, radius: 46, falloff: 78, y: 170 },                 // Warden's Gate
  { x: -60, z: -560, radius: 104, falloff: 168, y: 252, strength: 0.94 },// Keep courtyard
  { x: -66, z: -106, radius: 20, falloff: 26, y: 100 },                 // bridge south head
  { x: -66, z: -242, radius: 20, falloff: 26, y: 100 },                 // bridge north head
];

/**
 * The Watcher's Cliff: a promontory, not a dome. The plateau is generous to the
 * south and east and breaks away almost immediately to the north, so the very
 * first thing you see when control is handed over is the drop and the valley
 * beyond it.
 */
export const CLIFF = { x: 74, z: 678, y: 212, radius: 30, southFalloff: 78 };

/** The Rift — a canyon that splits the shelf, crossable only at the Riftspan. */
export function riftCenterZ(x: number) {
  return -170 + Math.sin(x * 0.0052) * 46 + Math.sin(x * 0.0131 + 1.7) * 16;
}
export const RIFT_HALF_WIDTH = 34;
export const RIFT_LIP = 34;
export const BRIDGE_X = -66;
/** World-space Z of the two bridge abutments. */
export const BRIDGE_SOUTH_Z = -106;
export const BRIDGE_NORTH_Z = -242;
export const BRIDGE_Y = 100;

/** Floating islands: x, y, z, radius, height. */
export const FLOATING_ISLANDS: Array<{ x: number; y: number; z: number; r: number; h: number; spin: number }> = [
  { x: 300, y: 176, z: -140, r: 46, h: 34, spin: 0.05 },
  { x: 372, y: 214, z: -204, r: 33, h: 26, spin: -0.07 },
  { x: 250, y: 148, z: -216, r: 26, h: 20, spin: 0.09 },
  { x: 404, y: 250, z: -132, r: 22, h: 18, spin: 0.06 },
  { x: 336, y: 268, z: -258, r: 17, h: 14, spin: -0.11 },
  { x: 196, y: 132, z: -122, r: 14, h: 12, spin: 0.13 },
];

/** Distant, unreachable backdrop continents — pure silhouette and depth. */
export const BACKDROP_ISLES: Array<{ x: number; y: number; z: number; s: number; r: number }> = [
  { x: -2100, y: -30, z: -2600, s: 1.0, r: 0.2 },
  { x: 1800, y: 60, z: -3000, s: 1.35, r: 1.1 },
  { x: 2600, y: -90, z: -600, s: 0.8, r: 2.3 },
  { x: -3000, y: 40, z: 400, s: 1.1, r: 4.0 },
  { x: 400, y: -120, z: 3000, s: 0.9, r: 5.2 },
  { x: -1500, y: 120, z: -4200, s: 1.8, r: 0.7 },
];

export type LootRarity = 'common' | 'fine' | 'rare' | 'relic';

export interface ItemDef {
  id: string;
  name: string;
  rarity: LootRarity;
  kind: 'weapon' | 'trinket' | 'consumable' | 'key' | 'fragment';
  desc: string;
  stat?: string;
}

export const RARITY_COLOR: Record<LootRarity, string> = {
  common: '#b9c3cf',
  fine: '#78d59b',
  rare: '#63b0ff',
  relic: '#ffb454',
};
