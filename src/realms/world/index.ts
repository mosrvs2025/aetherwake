/**
 * REALMS — world assembly.
 *
 * Builds the shelf in labelled stages so the loading screen can report real
 * progress and the heavy scatter work happens after the first frame is ready.
 */

import * as THREE from 'three';
import { Sky, CloudSea, CloudBanks } from './sky';
import { Terrain } from './terrain';
import { Water } from './water';
import { Waterfalls, defaultFalls } from './waterfalls';
import { buildWorldData, type WorldDataResult } from './worlddata';
import {
  StructureBuilder, makeStructureMaterials, buildAmberfell, buildColonnade,
  buildRiftspan, buildSkyfallKeep, buildWardensGate, buildShrine,
  buildFloatingIsland, buildRockScatter, buildWatchpost, buildWayside,
  type InteractPoint, type MatKey,
} from './structures';
import {
  buildVegetation, forestDensity, GrassField, grassClumpGeometry, makeFoliageMaterial,
  InstancedScatter, type ScatterInstance,
} from './vegetation';
import { Birds, SunMotes, Critters, type FlockSpec } from './wildlife';
import { Textures } from './textures';
import { SURFACES } from '../chars/materials';
import { applyAtmosphere, atmo } from '../core/atmosphere';
import {
  SEA_OF_CLOUD_Y, LAKE_Y, BRIDGE_X, BRIDGE_SOUTH_Z, BRIDGE_NORTH_Z, BRIDGE_Y,
  FLOATING_ISLANDS, LANDMARKS, CLIFF,
} from './atlas';
import { terrainHeight, terrainSlope } from './heightfield';
import type { Physics } from '../game/physics';
import { Random, clamp01, smoothstep } from '../core/math';

export interface BuildStage {
  label: string;
  run: () => void;
}

/**
 * How much world to draw.
 *
 * The quality presets used to change only the render scale, the shadow map
 * and the post chain — every preset still submitted the same 580 draws and
 * 4.6 million triangles. On a desktop GPU that is fine and resolution is the
 * lever that matters; on a phone the geometry *is* the frame time, and no
 * amount of rendering it smaller helps. These are the levers that actually
 * remove work: how far the forest draws, how much grass exists, and how
 * quickly the terrain drops to a coarser mesh.
 */
export interface SceneScale {
  /** Metres beyond which a tree bucket is not drawn at all. */
  treeDistance: number;
  /** Metres within which scatter buckets cast into the shadow map. */
  shadowRadius: number;
  /** Multiplier on the terrain's LOD band distances. */
  terrainLod: number;
  /** Grass ring: tiles of radius, and blades per tile. */
  grassTiles: number;
  grassPerTile: number;
  /** Far cutoff for ground cover, in metres. */
  grassFade: number;
  /** Fern ring radius in tiles. */
  fernTiles: number;
  /** Ambient dust motes. */
  motes: number;
}

export const SCENE_SCALE: Record<'low' | 'medium' | 'high' | 'ultra', SceneScale> = {
  // Tuned for a phone: the forest still closes the horizon because the fog
  // reaches it first, so the cut is invisible from the ground.
  low:    { treeDistance: 250, shadowRadius: 80,  terrainLod: 0.50, grassTiles: 4, grassPerTile: 300, grassFade: 30, fernTiles: 3, motes: 220 },
  medium: { treeDistance: 380, shadowRadius: 120, terrainLod: 0.75, grassTiles: 5, grassPerTile: 430, grassFade: 38, fernTiles: 4, motes: 420 },
  high:   { treeDistance: 560, shadowRadius: 165, terrainLod: 1.00, grassTiles: 6, grassPerTile: 520, grassFade: 46, fernTiles: 4, motes: 700 },
  ultra:  { treeDistance: 760, shadowRadius: 200, terrainLod: 1.25, grassTiles: 7, grassPerTile: 560, grassFade: 54, fernTiles: 5, motes: 900 },
};

/** Areas where nothing should be scattered (buildings, roads, arenas). */
const EXCLUSIONS: Array<[number, number, number]> = [
  [-140, 250, 58],     // Amberfell
  [-372, 336, 52],     // Colonnade
  [-60, -566, 96],     // Skyfall Keep
  [-60, -444, 34],     // Warden's Gate
  [-66, -170, 30],     // Riftspan corridor
  [74, 676, 30],       // Watcher's Cliff
];

export class World {
  group = new THREE.Group();
  sky!: Sky;
  cloudSea!: CloudSea;
  cloudBanks!: CloudBanks;
  cloudBanksLow!: CloudBanks;
  terrain!: Terrain;
  water!: Water;
  falls!: Waterfalls;
  data!: WorldDataResult;
  grass!: GrassField;
  flowers!: GrassField;
  birds!: Birds;
  motes!: SunMotes;
  critters!: Critters;
  points: InteractPoint[] = [];
  /** Where the roadside scenes landed — used by dev tooling to frame them. */
  wayside: Array<{ kind: string; x: number; y: number; z: number }> = [];
  /**
   * Set before `stages()` runs. Grass and fern rings are sized once at build
   * time because their instance buffers are allocated up front; draw distance
   * and terrain LOD are re-read every frame, so the governor can still move
   * those while the player is walking.
   */
  scale: SceneScale = SCENE_SCALE.high;
  islandTops: Array<{ x: number; y: number; z: number }> = [];
  treeCount = 0;
  private scatters: InstancedScatter[] = [];
  private debugNoGrass = false;
  private debugNoFlowers = false;
  private structureMats!: Record<MatKey, THREE.MeshStandardMaterial>;

  constructor(private physics: Physics) {}

  /** Whether a point is already occupied by a building or ruin footprint. */
  blockedAt(x: number, z: number) {
    for (const [ex, ez, er] of EXCLUSIONS) {
      if ((x - ex) ** 2 + (z - ez) ** 2 < er * er) return 1;
    }
    return 0;
  }

  stages(): BuildStage[] {
    return [
      {
        label: 'Charting the shelf',
        run: () => { this.data = buildWorldData(); },
      },
      {
        label: 'Raising the sky',
        run: () => {
          this.sky = new Sky();
          this.sky.mesh.scale.setScalar(14000);
          this.group.add(this.sky.mesh);
          this.cloudSea = new CloudSea(9000);
          this.group.add(this.cloudSea.mesh);
        },
      },
      {
        label: 'Carving the mountains',
        run: () => {
          this.terrain = new Terrain(this.data.texture);
          this.group.add(this.terrain.group);
        },
      },
      {
        label: 'Letting in the water',
        run: () => {
          this.water = new Water(this.data.heightTexture);
          this.group.add(this.water.group);
          this.falls = new Waterfalls(defaultFalls());
          this.group.add(this.falls.group);
        },
      },
      {
        label: 'Gathering the clouds',
        run: () => {
          this.cloudBanks = new CloudBanks(64, {
            yMin: SEA_OF_CLOUD_Y + 40, yMax: SEA_OF_CLOUD_Y + 210,
            spread: 2800, radius: [140, 460],
          });
          this.group.add(this.cloudBanks.mesh);
          // well above the highest walkable ground, so the player never ends
          // up standing inside one
          this.cloudBanksLow = new CloudBanks(30, {
            yMin: 430, yMax: 760, spread: 1900, radius: [110, 300],
          });
          this.group.add(this.cloudBanksLow.mesh);
        },
      },
      {
        label: 'Building Skyfall Keep',
        run: () => {
          this.structureMats = makeStructureMaterials();
          const b = new StructureBuilder(this.physics);
          buildSkyfallKeep(b, -60, -566);
          buildWardensGate(b, -60, -444);
          buildRiftspan(b, BRIDGE_X, BRIDGE_SOUTH_Z, BRIDGE_NORTH_Z, BRIDGE_Y);
          this.group.add(b.finish(this.structureMats, 'keep'));
          this.points.push(...b.points);
        },
      },
      {
        label: 'Founding Amberfell',
        run: () => {
          const b = new StructureBuilder(this.physics);
          buildAmberfell(b, -140, 250);
          buildColonnade(b, -372, 336);
          buildWatchpost(b, CLIFF.x, CLIFF.z);
          buildShrine(b, 'shrine_cliff', 52, 692, "The Watcher's Cliff");
          buildShrine(b, 'shrine_wood', 40, 402, 'Emberpine Shrine');
          buildShrine(b, 'shrine_lake', 132, 196, 'Mirrowmere Shrine');
          buildShrine(b, 'shrine_rift', BRIDGE_X + 14, BRIDGE_SOUTH_Z + 22, 'Riftward Shrine');
          buildShrine(b, 'shrine_march', -104, -330, 'Ashen Shrine');
          this.group.add(b.finish(this.structureMats, 'village'));
          this.points.push(...b.points);
        },
      },
      {
        label: 'Cutting the Skyshards loose',
        run: () => {
          const b = new StructureBuilder(null);
          for (let i = 0; i < FLOATING_ISLANDS.length; i++) {
            const isl = FLOATING_ISLANDS[i];
            const top = buildFloatingIsland(b, `isle${i}`, isl.x, isl.y, isl.z, isl.r, isl.h, {
              ruin: i < 3, physics: this.physics,
            });
            this.islandTops.push(top);
          }
          // the treasure that makes the climb worth it
          const main = this.islandTops[0];
          this.points.push({
            id: 'skyshard_relic', kind: 'loot',
            x: main.x, y: main.y + 1.4, z: main.z,
            data: { item: 'stormheart', rarity: 'relic' },
          });
          this.group.add(b.finish(this.structureMats, 'skyshards'));
          this.points.push(...b.points);
        },
      },
      {
        label: 'Planting Emberpine Wood',
        run: () => {
          const veg = buildVegetation({
            roadAt: (x, z) => this.data.roadAt(x, z),
            aoAt: (x, z) => this.data.aoAt(x, z),
            blocked: (x, z) => this.blockedAt(x, z),
          });
          this.group.add(veg.group);
          this.treeCount = veg.count;
          this.scatters.push(...veg.scatters);
          // trunks block movement, but only the big ones — brushing past saplings
          // should not feel like hitting a wall
          for (const sc of veg.scatters) {
            for (const mesh of sc.meshes) {
              const m = new THREE.Matrix4();
              const p = new THREE.Vector3();
              const s = new THREE.Vector3();
              const q = new THREE.Quaternion();
              for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, m);
                m.decompose(p, q, s);
                if (s.x < 1.02) continue;
                this.physics.addCylinder(p.x, p.z, 0.42 * s.x, p.y - 2, p.y + 12 * s.x, { walkable: false, solid: true });
              }
            }
          }
        },
      },
      {
        label: 'Scattering stone',
        run: () => {
          const { protos, lists } = buildRockScatter(950, (x, z) => {
            if (this.blockedAt(x, z) > 0.5) return 0;
            const h = terrainHeight(x, z);
            if (h < LAKE_Y - 6 || h > 250) return 0;
            const sl = terrainSlope(x, z);
            if (this.data.roadAt(x, z) > 0.3) return 0;
            // boulders gather at the foot of slopes and thin out with altitude
            return clamp01((0.09 + sl * 1.4) * (1 - smoothstep(170, 246, h)));
          });
          const rockMat = makeFoliageMaterial({
            color: '#7a7770', roughness: 0.95, key: 'rock', windAmp: 0,
            surface: SURFACES.rock,
          });
          const rng = new Random('rocktint');
          const grp = new THREE.Group();
          grp.name = 'rocks';
          for (let i = 0; i < protos.length; i++) {
            const list = lists[i];
            if (!list.length) continue;
            const inst: ScatterInstance[] = list.map((r) => ({
              x: r.x, y: r.y, z: r.z, scale: r.s, yaw: r.yaw, tilt: r.tilt,
              tint: new THREE.Color().setHSL(0.09, 0.06, rng.range(0.55, 0.95)),
            }));
            const sc = new InstancedScatter(protos[i], rockMat, inst, {
              bucket: 420, castShadow: true, receiveShadow: true, stiffness: 0,
            });
            grp.add(sc.group);
            this.scatters.push(sc);
            for (const r of list) {
              if (r.s < 2.2) continue;
              this.physics.addCylinder(r.x, r.z, r.s * 0.75, r.y - r.s, r.y + r.s * 0.7, { walkable: true, solid: true });
            }
          }
          this.group.add(grp);
        },
      },
      {
        label: 'Letting the grass in',
        run: () => {
          const grassMat = makeFoliageMaterial({
            color: '#ffffff', map: Textures.grass, alphaTest: 0.28, alphaOnly: true,
            vertexColors: true,
            side: THREE.DoubleSide, roughness: 0.9, key: 'grass', windAmp: 0.10,
            clumpFade: [2.6, this.scale.grassFade], normalUp: 0.88, translucency: 0.55,
          });
          const density = (x: number, z: number) => {
            const h = terrainHeight(x, z);
            if (h < LAKE_Y + 0.3 || h > 268) return 0;
            const sl = terrainSlope(x, z);
            if (sl > 0.48) return 0;
            if (this.blockedAt(x, z) > 0.5) return 0.12;
            const road = this.data.roadAt(x, z);
            const ashen = smoothstep(-120, -360, z);
            return clamp01((1 - road * 1.25) * (1 - smoothstep(0.26, 0.48, sl)) * (1 - smoothstep(214, 266, h)) * (1 - ashen * 0.7));
          };
          // Under a closed canopy the ground is needles and shade, not meadow —
          // and thinning it there is also where the instance budget is best spent.
          const vegDeps = {
            roadAt: (x: number, z: number) => this.data.roadAt(x, z),
            aoAt: (x: number, z: number) => this.data.aoAt(x, z),
            blocked: (x: number, z: number) => this.blockedAt(x, z),
          };
          const grassDensity = (x: number, z: number) =>
            density(x, z) * (1 - forestDensity(x, z, vegDeps) * 0.62);
          const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
          this.debugNoGrass = q.has('nograss');
          this.debugNoFlowers = q.has('noflowers');
          this.grass = new GrassField(grassClumpGeometry(0.52, 0.40), grassMat, {
            tileSize: 6, radiusTiles: this.scale.grassTiles, perTile: this.scale.grassPerTile,
            density: grassDensity,
            scale: [0.60, 1.15],
            colorA: new THREE.Color('#55723c'),
            colorB: new THREE.Color('#76883f'),
            colorDry: new THREE.Color('#9a8d55'),
          });
          if (!this.debugNoGrass) this.group.add(this.grass.mesh);

          const fernMat = makeFoliageMaterial({
            color: '#ffffff', map: Textures.leaf, alphaTest: 0.46,
            vertexColors: true,
            side: THREE.DoubleSide, roughness: 0.85, key: 'fern', windAmp: 0.055,
            clumpFade: [5.0, 58], normalUp: 0.80, translucency: 0.50,
          });
          this.flowers = new GrassField(grassClumpGeometry(0.80, 1.05), fernMat, {
            tileSize: 14, radiusTiles: this.scale.fernTiles, perTile: 34,
            density: (x, z) => density(x, z) * 0.5,
            scale: [0.5, 1.05],
            colorA: new THREE.Color('#425c2f'),
            colorB: new THREE.Color('#8a763c'),
            colorDry: new THREE.Color('#9d8b4a'),
          });
          if (!this.debugNoFlowers) this.group.add(this.flowers.mesh);
        },
      },
      {
        label: 'Leaving traces on the road',
        run: () => {
          const b = new StructureBuilder(this.physics);
          this.wayside = buildWayside(b, {
            heightAt: (x, z) => terrainHeight(x, z),
            slopeAt: (x, z) => terrainSlope(x, z),
            roadAt: (x, z) => this.data.roadAt(x, z),
            blocked: (x, z) => this.blockedAt(x, z),
          });
          this.group.add(b.finish(this.structureMats, 'wayside'));
        },
      },
      {
        label: 'Waking the valley',
        run: () => {
          // Thermals over the places the player will actually be looking:
          // the opening vista, the lake, the wood, and the air below the Keep.
          const flocks: FlockSpec[] = [
            { x: 90, z: 470, altitude: 96, radius: 74, count: 11, scale: 2.4, speed: 1 },
            { x: -120, z: 250, altitude: 62, radius: 46, count: 8, scale: 1.9, speed: -1 },
            { x: 210, z: 60, altitude: 118, radius: 96, count: 9, scale: 3.0, speed: 1 },
            { x: -80, z: -300, altitude: 150, radius: 120, count: 10, scale: 3.6, speed: -1 },
            { x: 40, z: 640, altitude: 34, radius: 26, count: 5, scale: 1.5, speed: 1 },
          ];
          this.birds = new Birds(flocks);
          this.group.add(this.birds.mesh);

          this.motes = new SunMotes(this.scale.motes, 46);
          this.group.add(this.motes.mesh);

          const critterMat = applyAtmosphere(new THREE.MeshStandardMaterial({
            color: '#9a8166', roughness: 0.95, metalness: 0,
          }), { key: 'critter' });
          this.critters = new Critters(critterMat, 10, 70);
          this.group.add(this.critters.mesh);
        },
      },
    ];
  }

  update(camera: THREE.Camera, playerX: number, playerZ: number) {
    // only the buckets the sun's frustum can reach need to cast
    for (const sc of this.scatters) {
      sc.updateVisibility(playerX, playerZ, this.scale.treeDistance, this.scale.shadowRadius);
    }
    if (this.terrain) this.terrain.lodScale = this.scale.terrainLod;
    if (this.sky) this.sky.mesh.position.copy(camera.position);
    if (this.cloudSea) {
      this.cloudSea.mesh.position.x = camera.position.x;
      this.cloudSea.mesh.position.z = camera.position.z;
    }
    if (this.terrain) this.terrain.update(camera);
    if (this.grass) this.grass.update(playerX, playerZ, 5);
    if (this.flowers) this.flowers.update(playerX, playerZ, 3);
    if (this.motes) this.motes.update(camera);
  }

  /** Anything that needs a real timestep rather than a camera position. */
  updateLife(dt: number, playerX: number, playerZ: number) {
    if (this.critters) this.critters.update(dt, playerX, playerZ);
  }

  landmarkAt(id: string) { return LANDMARKS.find((l) => l.id === id); }

  dispose() {
    this.terrain?.dispose();
    this.water?.dispose();
    this.falls?.dispose();
    this.grass?.dispose();
    this.flowers?.dispose();
    this.birds?.dispose();
    this.motes?.dispose();
    this.critters?.dispose();
    this.data?.texture.dispose();
    this.data?.heightTexture.dispose();
  }
}

export { atmo, applyAtmosphere };
