/**
 * REALMS — the game.
 *
 * Owns the run: staged world build, the opening cinematic, the frame loop that
 * drives player / companion / combat / world, discovery and quest progression,
 * the interaction system, abilities, ambience, and everything the HUD reads.
 */

import * as THREE from 'three';
import { Engine } from './engine';
import { World } from '../world';
import { Physics } from './physics';
import { Player } from './player';
import { FollowCamera } from './camera';
import { Companion } from './companion';
import { Combat, ENEMY_DEFS, type Enemy } from './combat';
import { Fx, C_AETHER } from './fx';
import { QuestLog } from './quests';
import { Npc, LootPickup, ShrineLight, type Interactable, type NpcLook } from './entities';
import { realms } from './state';
import { audio } from '../core/audio';
import { atmo } from '../core/atmosphere';
import {
  LANDMARKS, REGIONS, START_POS, LAKE_Y, RARITY_COLOR,
  type LootRarity,
} from '../world/atlas';
import { terrainHeight, riverDistance } from '../world/heightfield';
import { clamp01, damp, lerp, smoothstep, Random } from '../core/math';
import { AETHER } from '../chars/materials';

interface ItemDef { id: string; name: string; rarity: LootRarity; kind: string; desc: string }

const ITEMS: Record<string, ItemDef> = {
  sealstone: { id: 'sealstone', name: 'Sealstone', rarity: 'rare', kind: 'key', desc: 'One third of the lock on the Warden’s Gate. It is warm, and it is humming.' },
  emberfruit: { id: 'emberfruit', name: 'Emberfruit', rarity: 'common', kind: 'consumable', desc: 'Grows only where the pines burn slowly. Restores health.' },
  stormheart: { id: 'stormheart', name: 'Stormheart', rarity: 'relic', kind: 'trinket', desc: 'Cut from a stone that refused to fall. Aether returns to you faster.' },
  sunstone: { id: 'sunstone', name: 'Sunstone', rarity: 'rare', kind: 'trinket', desc: 'The Colonnade was built to hold this. Your strikes cut deeper.' },
  wardens_sigil: { id: 'wardens_sigil', name: "Warden's Sigil", rarity: 'relic', kind: 'trinket', desc: 'Taken from the thing that wore his armour.' },
  ember_charm: { id: 'ember_charm', name: 'Ember Charm', rarity: 'fine', kind: 'trinket', desc: 'Warm to the touch. Steadies the breath.' },
};

const ABILITIES = [
  { id: 'surge', name: 'Aether Surge', key: '1', cost: 30, cooldownMax: 5.5 },
  { id: 'riftstep', name: 'Riftstep', key: '2', cost: 22, cooldownMax: 3.6 },
  { id: 'fury', name: "Ashfang's Fury", key: '3', cost: 35, cooldownMax: 11 },
];

const NPC_LOOKS: Record<string, NpcLook> = {
  elder: { skin: '#9c7657', robe: '#4a3f5c', trim: '#c8a04c', hood: true, hair: null },
  smith: { skin: '#7d5a3e', robe: '#3f3630', trim: '#7a4a2a', hood: false, hair: '#2a2320' },
  scout: { skin: '#a8815d', robe: '#3d4a37', trim: '#5c4a30', hood: true, hair: null },
};

const NPC_DATA: Record<string, { name: string; dialogues: Array<{ id: string; lines: Array<{ speaker: string; text: string }> }> }> = {
  elder: {
    name: 'Elder Maren',
    dialogues: [
      {
        id: 'first',
        lines: [
          { speaker: 'Elder Maren', text: 'You came up the cliff road. Nobody comes up the cliff road.' },
          { speaker: 'Elder Maren', text: 'Nine years since the Keep answered a beacon. Nine years the husks have been walking down out of Emberpine.' },
          { speaker: 'Elder Maren', text: 'If you are going north — and you have the look of someone going north — thin them out first. For us.' },
        ],
      },
      {
        id: 'progress',
        lines: [
          { speaker: 'Elder Maren', text: 'Still standing. Good.' },
          { speaker: 'Elder Maren', text: 'The Gate below the Keep is sealed with three sealstones. They scattered when the shelf broke.' },
        ],
      },
      {
        id: 'thanks',
        lines: [
          { speaker: 'Elder Maren', text: 'The wood is quiet tonight. First time in a season.' },
          { speaker: 'Elder Maren', text: 'Take this. It is not much, but it will keep your feet under you.' },
        ],
      },
    ],
  },
  smith: {
    name: 'Corvan the Smith',
    dialogues: [
      {
        id: 'first',
        lines: [
          { speaker: 'Corvan', text: 'That is Keep steel on your back. Blue in the seams and everything.' },
          { speaker: 'Corvan', text: 'I could not reforge that if you gave me a year and a mountain.' },
          { speaker: 'Corvan', text: 'Whatever is up there — hit it where the light shows through.' },
        ],
      },
    ],
  },
  scout: {
    name: 'Ysolde',
    dialogues: [
      {
        id: 'first',
        lines: [
          { speaker: 'Ysolde', text: 'You see the stones? East, over the rift. They should have fallen with everything else.' },
          { speaker: 'Ysolde', text: 'They did not. There is something up there, and it is worth the climb.' },
          { speaker: 'Ysolde', text: 'Mind the Riftspan. One arch, and a very long way down.' },
        ],
      },
    ],
  },
};

const LORE: Record<string, { title: string; text: string }> = {
  colonnade: {
    title: 'The Sunken Colonnade',
    text: 'They raised these columns to hold the sky up. The sky went anyway, and took the ground with it.',
  },
  riftspan: {
    title: 'The Riftspan',
    text: 'Built in a single night, the story says, by masons who were never seen again. It has not moved since.',
  },
};

export class Game {
  engine: Engine;
  world: World;
  physics = new Physics();
  fx = new Fx();
  player: Player;
  cam: FollowCamera;
  companion: Companion;
  combat: Combat;
  quests = new QuestLog();

  npcs: Npc[] = [];
  interactables: Interactable[] = [];
  pickups = new Map<string, LootPickup>();
  shrineLights: ShrineLight[] = [];
  discovered = new Set<string>();
  inventory = new Map<string, number>();
  activeInteract: Interactable | null = null;
  dialogueNpc: Npc | null = null;
  dialogueIdx = 0;

  private lootGroup = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private fireSources: Array<{ x: number; y: number; z: number; scale: number; cold?: boolean }> = [];
  private mistSources: Array<{ x: number; y: number; z: number; scale: number }> = [];
  private cooldowns = [0, 0, 0];
  private respawn = new THREE.Vector3();
  private phase: 'loading' | 'title' | 'intro' | 'playing' | 'dead' | 'victory' = 'loading';
  private introT = 0;
  private deathT = 0;
  private victoryT = 0;
  private playTime = 0;
  private stageQueue: Array<{ label: string; run: () => void }> = [];
  private stageIndex = 0;
  private hudTimer = 0;
  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private prevAttackPhase = 0;
  private bossTriggered = false;
  private lastRegion = '';
  private gateOpen = false;
  private rng = new Random('game');
  private trailBase = new THREE.Vector3();
  private trailTip = new THREE.Vector3();
  private started = false;

  constructor(container: HTMLElement) {
    this.engine = new Engine(container);
    this.world = new World(this.physics);
    this.player = new Player(this.physics);
    this.cam = new FollowCamera(this.engine.camera, this.physics);
    this.companion = new Companion(this.physics, this.fx);
    this.combat = new Combat(this.physics, this.fx, {
      onDamage: (d) => this.onDamage(d),
      onKill: (e) => this.onKill(e),
      onBossPhase: (p) => this.onBossPhase(p),
      onPlayerHit: () => { this.cam.addShake(0.55); this.damageFlash = 1; },
    });

    this.engine.scene.add(this.world.group);
    this.engine.scene.add(this.fx.group);
    this.engine.scene.add(this.combat.group);
    this.engine.scene.add(this.lootGroup);
    this.engine.scene.add(this.player.group);
    this.engine.scene.add(this.companion.group);

    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffb066, 0, 30, 2);
      l.visible = false;
      this.engine.scene.add(l);
      this.lights.push(l);
    }

    // sun: mid-afternoon, west-south-west, so the vista north is fully lit
    const el = THREE.MathUtils.degToRad(33);
    const az = THREE.MathUtils.degToRad(152);
    atmo.uSunDir.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    atmo.uReveal.value = 0;
    this.engine.post.grade.uniforms.uFade.value = 1;
    this.engine.post.grade.uniforms.uLetterbox.value = 0.115;

    this.wireQuests();
  }

  private damageFlash = 0;

  /* ---------------------------------------------------------------- *
   * Loading
   * ---------------------------------------------------------------- */

  beginLoad() {
    this.stageQueue = [
      ...this.world.stages(),
      {
        label: 'Waking the Warden',
        run: () => {
          this.physics.build();
          this.player.spawn(START_POS.x, START_POS.z, Math.PI * 0.06);
          this.respawn.copy(this.player.pos);
          this.companion.spawn(START_POS.x + 2.6, START_POS.z + 1.6, Math.PI * 0.06);
          this.cam.reset(this.player.pos, this.player.yaw, -0.05);
          this.engine.bakeEnvironment(this.world.sky.mesh);
          this.world.terrain.primeAround(START_POS.x, START_POS.z, 46);
          this.buildEntities();
          this.combat.populate((x, z) => {
            const h = terrainHeight(x, z);
            return h > LAKE_Y + 0.5 && h < 300 && !this.physics.inside(x, h + 1, z);
          });
          this.combat.spawnBoss(-60, -554);
          this.hookPlayer();
        },
      },
    ];
    this.stageIndex = 0;
    realms.set({ phase: 'loading', loadingLabel: this.stageQueue[0].label, loadingProgress: 0 });
    this.pump();
  }

  /** Run one build stage per frame so the loading screen stays alive. */
  private pump = () => {
    if (this.stageIndex >= this.stageQueue.length) {
      realms.set({ phase: 'title', loadingProgress: 1, loadingLabel: '' });
      this.phase = 'title';
      this.engine.start();
      this.engine.add((ctx) => this.frame(ctx.dt));
      return;
    }
    const stage = this.stageQueue[this.stageIndex];
    realms.set({ loadingLabel: stage.label, loadingProgress: this.stageIndex / this.stageQueue.length });
    requestAnimationFrame(() => {
      const t0 = performance.now();
      stage.run();
      void t0;
      this.stageIndex++;
      this.pump();
    });
  };

  /** Called from the title screen click — the first user gesture. */
  async begin() {
    if (this.started) return;
    this.started = true;
    await audio.start();
    audio.cinematic = true;
    audio.fadeInMusic(7, 0.55);
    this.phase = 'intro';
    this.introT = 0;
    realms.set({ phase: 'intro' });
    this.engine.input.enabled = false;
  }

  /* ---------------------------------------------------------------- *
   * World entities
   * ---------------------------------------------------------------- */

  private buildEntities() {
    // --- NPCs ---
    for (const p of this.world.points) {
      if (p.kind !== 'npc') continue;
      const who = (p.data?.who as string) ?? 'elder';
      const data = NPC_DATA[who];
      const npc = new Npc(p.id, data.name, NPC_LOOKS[who], p.x, p.z, Math.PI * 0.9, data.dialogues);
      this.npcs.push(npc);
      this.engine.scene.add(npc.group);
      this.interactables.push({
        id: p.id, kind: 'npc', x: npc.pos.x, y: npc.pos.y, z: npc.pos.z,
        radius: 3.4, prompt: `Speak to ${data.name}`, label: data.name, data: { who },
      });
    }

    // --- shrines ---
    for (const p of this.world.points) {
      if (p.kind !== 'shrine') continue;
      this.interactables.push({
        id: p.id, kind: 'shrine', x: p.x, y: p.y, z: p.z, radius: 3.6,
        prompt: 'Light the shrine', label: (p.data?.name as string) ?? 'Shrine',
      });
      const light = new ShrineLight(p.x, p.y, p.z);
      this.shrineLights.push(light);
      this.engine.scene.add(light.group);
    }

    // --- doors ---
    for (const p of this.world.points) {
      if (p.kind !== 'door') continue;
      this.interactables.push({
        id: p.id, kind: 'door', x: p.x, y: p.y, z: p.z, radius: 5.5,
        prompt: p.id === 'wardens_gate' ? 'Set the sealstones' : 'Enter',
        label: (p.data?.name as string) ?? 'Gate',
      });
    }

    // --- lore + ambience sources ---
    for (const p of this.world.points) {
      if (p.kind !== 'lore') continue;
      if (p.data?.fire) {
        this.fireSources.push({ x: p.x, y: p.y, z: p.z, scale: 1, cold: !!p.data.cold });
        continue;
      }
      if (p.data?.smoke) {
        this.fireSources.push({ x: p.x, y: p.y, z: p.z, scale: 0.45, cold: false });
        continue;
      }
      const key = p.data?.text as string | undefined;
      if (!key || !LORE[key]) continue;
      this.interactables.push({
        id: p.id, kind: 'lore', x: p.x, y: p.y, z: p.z, radius: 3.4,
        prompt: 'Read the inscription', label: LORE[key].title, data: { key },
      });
    }

    // --- mist at the falls ---
    for (const f of this.world.falls.specs) {
      if (!f.mist) continue;
      this.mistSources.push({ x: f.x, y: f.y - f.height * (f.fadeBottom ?? 0.86), z: f.z, scale: f.widthBottom / 16 });
    }
    this.mistSources.push({ x: -640, y: -60, z: 92, scale: 4 });

    // --- loot: the three sealstones plus rewards ---
    const lootSpots: Array<{ id: string; item: string; x: number; z: number; y?: number }> = [
      { id: 'seal_colonnade', item: 'sealstone', x: -372, z: 336, y: terrainHeight(-372, 336) + 3.4 },
      { id: 'seal_skyshard', item: 'sealstone', x: this.world.islandTops[0]?.x ?? 300, z: this.world.islandTops[0]?.z ?? -140, y: (this.world.islandTops[0]?.y ?? 176) + 1.6 },
      { id: 'seal_march', item: 'sealstone', x: -140, z: -350 },
      { id: 'loot_sunstone', item: 'sunstone', x: -352, z: 318 },
      { id: 'loot_ember1', item: 'emberfruit', x: 40, z: 402 },
      { id: 'loot_ember2', item: 'emberfruit', x: -110, z: 130 },
      { id: 'loot_ember3', item: 'emberfruit', x: -70, z: -300 },
      { id: 'loot_charm', item: 'ember_charm', x: 196, z: 210 },
      { id: 'loot_storm', item: 'stormheart', x: this.world.islandTops[1]?.x ?? 372, z: this.world.islandTops[1]?.z ?? -204, y: (this.world.islandTops[1]?.y ?? 214) + 1.6 },
    ];
    for (const spot of lootSpots) {
      const item = ITEMS[spot.item];
      const y = spot.y ?? terrainHeight(spot.x, spot.z) + 1.1;
      const pickup = new LootPickup(spot.x, y, spot.z, item.rarity);
      this.pickups.set(spot.id, pickup);
      this.lootGroup.add(pickup.group);
      this.interactables.push({
        id: spot.id, kind: 'loot', x: spot.x, y, z: spot.z, radius: 2.6,
        prompt: `Take ${item.name}`, label: item.name, once: true, data: { item: spot.item },
      });
    }

    realms.set({
      abilities: ABILITIES.map((a) => ({ ...a, cooldown: 0, unlocked: true })),
    });
    this.quests.sync();
  }

  private hookPlayer() {
    this.player.onAttack = (e) => {
      const hits = this.combat.resolvePlayerAttack(e, this.player);
      if (hits > 0) this.cam.addShake(e.heavy ? 0.42 : 0.24, 40);
      audio.sfx(e.heavy ? 'swingHeavy' : 'swing', 0.8);
    };
    this.player.onAbility = (slot) => this.useAbility(slot);
    this.player.onJump = () => audio.sfx('jump', 0.6);
    this.player.onRoll = () => audio.sfx('dodge', 0.7);
    this.player.onLand = (impact) => {
      audio.sfx('land', 0.5 + impact);
      this.fx.landPuff(this.player.pos.x, this.player.pos.y, this.player.pos.z, impact);
      if (impact > 0.15) this.cam.addShake(impact * 0.9, 26);
    };
    this.player.onFootstep = (foot, speed) => {
      const wet = this.player.inWater > 0.15;
      audio.sfx(wet ? 'step' : 'stepGrass', 0.5 + Math.min(0.5, speed / 12));
      this.fx.footDust(
        this.player.pos.x + Math.sin(this.player.yaw + (foot ? 1.4 : -1.4)) * 0.25,
        this.player.pos.y, this.player.pos.z + Math.cos(this.player.yaw + (foot ? 1.4 : -1.4)) * 0.25,
        speed, wet,
      );
    };
    this.player.onDamaged = () => { this.damageFlash = 1; };
    this.player.onDeath = () => {
      this.phase = 'dead';
      this.deathT = 0;
      realms.set({ phase: 'dead', deaths: realms.state.deaths + 1 });
      audio.intensity = 0;
    };
  }

  private wireQuests() {
    this.quests.onStart = (q) => {
      realms.toast({ kind: 'quest', title: 'New Quest', subtitle: q.title });
      audio.sfx('quest');
    };
    this.quests.onObjective = (q, o) => {
      realms.toast({ kind: 'objective', title: 'Objective complete', subtitle: o.text });
      audio.sfx('ui', 1.4);
      void q;
    };
    this.quests.onComplete = (q) => {
      realms.toast({ kind: 'quest', title: 'Quest complete', subtitle: q.title });
      audio.sfx('quest');
      const levels = this.player.addXp(q.xp);
      if (levels > 0) this.onLevelUp(levels);
      if (q.reward) this.giveItem(q.reward, 2);
      if (q.id === 'the_warden') {
        this.phase = 'victory';
        this.victoryT = 0;
        realms.set({ phase: 'victory' });
      }
    };
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  private frame(dt: number) {
    this.world.update(this.engine.camera, this.player.pos.x, this.player.pos.z);

    switch (this.phase) {
      case 'title': this.frameTitle(dt); break;
      case 'intro': this.frameIntro(dt); break;
      case 'playing': this.framePlaying(dt); break;
      case 'dead': this.frameDead(dt); break;
      case 'victory': this.frameVictory(dt); break;
      default: break;
    }

    this.fx.update(dt);
    this.engine.updateSunShadow(this.player.pos);
    this.updateAmbience(dt);
    this.hudTimer += dt;
    if (this.hudTimer > 1 / 15) {
      this.hudTimer = 0;
      this.syncHud();
    }
    realms.gc(performance.now());
  }

  private frameTitle(dt: number) {
    // slow drift over the vista while the title waits for a click
    const t = this.engine.elapsed;
    const p = this.player.pos;
    this.cam.cinematic = 1;
    this.cam.cinematicFov = 38;
    this.cam.cinematicPos.set(
      p.x + Math.cos(t * 0.045) * 26 + 6,
      p.y + 17,
      p.z + Math.sin(t * 0.045) * 26 + 20,
    );
    this.cam.cinematicLook.set(p.x - 40, p.y + 34, p.z - 420);
    this.cam.update(dt, p, { speed01: 0, sprinting: false, strafe: 0, airborne: false, dead: false });
    this.player.char.update(dt, { speed01: 0 });
    this.companion.wolf.anim.setState('sit');
    this.companion.wolf.update(dt);
    atmo.uReveal.value = damp(atmo.uReveal.value, 1, 0.7, dt);
    const g = this.engine.post.grade.uniforms;
    g.uFade.value = damp(g.uFade.value, 0.55, 0.6, dt);
  }

  /** The opening: black, wind, theme, then the shelf. */
  private frameIntro(dt: number) {
    this.introT += dt;
    const t = this.introT;
    const p = this.player.pos;
    const g = this.engine.post.grade.uniforms;

    atmo.uReveal.value = clamp01(smoothstep(0.8, 5.0, t));
    g.uFade.value = 1 - smoothstep(1.0, 5.5, t);
    g.uLetterbox.value = lerp(0.115, 0.0, smoothstep(11.5, 13.6, t));

    // --- camera move: a high wide establishing shot pushing in over the shoulder ---
    const a = smoothstep(0, 8.4, t);
    const b = smoothstep(7.8, 12.6, t);
    const wide = new THREE.Vector3(p.x + 34, p.y + 30, p.z + 40);
    const mid = new THREE.Vector3(p.x + 7.5, p.y + 7.0, p.z + 13.5);
    const close = new THREE.Vector3(p.x + 2.6, p.y + 3.4, p.z + 7.4);
    this.cam.cinematicPos.copy(wide).lerp(mid, a).lerp(close, b);
    const lookFar = new THREE.Vector3(p.x - 70, p.y + 46, p.z - 520);
    const lookNear = new THREE.Vector3(p.x, p.y + 1.5, p.z);
    this.cam.cinematicLook.copy(lookFar).lerp(lookNear, smoothstep(9.5, 13.2, t));
    this.cam.cinematicFov = lerp(36, 58, smoothstep(8.5, 13.4, t));
    this.cam.cinematic = 1 - smoothstep(12.6, 13.8, t);
    this.cam.yaw = Math.PI * 0.06 + Math.PI;
    this.cam.pitch = -0.06;
    this.cam.update(dt, p, { speed01: 0, sprinting: false, strafe: 0, airborne: false, dead: false });

    // --- beats ---
    if (t > 5.6 && !this.beat1) {
      this.beat1 = true;
      realms.set({ cinematicTitle: { title: 'REALMS', subtitle: 'THE SUNDERED SHELF' } });
    }
    if (t > 7.4 && !this.beat2) {
      this.beat2 = true;
      this.companion.howl();
    }
    if (t > 10.6 && !this.beat3) {
      this.beat3 = true;
      realms.set({ cinematicTitle: null, phase: 'playing' });
      realms.set({ objectiveBanner: 'DISCOVER SKYFALL KEEP' });
      audio.sfx('discover', 0.7);
    }
    if (t > 13.6) {
      this.phase = 'playing';
      this.cam.cinematic = 0;
      this.cam.snapBehind(Math.PI * 0.06 + Math.PI);
      this.engine.input.enabled = true;
      this.engine.input.requestPointerLock();
      audio.cinematic = false;
      audio.fadeInMusic(4, 0.42);
      window.setTimeout(() => realms.set({ objectiveBanner: null }), 4200);
      realms.set({ hint: 'WASD move · Shift sprint · Space jump · C dodge · LMB attack · F interact · Q lock on' });
      window.setTimeout(() => realms.set({ hint: null }), 12000);
    }

    this.player.char.update(dt, { speed01: 0 });
    this.companion.wolf.update(dt);
    this.combat.update(dt, this.player);
  }

  private beat1 = false;
  private beat2 = false;
  private beat3 = false;

  private framePlaying(dt: number) {
    this.playTime += dt;
    const input = this.engine.input.update();

    if (input.pause) {
      const paused = !realms.state.paused;
      realms.set({ paused, showJournal: false, showMap: false });
      if (paused) this.engine.input.exitPointerLock();
    }
    if (realms.state.dialogue) {
      if (input.interact || input.attack) this.advanceDialogue();
      this.engine.input.enabled = true;
    }
    if (input.journal) realms.set({ showJournal: !realms.state.showJournal, showMap: false });
    if (input.map) realms.set({ showMap: !realms.state.showMap, showJournal: false });

    const uiOpen = realms.state.paused || !!realms.state.dialogue || realms.state.showJournal || realms.state.showMap;
    const gameInput = uiOpen
      ? { ...input, moveX: 0, moveZ: 0, jump: false, attack: false, heavy: false, dodge: false, interact: false, ability1: false, ability2: false, ability3: false }
      : input;

    // camera
    if (!uiOpen) {
      this.cam.orbit(input.lookYaw, input.lookPitch);
      if (input.zoom) this.cam.zoom(input.zoom);
    }

    // lock-on
    if (input.lockOn && !uiOpen) this.toggleLockOn();
    if (this.player.lockTarget) {
      const e = this.lockedEnemy;
      if (!e || e.dead || e.distanceTo(this.player.pos) > 34) this.clearLockOn();
      else {
        this.player.lockTarget.position.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
        this.cam.lockTarget = this.player.lockTarget.position;
      }
    }

    this.player.update(dt, gameInput, this.cam.yaw);
    this.companion.update(dt, this.player, this.combat);
    this.combat.update(dt, this.player);

    // sword trail during swings
    this.updateTrail(dt);

    // interaction
    this.updateInteraction(gameInput.interact);

    // discovery
    this.updateDiscovery();

    // abilities cooldown
    for (let i = 0; i < this.cooldowns.length; i++) {
      this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    }

    // boss arena trigger
    this.updateBossTrigger();

    // NPCs
    for (const n of this.npcs) n.update(dt, this.player.pos);
    for (const [, pk] of this.pickups) pk.update(dt);
    for (const s of this.shrineLights) s.update(dt);

    this.cam.update(dt, this.player.pos, {
      speed01: clamp01(this.player.speed / 8.6),
      sprinting: this.player.sprinting,
      strafe: this.player.char.anim.ctx.strafe,
      airborne: !this.player.grounded,
      dead: false,
    });

    // combat music intensity
    const nearby = this.combat.enemies.filter((e) => !e.dead && e.aggro && e.distanceTo(this.player.pos) < 34).length;
    audio.intensity = clamp01(nearby / 3) * (this.combat.bossActive ? 1 : 0.85) + (this.combat.bossActive ? 0.35 : 0);

    // damage vignette
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    const lowHp = 1 - clamp01(this.player.stats.hp / (this.player.stats.hpMax * 0.35));
    this.engine.post.grade.uniforms.uDamage.value = Math.max(this.damageFlash * 0.55, lowHp * 0.30);
    const gg = this.engine.post.grade.uniforms;
    gg.uFade.value = damp(gg.uFade.value, 0, 3, dt);
  }

  private frameDead(dt: number) {
    this.deathT += dt;
    this.player.update(dt, this.engine.input.update(), this.cam.yaw);
    this.companion.update(dt, this.player, this.combat);
    this.combat.update(dt, this.player);
    this.cam.update(dt, this.player.pos, { speed01: 0, sprinting: false, strafe: 0, airborne: false, dead: true });
    const g = this.engine.post.grade.uniforms;
    g.uFade.value = clamp01(smoothstep(1.4, 3.0, this.deathT));
    if (this.deathT > 3.4) this.respawnPlayer();
  }

  private frameVictory(dt: number) {
    this.victoryT += dt;
    const input = this.engine.input.update();
    this.player.update(dt, { ...input, attack: false, heavy: false }, this.cam.yaw);
    this.companion.update(dt, this.player, this.combat);
    this.combat.update(dt, this.player);
    const p = this.player.pos;
    this.cam.cinematic = clamp01(smoothstep(0, 1.4, this.victoryT));
    this.cam.cinematicPos.set(p.x + 9, p.y + 6.5, p.z + 12);
    this.cam.cinematicLook.set(p.x, p.y + 1.6, p.z);
    this.cam.cinematicFov = 40;
    this.cam.update(dt, p, { speed01: 0, sprinting: false, strafe: 0, airborne: false, dead: false });
    const g = this.engine.post.grade.uniforms;
    g.uLetterbox.value = damp(g.uLetterbox.value, 0.115, 1.4, dt);
  }

  private respawnPlayer() {
    this.player.stats.hp = this.player.stats.hpMax;
    this.player.stats.energy = this.player.stats.energyMax * 0.6;
    this.player.stats.stamina = this.player.stats.staminaMax;
    this.player.state = 'idle';
    this.player.spawn(this.respawn.x, this.respawn.z, this.player.yaw);
    this.companion.spawn(this.respawn.x + 2.4, this.respawn.z + 1.6, this.player.yaw);
    this.companion.hp = this.companion.hpMax;
    this.companion.state = 'follow';
    this.cam.reset(this.player.pos, this.player.yaw, -0.08);
    // enemies forget you
    for (const e of this.combat.enemies) {
      if (e.dead) continue;
      e.aggro = false;
      e.state = 'idle';
      if (e === this.combat.boss) { e.hp = e.hpMax; e.phase = 1; this.combat.bossActive = false; this.bossTriggered = false; realms.set({ bossName: null }); }
    }
    this.phase = 'playing';
    this.deathT = 0;
    realms.set({ phase: 'playing' });
    realms.toast({ kind: 'info', title: 'You wake at the shrine', subtitle: 'The shelf does not keep the dead.' });
  }

  /* ---------------------------------------------------------------- *
   * Systems
   * ---------------------------------------------------------------- */

  private lockedEnemy: Enemy | null = null;

  private toggleLockOn() {
    if (this.player.lockTarget) { this.clearLockOn(); return; }
    const fx = -Math.sin(this.cam.yaw), fz = -Math.cos(this.cam.yaw);
    const e = this.combat.findLockTarget(this.player.pos, fx, fz, 30);
    if (!e) return;
    this.lockedEnemy = e;
    const o = new THREE.Object3D();
    o.position.set(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
    this.player.lockTarget = o;
    this.cam.lockTarget = o.position;
    realms.set({ lockOn: true });
    audio.sfx('ui', 1.2);
  }

  private clearLockOn() {
    this.lockedEnemy = null;
    this.player.lockTarget = null;
    this.cam.lockTarget = null;
    realms.set({ lockOn: false });
  }

  private updateTrail(dt: number) {
    const swinging = this.player.state === 'attack' && this.player.char.anim.actionPhase > 0.14 && this.player.char.anim.actionPhase < 0.72;
    if (swinging) {
      if (!this.fx.trail.active) this.fx.trail.begin();
      this.built.swordBase.getWorldPosition(this.trailBase);
      this.built.swordTip.getWorldPosition(this.trailTip);
      this.fx.trail.push(this.trailBase, this.trailTip);
    } else if (this.fx.trail.active) {
      this.fx.trail.end();
    }
    void dt;
  }

  private get built() { return this.player.built; }

  private updateInteraction(pressed: boolean) {
    let best: Interactable | null = null;
    let bestD = 1e9;
    for (const it of this.interactables) {
      if (it.used && it.once) continue;
      const d = Math.hypot(it.x - this.player.pos.x, it.z - this.player.pos.z);
      const dy = Math.abs(it.y - this.player.pos.y);
      if (d > it.radius || dy > 4) continue;
      if (d < bestD) { bestD = d; best = it; }
    }
    this.activeInteract = best;
    if (best) {
      realms.set({ prompt: { text: best.prompt, key: 'F' } });
    } else if (realms.state.prompt) {
      realms.set({ prompt: null });
    }
    if (pressed && best && !realms.state.dialogue) this.interact(best);
  }

  private interact(it: Interactable) {
    switch (it.kind) {
      case 'npc': {
        const npc = this.npcs.find((n) => n.id === it.id);
        if (!npc) return;
        this.openDialogue(npc);
        break;
      }
      case 'shrine': {
        const wasUsed = it.used;
        it.used = true;
        this.respawn.set(it.x, it.y, it.z);
        this.player.stats.hp = this.player.stats.hpMax;
        this.player.stats.energy = this.player.stats.energyMax;
        this.player.stats.stamina = this.player.stats.staminaMax;
        this.companion.hp = this.companion.hpMax;
        const light = this.shrineLights.find((s) => Math.hypot(s.light.position.x - it.x, s.light.position.z - it.z) < 2);
        if (light) light.lit = true;
        this.fx.shockwave(it.x, it.y - 1.4, it.z, 3.2, AETHER);
        audio.sfx('discover', 0.8);
        realms.toast({
          kind: 'info',
          title: wasUsed ? 'Rested' : 'Shrine lit',
          subtitle: `${it.label} — you will wake here.`,
        });
        break;
      }
      case 'loot': {
        it.used = true;
        const pk = this.pickups.get(it.id);
        if (pk) {
          this.fx.shockwave(pk.group.position.x, pk.group.position.y, pk.group.position.z, 1.4, new THREE.Color(RARITY_COLOR[ITEMS[(it.data!.item as string)].rarity]));
          this.lootGroup.remove(pk.group);
          pk.dispose();
          this.pickups.delete(it.id);
        }
        this.giveItem(it.data!.item as string, 1);
        break;
      }
      case 'door': {
        if (it.id === 'wardens_gate') this.tryOpenGate(it);
        break;
      }
      case 'lore': {
        const key = it.data!.key as string;
        const l = LORE[key];
        realms.toast({ kind: 'info', title: l.title, subtitle: l.text });
        if (!it.used) { it.used = true; this.player.addXp(25); }
        audio.sfx('ui', 1.1);
        break;
      }
    }
  }

  private tryOpenGate(it: Interactable) {
    if (this.gateOpen) return;
    const have = this.inventory.get('sealstone') ?? 0;
    if (have < 3) {
      realms.toast({
        kind: 'info',
        title: 'The Gate is sealed',
        subtitle: `${have} of 3 sealstones set. The rest are still out on the shelf.`,
      });
      audio.sfx('ui', 0.9);
      return;
    }
    this.gateOpen = true;
    it.used = true;
    audio.sfx('gateOpen');
    this.cam.addShake(0.9, 14);
    this.fx.shockwave(it.x, it.y, it.z, 12, AETHER);
    // remove the gate's blocking collider by lifting the door leaves out of the way
    const gate = this.engine.scene.getObjectByName('keep');
    void gate;
    for (const c of this.physics.colliders) {
      if (c.kind === 'box' && Math.hypot(c.cx - it.x, c.cz - (it.z - 4.5)) < 7 && c.hy > 4) {
        c.solid = false;
      }
    }
    this.physics.build();
    this.quests.notify({ type: 'interact', id: 'wardens_gate' });
    realms.toast({ kind: 'quest', title: 'The Gate opens', subtitle: 'The road to the Keep is clear.' });
  }

  private openDialogue(npc: Npc) {
    const who = NPC_DATA[Object.keys(NPC_LOOKS).find((k) => NPC_DATA[k].name === npc.name)!];
    void who;
    const d = npc.currentDialogue();
    this.dialogueNpc = npc;
    this.dialogueIdx = 0;
    realms.set({
      dialogue: { npc: npc.name, portrait: npc.id, lines: d.lines, index: 0 },
    });
    this.engine.input.exitPointerLock();
  }

  private advanceDialogue() {
    const view = realms.state.dialogue;
    if (!view) return;
    const next = view.index + 1;
    if (next < view.lines.length) {
      realms.set({ dialogue: { ...view, index: next } });
      return;
    }
    // conversation over
    const npc = this.dialogueNpc;
    realms.set({ dialogue: null });
    this.dialogueNpc = null;
    if (!npc) return;
    const who = (this.interactables.find((i) => i.id === npc.id)?.data?.who as string) ?? '';
    this.quests.notify({ type: 'talk', npc: who });
    if (who === 'elder') {
      if (npc.dialogueIndex === 0 && this.quests.isStarted('embers_in_the_wood')) npc.dialogueIndex = 1;
      else if (npc.dialogueIndex === 1 && this.quests.isComplete('embers_in_the_wood')) npc.dialogueIndex = 2;
      if (this.quests.isComplete('embers_in_the_wood') && !this.rewardGiven) {
        this.rewardGiven = true;
        this.giveItem('ember_charm', 1);
      }
    }
  }

  private rewardGiven = false;

  private giveItem(id: string, count = 1) {
    const item = ITEMS[id];
    if (!item) return;
    this.inventory.set(id, (this.inventory.get(id) ?? 0) + count);
    realms.toast({ kind: 'item', title: item.name, subtitle: item.desc });
    audio.sfx('pickup');
    this.quests.notify({ type: 'collect', item: id, count });
    // passive effects
    if (id === 'sunstone') this.player.stats.attack += 5;
    if (id === 'stormheart') this.player.stats.energyMax += 30;
    if (id === 'ember_charm') this.player.stats.staminaMax += 25;
    if (id === 'wardens_sigil') { this.player.stats.attack += 12; this.player.stats.defense += 6; }
    this.syncInventory();
  }

  private syncInventory() {
    const inv = [...this.inventory.entries()].map(([id, count]) => {
      const it = ITEMS[id];
      return { id, name: it.name, rarity: it.rarity, desc: it.desc, count, kind: it.kind };
    });
    realms.set({ inventory: inv });
  }

  private useAbility(slot: number): boolean {
    const i = slot - 1;
    const a = ABILITIES[i];
    if (!a || this.cooldowns[i] > 0) return false;
    if (this.player.stats.energy < a.cost) {
      realms.toast({ kind: 'info', title: 'Not enough aether', subtitle: a.name });
      return false;
    }
    this.player.stats.energy -= a.cost;
    this.cooldowns[i] = a.cooldownMax;
    const p = this.player.pos;
    const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);

    if (a.id === 'surge') {
      const cx = p.x + fx * 3.2, cz = p.z + fz * 3.2;
      window.setTimeout(() => {
        this.fx.shockwave(cx, this.physics.groundHeight(cx, cz, p.y + 2, 1e6), cz, 7.5, AETHER);
        this.combat.radialDamage(cx, cz, 8.0, this.player.stats.attack * 2.3, 13, this.player);
        this.cam.addShake(0.7, 22);
        audio.sfx('castSurge');
      }, 320);
    } else if (a.id === 'riftstep') {
      audio.sfx('castDash');
      const dist = 11;
      const steps = 12;
      let landedX = p.x, landedZ = p.z;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const x = p.x + fx * dist * t;
        const z = p.z + fz * dist * t;
        const h = this.physics.groundHeight(x, z, p.y + 2, 2.2);
        if (h < p.y - 8) break;
        if (this.physics.inside(x, h + 1.0, z)) break;
        landedX = x; landedZ = z;
        this.fx.riftTrail(x, h, z);
      }
      this.player.pos.set(landedX, this.physics.groundHeight(landedX, landedZ, p.y + 2, 2.2), landedZ);
      this.player.invulnerable = Math.max(this.player.invulnerable, 0.45);
      this.combat.radialDamage(
        (p.x + landedX) / 2, (p.z + landedZ) / 2, 4.2,
        this.player.stats.attack * 1.5, 8, this.player,
      );
      this.cam.addShake(0.28, 30);
    } else if (a.id === 'fury') {
      const target = this.lockedEnemy && !this.lockedEnemy.dead
        ? this.lockedEnemy
        : this.combat.findLockTarget(this.player.pos, fx, fz, 26);
      if (!target) {
        this.cooldowns[i] = 0;
        this.player.stats.energy += a.cost;
        realms.toast({ kind: 'info', title: 'Ashfang has nothing to hunt' });
        return false;
      }
      this.companion.commanded = target;
      this.companion.state = 'chase';
      audio.sfx('wolfHowl', 0.7);
      target.poise -= 60;
      window.setTimeout(() => {
        if (target.dead) return;
        const killed = target.damage(this.player.stats.attack * 2.6, this.player.pos.x, this.player.pos.z, 7, this.fx, this.engine.elapsed);
        this.fx.dissolve(target.pos.x, target.pos.y + 1, target.pos.z, 1.4, AETHER);
        if (killed) this.player.addXp(target.def.xp);
      }, 700);
    }
    this.fx.castCharge(p.x, p.y + 1.2, p.z, AETHER);
    realms.set({
      abilities: ABILITIES.map((ab, k) => ({ ...ab, cooldown: this.cooldowns[k], unlocked: true })),
    });
    return true;
  }

  private onDamage(d: { amount: number; x: number; y: number; z: number; crit: boolean; toPlayer: boolean; kind: string }) {
    this._v.set(d.x, d.y, d.z).project(this.engine.camera);
    if (this._v.z > 1) return;
    realms.number({
      amount: Math.round(d.amount),
      crit: d.crit,
      toPlayer: d.toPlayer,
      kind: d.kind,
      x: this._v.x * 0.5 + 0.5,
      y: -this._v.y * 0.5 + 0.5,
    });
  }

  private onKill(e: Enemy) {
    this.quests.notify({ type: 'kill', kind: e.kind });
    if (e === this.combat.boss) {
      this.quests.notify({ type: 'boss', id: 'warden', stage: 'defeated' });
      this.combat.bossActive = false;
      realms.set({ bossName: null });
      this.giveItem('wardens_sigil', 1);
      audio.intensity = 0;
    }
    if (Math.random() < 0.22) {
      // a small drop
      const id = `drop_${e.id}`;
      const item = Math.random() < 0.7 ? 'emberfruit' : 'ember_charm';
      const y = e.pos.y + 1.0;
      const pk = new LootPickup(e.pos.x, y, e.pos.z, ITEMS[item].rarity);
      this.pickups.set(id, pk);
      this.lootGroup.add(pk.group);
      this.interactables.push({
        id, kind: 'loot', x: e.pos.x, y, z: e.pos.z, radius: 2.4,
        prompt: `Take ${ITEMS[item].name}`, label: ITEMS[item].name, once: true, data: { item },
      });
    }
  }

  private onBossPhase(phase: number) {
    realms.set({ bossPhase: phase });
    this.cam.addShake(1.0, 12);
    realms.toast({
      kind: 'info',
      title: phase === 2 ? 'The Warden calls the rift' : 'The Warden breaks',
      subtitle: phase === 2 ? 'Something answers from the cloud.' : 'The armour is coming apart. Finish it.',
    });
  }

  private onLevelUp(levels: number) {
    realms.toast({
      kind: 'level',
      title: `Level ${this.player.stats.level}`,
      subtitle: levels > 1 ? `${levels} levels gained` : 'Health and aether restored.',
    });
    this.fx.shockwave(this.player.pos.x, this.player.pos.y, this.player.pos.z, 4, AETHER);
    this.fx.heal(this.player.pos.x, this.player.pos.y, this.player.pos.z);
  }

  private updateDiscovery() {
    for (const l of LANDMARKS) {
      if (this.discovered.has(l.id)) continue;
      const d = Math.hypot(l.x - this.player.pos.x, l.z - this.player.pos.z);
      if (d > l.discoverRadius) continue;
      this.discovered.add(l.id);
      realms.set({ discovered: [...this.discovered] });
      realms.toast({ kind: 'discovery', title: l.name, subtitle: l.subtitle });
      audio.sfx('discover');
      if (l.xp > 0) {
        const levels = this.player.addXp(l.xp);
        if (levels) this.onLevelUp(levels);
      }
      this.quests.notify({ type: 'discover', id: l.id });
      if (l.id === 'amberfell') this.quests.start('amberfell_warning');
      if (l.id === 'skyfall_keep') this.quests.start('the_wardens_key');
      this.cam.addShake(0.12, 8);
      if (this.companion.state !== 'down' && Math.random() < 0.5) this.companion.howl();
    }
  }

  private updateBossTrigger() {
    if (this.bossTriggered || !this.combat.boss) return;
    const b = this.combat.boss;
    const d = Math.hypot(b.pos.x - this.player.pos.x, b.pos.z - this.player.pos.z);
    if (d > 46) return;
    this.bossTriggered = true;
    this.combat.bossActive = true;
    b.aggro = true;
    b.state = 'chase';
    this.quests.notify({ type: 'boss', id: 'warden', stage: 'engaged' });
    audio.sfx('bossRoar');
    this.cam.addShake(1.2, 10);
    realms.set({ bossName: ENEMY_DEFS.warden.name, bossHp: b.hp, bossHpMax: b.hpMax, bossPhase: 1 });
  }

  /* ---------------------------------------------------------------- *
   * Ambience
   * ---------------------------------------------------------------- */

  private updateAmbience(dt: number) {
    const p = this.player.pos;
    const cam = this.engine.camera.position;

    // fires: embers, smoke and the nearest few point lights
    const scored = this.fireSources
      .map((f) => ({ f, d: Math.hypot(f.x - cam.x, f.z - cam.z) }))
      .filter((s) => s.d < 90)
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lights.length; i++) {
      const s = scored[i];
      const l = this.lights[i];
      if (!s) { l.visible = false; l.intensity = 0; continue; }
      l.visible = true;
      l.position.set(s.f.x, s.f.y + 0.6, s.f.z);
      const flicker = 0.82 + Math.sin(this.engine.elapsed * 8.1 + i) * 0.10 + Math.sin(this.engine.elapsed * 17.3 + i) * 0.06;
      l.color.set(s.f.cold ? 0x66baff : 0xffa044);
      l.intensity = (s.f.cold ? 16 : 22) * s.f.scale * flicker * (1 - smoothstep(50, 90, s.d));
      l.distance = 34 * s.f.scale;
    }
    for (const s of scored.slice(0, 4)) {
      if (Math.random() < 0.6 * s.f.scale) this.fx.ember(s.f.x, s.f.y, s.f.z);
      if (Math.random() < 0.35 * s.f.scale) this.fx.smoke(s.f.x, s.f.y + 0.5, s.f.z, s.f.scale);
    }

    // waterfall mist
    for (const m of this.mistSources) {
      const d = Math.hypot(m.x - cam.x, m.z - cam.z);
      if (d > 220) continue;
      const n = Math.max(1, Math.round(3 * (1 - d / 220)));
      for (let i = 0; i < n; i++) this.fx.mist(m.x, m.y, m.z, 14 * m.scale, 2.2, m.scale);
    }

    // drifting leaves and motes near the player
    if (Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 26;
      this.fx.leaf(p.x + Math.cos(a) * r, p.y + 6 + Math.random() * 8, p.z + Math.sin(a) * r);
    }
    if (Math.random() < 0.22) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 18;
      this.fx.drift(p.x + Math.cos(a) * r, p.y + Math.random() * 4, p.z + Math.sin(a) * r, C_AETHER);
    }

    // audio ambience
    const waterDist = Math.min(
      riverDistance(p.x, p.z),
      ...this.mistSources.map((m) => Math.hypot(m.x - p.x, m.z - p.z) * 0.35),
    );
    audio.updateAmbience(dt, {
      altitude: clamp01((p.y - 40) / 260),
      exposure: clamp01(0.30 + (p.y - 60) / 300 + (this.world.data ? 0 : 0)),
      waterProximity: clamp01(1 - waterDist / 60),
      indoors: 0,
    });
  }

  /* ---------------------------------------------------------------- *
   * HUD feed
   * ---------------------------------------------------------------- */

  private syncHud() {
    const p = this.player;
    const camYaw = this.cam.yaw;

    // region
    let region = 'The Sundered Shelf';
    let bestD = 1e9;
    for (const r of REGIONS) {
      const d = Math.hypot(r.x - p.pos.x, r.z - p.pos.z);
      if (d < r.radius && d < bestD) { bestD = d; region = r.name; }
    }
    if (region !== this.lastRegion) {
      this.lastRegion = region;
    }

    // compass + minimap
    const compass: Array<{ id: string; kind: 'quest' | 'landmark' | 'shrine' | 'enemy' | 'npc' | 'boss' | 'loot'; angle: number; distance: number; label?: string; discovered: boolean }> = [];
    const blips: Array<{ id: string; kind: 'quest' | 'landmark' | 'shrine' | 'enemy' | 'npc' | 'boss' | 'loot'; x: number; y: number; label?: string }> = [];

    const rel = (x: number, z: number) => {
      const dx = x - p.pos.x, dz = z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      let ang = Math.atan2(dx, -dz) - (camYaw + Math.PI);
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      // minimap: rotate into camera space
      const c = Math.cos(-camYaw), s = Math.sin(-camYaw);
      return { dist, ang, mx: dx * c - dz * s, my: dx * s + dz * c };
    };

    const marker = this.quests.currentMarker();
    if (marker) {
      const r = rel(marker.pos[0], marker.pos[2]);
      compass.push({ id: 'quest', kind: 'quest', angle: r.ang, distance: r.dist, label: marker.text, discovered: true });
      blips.push({ id: 'quest', kind: 'quest', x: r.mx, y: r.my, label: marker.text });
    }
    for (const l of LANDMARKS) {
      const r = rel(l.x, l.z);
      const known = this.discovered.has(l.id);
      if (!known && !l.beacon) continue;
      if (r.dist > 1400) continue;
      compass.push({ id: l.id, kind: 'landmark', angle: r.ang, distance: r.dist, label: known ? l.name : '???', discovered: known });
      if (r.dist < 260) blips.push({ id: l.id, kind: 'landmark', x: r.mx, y: r.my, label: known ? l.name : undefined });
    }
    for (const it of this.interactables) {
      const r = rel(it.x, it.z);
      if (r.dist > 190) continue;
      if (it.used && it.once) continue;
      if (it.kind === 'shrine') blips.push({ id: it.id, kind: 'shrine', x: r.mx, y: r.my });
      else if (it.kind === 'npc') blips.push({ id: it.id, kind: 'npc', x: r.mx, y: r.my });
      else if (it.kind === 'loot') blips.push({ id: it.id, kind: 'loot', x: r.mx, y: r.my });
    }
    for (const e of this.combat.enemies) {
      if (e.dead || !e.active) continue;
      const r = rel(e.pos.x, e.pos.z);
      if (r.dist > 170) continue;
      blips.push({ id: `e${e.id}`, kind: e === this.combat.boss ? 'boss' : 'enemy', x: r.mx, y: r.my });
    }

    const boss = this.combat.boss;
    realms.set({
      hp: p.stats.hp, hpMax: p.stats.hpMax,
      energy: p.stats.energy, energyMax: p.stats.energyMax,
      stamina: p.stats.stamina, staminaMax: p.stats.staminaMax,
      level: p.stats.level, xp: p.stats.xp, xpNext: p.stats.xpNext,
      region,
      coords: [Math.round(p.pos.x), Math.round(p.pos.y), Math.round(p.pos.z)],
      fps: Math.round(this.engine.fps),
      quality: this.engine.quality,
      compass, blips,
      playerAngle: camYaw,
      playTime: this.playTime,
      abilities: ABILITIES.map((ab, k) => ({ ...ab, cooldown: this.cooldowns[k], unlocked: true })),
      bossHp: boss ? boss.hp : 0,
      bossHpMax: boss ? boss.hpMax : 1,
      bossName: this.combat.bossActive && boss && !boss.dead ? ENEMY_DEFS.warden.name : null,
    });
  }

  /** Developer shortcut: jump straight into gameplay. */
  skipIntro() {
    this.introT = 13.7;
  }

  /** Developer shortcut: drop the player somewhere else on the shelf. */
  teleport(x: number, z: number, yaw = Math.PI) {
    this.player.spawn(x, z, yaw);
    this.companion.spawn(x + 2.4, z + 1.6, yaw);
    this.respawn.copy(this.player.pos);
    this.cam.reset(this.player.pos, yaw, -0.08);
    this.world.terrain.primeAround(x, z, 40);
  }

  /** Developer shortcut: start the opening partway through. */
  seekIntro(at: number) {
    this.introT = at;
    if (at > 5.6) this.beat1 = true;
    if (at > 7.4) this.beat2 = true;
  }

  dispose() {
    this.engine.dispose();
    this.world.dispose();
    this.combat.dispose();
    this.companion.dispose();
    this.fx.dispose();
    for (const n of this.npcs) n.dispose();
    for (const [, pk] of this.pickups) pk.dispose();
    audio.dispose();
  }
}
