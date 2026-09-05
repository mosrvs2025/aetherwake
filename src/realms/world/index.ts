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
  buildFloatingIsland, buildRockScatter, type InteractPoint, type MatKey,
} from './structures';
import {
  buildVegetation, GrassField, grassClumpGeometry, makeFoliageMaterial,
  InstancedScatter, type ScatterInstance,
} from './vegetation';
import { Textures } from './textures';
import { applyAtmosphere, atmo } from '../core/atmosphere';
import {
  SEA_OF_CLOUD_Y, LAKE_Y, BRIDGE_X, BRIDGE_SOUTH_Z, BRIDGE_NORTH_Z, BRIDGE_Y,
  FLOATING_ISLANDS, LANDMARKS,
} from './atlas';
import { terrainHeight, terrainSlope } from './heightfield';
import type { Physics } from '../game/physics';
import { Random, clamp01, smoothstep } from '../core/math';

export interface BuildStage {
  label: string;
  run: () => void;
}

/** Areas where nothing should be scattered (buildings, roads, arenas). */
const EXCLUSIONS: Array<[number, number, number]> = [
  [-140, 250, 58],     // Amberfell
  [-372, 336, 52],     // Colonnade
  [-60, -560, 96],     // Skyfall Keep
  [-60, -430, 34],     // Warden's Gate
  [-66, -170, 30],     // Riftspan corridor
  [74, 654, 22],       // Watcher's Cliff
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
  points: InteractPoint[] = [];
  islandTops: Array<{ x: number; y: number; z: number }> = [];
  treeCount = 0;
  private debugNoGrass = false;
  private debugNoFlowers = false;
  private structureMats!: Record<MatKey, THREE.MeshStandardMaterial>;

  constructor(private physics: Physics) {}

  private blockedAt(x: number, z: number) {
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
          buildSkyfallKeep(b, -60, -560);
          buildWardensGate(b, -60, -430);
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
          buildShrine(b, 'shrine_cliff', 62, 671, "The Watcher's Cliff");
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
          const { protos, lists } = buildRockScatter(1500, (x, z) => {
            if (this.blockedAt(x, z) > 0.5) return 0;
            const h = terrainHeight(x, z);
            if (h < LAKE_Y - 6 || h > 250) return 0;
            const sl = terrainSlope(x, z);
            if (this.data.roadAt(x, z) > 0.3) return 0;
            // boulders gather at the foot of slopes and thin out with altitude
            return clamp01((0.09 + sl * 1.4) * (1 - smoothstep(170, 246, h)));
          });
          const rockMat = makeFoliageMaterial({ color: '#7a7770', roughness: 0.95, key: 'rock', windAmp: 0 });
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
              bucket: 190, castShadow: true, receiveShadow: true, stiffness: 0,
            });
            grp.add(sc.group);
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
            color: '#ffffff', map: Textures.grass, alphaTest: 0.34,
            side: THREE.DoubleSide, roughness: 0.9, key: 'grass', windAmp: 0.10,
            clumpFade: [3.2, 66],
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
          const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
          this.debugNoGrass = q.has('nograss');
          this.debugNoFlowers = q.has('noflowers');
          this.grass = new GrassField(grassClumpGeometry(1.0), grassMat, {
            tileSize: 9, radiusTiles: 7, perTile: 150,
            density,
            scale: [0.55, 1.35],
            colorA: new THREE.Color('#6d8a44'),
            colorB: new THREE.Color('#9aa451'),
          });
          if (!this.debugNoGrass) this.group.add(this.grass.mesh);

          const fernMat = makeFoliageMaterial({
            color: '#ffffff', map: Textures.leaf, alphaTest: 0.4,
            side: THREE.DoubleSide, roughness: 0.85, key: 'fern', windAmp: 0.055,
            clumpFade: [5.0, 58],
          });
          this.flowers = new GrassField(grassClumpGeometry(0.8), fernMat, {
            tileSize: 14, radiusTiles: 4, perTile: 26,
            density: (x, z) => density(x, z) * 0.55,
            scale: [0.8, 2.1],
            colorA: new THREE.Color('#4f6a37'),
            colorB: new THREE.Color('#8f7a3e'),
          });
          if (!this.debugNoFlowers) this.group.add(this.flowers.mesh);
        },
      },
    ];
  }

  update(camera: THREE.Camera, playerX: number, playerZ: number) {
    if (this.sky) this.sky.mesh.position.copy(camera.position);
    if (this.cloudSea) {
      this.cloudSea.mesh.position.x = camera.position.x;
      this.cloudSea.mesh.position.z = camera.position.z;
    }
    if (this.terrain) this.terrain.update(camera);
    if (this.grass) this.grass.update(playerX, playerZ, 5);
    if (this.flowers) this.flowers.update(playerX, playerZ, 3);
  }

  landmarkAt(id: string) { return LANDMARKS.find((l) => l.id === id); }

  dispose() {
    this.terrain?.dispose();
    this.water?.dispose();
    this.falls?.dispose();
    this.grass?.dispose();
    this.flowers?.dispose();
    this.data?.texture.dispose();
    this.data?.heightTexture.dispose();
  }
}

export { atmo, applyAtmosphere };
