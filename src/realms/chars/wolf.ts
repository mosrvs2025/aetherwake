/**
 * REALMS — Ashfang, the aether wolf.
 *
 * A quadruped built on the same procedural rig system: swept-tube body, a
 * five-bone spine, a four-bone tail, and gaits written as phase functions.
 * The trot uses diagonal pairs and the gallop a rotary bound, both driven by
 * distance travelled so the paws never skate; the spine flexes with the gait,
 * the head counter-bobs, and the tail lags behind the body's yaw.
 */

import * as THREE from 'three';
import { Animator, Pose, Rig, autoSkin, type BoneDef, type SkinSegment } from './rig';
import { limb, tube, roundedBox, plate, at, V } from './geom';
import { mergeParts } from './humanoid';
import { makeCharacterMaterials, AETHER } from './materials';
import { Assets } from '../assets/registry';
import { clamp01, damp, lerp, smoothstep, TAU } from '../core/math';

const S = 1.16;               // overall scale — a big wolf, chest-high on the player
const y = (v: number) => v * S;

const WOLF_BONES: BoneDef[] = [
  { name: 'root', parent: null, head: [0, 0, 0] },
  { name: 'hips', parent: 'root', head: [0, y(0.62), y(0.30)] },
  { name: 'spine1', parent: 'hips', head: [0, y(0.665), y(0.10)] },
  { name: 'chest', parent: 'spine1', head: [0, y(0.685), y(-0.12)] },
  { name: 'neck', parent: 'chest', head: [0, y(0.705), y(-0.34)] },
  { name: 'head', parent: 'neck', head: [0, y(0.765), y(-0.52)] },
  { name: 'snout', parent: 'head', head: [0, y(0.725), y(-0.70)] },
  { name: 'jaw', parent: 'head', head: [0, y(0.700), y(-0.58)] },
  { name: 'earL', parent: 'head', head: [y(0.070), y(0.86), y(-0.47)] },
  { name: 'earR', parent: 'head', head: [y(-0.070), y(0.86), y(-0.47)] },

  { name: 'tail1', parent: 'hips', head: [0, y(0.605), y(0.42)] },
  { name: 'tail2', parent: 'tail1', head: [0, y(0.560), y(0.62)] },
  { name: 'tail3', parent: 'tail2', head: [0, y(0.490), y(0.80)] },
  { name: 'tail4', parent: 'tail3', head: [0, y(0.420), y(0.96)] },

  { name: 'shoulderL', parent: 'chest', head: [y(0.115), y(0.640), y(-0.20)] },
  { name: 'armFL', parent: 'shoulderL', head: [y(0.145), y(0.450), y(-0.175)] },
  { name: 'foreFL', parent: 'armFL', head: [y(0.150), y(0.250), y(-0.140)] },
  { name: 'pawFL', parent: 'foreFL', head: [y(0.150), y(0.055), y(-0.180)] },
  { name: 'toeFL', parent: 'pawFL', head: [y(0.150), y(0.030), y(-0.275)] },

  { name: 'shoulderR', parent: 'chest', head: [y(-0.115), y(0.640), y(-0.20)] },
  { name: 'armFR', parent: 'shoulderR', head: [y(-0.145), y(0.450), y(-0.175)] },
  { name: 'foreFR', parent: 'armFR', head: [y(-0.150), y(0.250), y(-0.140)] },
  { name: 'pawFR', parent: 'foreFR', head: [y(-0.150), y(0.055), y(-0.180)] },
  { name: 'toeFR', parent: 'pawFR', head: [y(-0.150), y(0.030), y(-0.275)] },

  { name: 'hipL', parent: 'hips', head: [y(0.135), y(0.590), y(0.26)] },
  { name: 'thighL', parent: 'hipL', head: [y(0.155), y(0.395), y(0.315)] },
  { name: 'shinL', parent: 'thighL', head: [y(0.158), y(0.215), y(0.185)] },
  { name: 'pawRL', parent: 'shinL', head: [y(0.158), y(0.055), y(0.230)] },
  { name: 'toeRL', parent: 'pawRL', head: [y(0.158), y(0.030), y(0.140)] },

  { name: 'hipR', parent: 'hips', head: [y(-0.135), y(0.590), y(0.26)] },
  { name: 'thighR', parent: 'hipR', head: [y(-0.155), y(0.395), y(0.315)] },
  { name: 'shinR', parent: 'thighR', head: [y(-0.158), y(0.215), y(0.185)] },
  { name: 'pawRR', parent: 'shinR', head: [y(-0.158), y(0.055), y(0.230)] },
  { name: 'toeRR', parent: 'pawRR', head: [y(-0.158), y(0.030), y(0.140)] },
];

function buildWolfBody(rig: Rig) {
  const w = (n: string) => rig.worldOf(n).clone();
  const fur: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const energy: THREE.BufferGeometry[] = [];

  // --- body: hips -> chest -> neck, swept with an elliptical section ---
  const bodyPath = [
    w('hips').clone().add(V(0, 0, y(0.16))),
    w('hips'), w('spine1'), w('chest'),
    w('chest').clone().lerp(w('neck'), 0.5),
    w('neck'),
    w('neck').clone().lerp(w('head'), 0.55),
  ];
  const bodyR = [0.135, 0.170, 0.183, 0.196, 0.182, 0.150, 0.112].map((r) => y(r));
  fur.push(tube(bodyPath, bodyR, {
    radial: 16,
    squashX: [0.86, 0.94, 0.96, 0.98, 0.92, 0.90, 0.92],
    squashZ: [1.00, 1.05, 1.08, 1.10, 1.06, 1.02, 1.00],
  }));

  // --- head: cranium + tapered muzzle + jaw ---
  const head = w('head'), snout = w('snout'), jaw = w('jaw');
  const cranium = new THREE.SphereGeometry(y(0.105), 16, 12);
  cranium.scale(0.94, 0.92, 1.16);
  cranium.translate(head.x, head.y, head.z + y(0.02));
  fur.push(cranium);
  fur.push(limb(head.clone().add(V(0, y(-0.02), y(-0.02))), snout, y(0.078), y(0.042), 12, 1.02));
  dark.push(at(new THREE.SphereGeometry(y(0.030), 10, 8), snout.x, snout.y + y(0.008), snout.z - y(0.012), 0, 0, 0, 1, 0.85, 0.9));
  fur.push(limb(head.clone().add(V(0, y(-0.05), 0)), jaw.clone().add(V(0, 0, y(-0.10))), y(0.060), y(0.034), 10));

  // ears — angular plates
  for (const side of [1, -1] as const) {
    const e = w(side > 0 ? 'earL' : 'earR');
    const ear = plate([[0, 0], [0.045, 0.02], [0.022, 0.135], [-0.030, 0.055]].map(([a, b]) => [a * S, b * S] as [number, number]), y(0.016), 0.25);
    ear.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(e.x, e.y - y(0.03), e.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, 0, -side * 0.28)),
      new THREE.Vector3(1, 1, 1),
    ));
    fur.push(ear);
  }

  // eyes — the aether shows through first here
  for (const side of [1, -1] as const) {
    const g = new THREE.SphereGeometry(y(0.015), 8, 6);
    g.translate(side * y(0.052), head.y + y(0.012), head.z - y(0.075));
    energy.push(g);
  }

  // --- neck ruff: spiky plates for silhouette ---
  for (let i = 0; i < 11; i++) {
    const a = (i / 10) * Math.PI * 1.55 - Math.PI * 0.28;
    const base = w('neck').clone().lerp(w('chest'), 0.28);
    const r = y(0.165);
    const g = plate([[0, 0], [0.055, 0.03], [0.02, 0.15], [-0.045, 0.05]].map(([u, v]) => [u * S, v * S] as [number, number]), y(0.020), 0.2);
    const dir = new THREE.Vector3(Math.sin(a), Math.cos(a) * 0.8, 0);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(base.x + dir.x * r, base.y + dir.y * r * 0.9, base.z + y(0.02)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, -a)),
      new THREE.Vector3(1, 1, 1),
    ));
    fur.push(g);
  }

  // --- spine line of aether ---
  energy.push(tube(
    [w('hips'), w('spine1'), w('chest'), w('neck'), w('head').clone().add(V(0, y(0.02), y(0.04)))]
      .map((p) => p.clone().add(V(0, y(0.155), 0))),
    [y(0.007), y(0.009), y(0.010), y(0.008), y(0.005)],
    { radial: 6 },
  ));

  // --- tail ---
  const tailPts = ['hips', 'tail1', 'tail2', 'tail3', 'tail4'].map((n) => w(n));
  fur.push(tube(tailPts, [y(0.095), y(0.085), y(0.070), y(0.050), y(0.028)], { radial: 10 }));
  energy.push(tube(
    [tailPts[3], tailPts[4], tailPts[4].clone().add(V(0, y(-0.04), y(0.10)))],
    [y(0.014), y(0.018), y(0.003)],
    { radial: 8 },
  ));

  // --- legs ---
  const legChain = (a: string, b: string, c: string, d: string, e: string, r0: number, r1: number, r2: number) => {
    const A = w(a), B = w(b), C = w(c), D = w(d), E = w(e);
    fur.push(limb(A, B, y(r0), y(r1), 10, 1.10));
    fur.push(limb(B, C, y(r1), y(r2), 10, 1.06));
    dark.push(limb(C, D, y(r2), y(r2 * 0.86), 9));
    dark.push(at(roundedBox(y(0.085), y(0.048), y(0.125), 0.4, 2), D.x, D.y - y(0.008), (D.z + E.z) / 2));
    energy.push(tubeRing(D.x, D.y + y(0.03), D.z, y(0.052), y(0.0055)));
  };
  legChain('shoulderL', 'armFL', 'foreFL', 'pawFL', 'toeFL', 0.115, 0.072, 0.048);
  legChain('shoulderR', 'armFR', 'foreFR', 'pawFR', 'toeFR', 0.115, 0.072, 0.048);
  legChain('hipL', 'thighL', 'shinL', 'pawRL', 'toeRL', 0.135, 0.080, 0.050);
  legChain('hipR', 'thighR', 'shinR', 'pawRR', 'toeRR', 0.135, 0.080, 0.050);

  return { fur, dark, energy };
}

function tubeRing(cx: number, cy: number, cz: number, radius: number, thickness: number) {
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    path.push(V(cx + Math.cos(a) * radius, cy, cz + Math.sin(a) * radius * 1.15));
    radii.push(thickness);
  }
  return tube(path, radii, { radial: 5, capStart: false, capEnd: false });
}

function wolfSegments(rig: Rig): SkinSegment[] {
  const w = (n: string) => rig.worldOf(n);
  const seg = (bone: string, a: string, b: string, radius: number, falloff = 2.2): SkinSegment =>
    ({ bone, a: w(a).clone(), b: w(b).clone(), radius: radius * S, falloff });
  return [
    seg('hips', 'hips', 'spine1', 0.30),
    seg('spine1', 'spine1', 'chest', 0.30),
    seg('chest', 'chest', 'neck', 0.32),
    seg('neck', 'neck', 'head', 0.24),
    seg('head', 'head', 'snout', 0.24, 1.5),
    seg('snout', 'snout', 'snout', 0.10, 1.4),
    seg('jaw', 'jaw', 'jaw', 0.07, 1.6),
    seg('earL', 'earL', 'earL', 0.11, 1.2),
    seg('earR', 'earR', 'earR', 0.11, 1.2),
    seg('tail1', 'tail1', 'tail2', 0.16),
    seg('tail2', 'tail2', 'tail3', 0.15),
    seg('tail3', 'tail3', 'tail4', 0.13),
    seg('tail4', 'tail4', 'tail4', 0.14, 1.4),
    seg('shoulderL', 'shoulderL', 'armFL', 0.15),
    seg('armFL', 'armFL', 'foreFL', 0.14),
    seg('foreFL', 'foreFL', 'pawFL', 0.11),
    seg('pawFL', 'pawFL', 'toeFL', 0.13, 1.6),
    seg('shoulderR', 'shoulderR', 'armFR', 0.15),
    seg('armFR', 'armFR', 'foreFR', 0.14),
    seg('foreFR', 'foreFR', 'pawFR', 0.11),
    seg('pawFR', 'pawFR', 'toeFR', 0.13, 1.6),
    seg('hipL', 'hipL', 'thighL', 0.17),
    seg('thighL', 'thighL', 'shinL', 0.15),
    seg('shinL', 'shinL', 'pawRL', 0.11),
    seg('pawRL', 'pawRL', 'toeRL', 0.13, 1.6),
    seg('hipR', 'hipR', 'thighR', 0.17),
    seg('thighR', 'thighR', 'shinR', 0.15),
    seg('shinR', 'shinR', 'pawRR', 0.11),
    seg('pawRR', 'pawRR', 'toeRR', 0.13, 1.6),
  ];
}

export class Wolf {
  group = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  rig: Rig;
  anim: Animator;
  gait = 0;
  velocity = new THREE.Vector3();
  lookTarget: THREE.Vector3 | null = null;
  lookWeight = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private yawLag = 0;
  private prevYaw = 0;
  materials: ReturnType<typeof makeCharacterMaterials>;

  constructor() {
    const imported = Assets.instance('wolf');
    if (imported?.skinned) {
      // an authored wolf keeps the procedural gaits, driven by name
      const map = Assets.boneMap('wolf') ?? Object.fromEntries(WOLF_BONES.map((b) => [b.name, b.name]));
      const rig = Rig.adopt(imported.skinned.skeleton, map);
      if (rig.bones.length >= 6) {
        this.rig = rig;
        this.mesh = imported.skinned;
        this.materials = makeCharacterMaterials({ key: 'imported-wolf' });
        this.group.add(imported.root);
        this.anim = new Animator(rig);
        this.registerAnims();
        this.anim.setState('idle');
        return;
      }
    }
    const rig = new Rig(WOLF_BONES);
    this.rig = rig;
    const { fur, dark, energy } = buildWolfBody(rig);
    const materials = makeCharacterMaterials({
      key: 'wolf',
      skin: '#3a4150',
      armor: '#191d25',
      cloth: '#1a1e27',
      leather: '#242833',
      energy: AETHER.clone(),
      energyPower: 2.6,
      metalness: 0.1,
      roughness: 0.86,
    });
    this.materials = materials;
    const geo = mergeParts([fur, dark, [], [], energy]);
    autoSkin(geo, rig, wolfSegments(rig));
    const mesh = new THREE.SkinnedMesh(geo, [
      materials.skin, materials.armor, materials.cloth, materials.leather, materials.energy,
    ]);
    mesh.bind(rig.skeleton);
    mesh.normalizeSkinWeights();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.group.add(rig.root);
    this.group.add(mesh);

    this.anim = new Animator(rig);
    this.registerAnims();
    this.anim.setState('idle');
  }

  private i(n: string) { return this.rig.hasBone(n) ? this.rig.idx(n) : 0; }

  private registerAnims() {
    const B = {
      hips: this.i('hips'), spine: this.i('spine1'), chest: this.i('chest'),
      neck: this.i('neck'), head: this.i('head'), jaw: this.i('jaw'),
      earL: this.i('earL'), earR: this.i('earR'),
      tail: [this.i('tail1'), this.i('tail2'), this.i('tail3'), this.i('tail4')],
      fl: [this.i('shoulderL'), this.i('armFL'), this.i('foreFL'), this.i('pawFL')],
      fr: [this.i('shoulderR'), this.i('armFR'), this.i('foreFR'), this.i('pawFR')],
      rl: [this.i('hipL'), this.i('thighL'), this.i('shinL'), this.i('pawRL')],
      rr: [this.i('hipR'), this.i('thighR'), this.i('shinR'), this.i('pawRR')],
    };

    const tailWag = (p: Pose, w: number, t: number, amp: number, curl: number) => {
      for (let i = 0; i < 4; i++) {
        const f = (i + 1) / 4;
        p.add(B.tail[i], curl * f - 0.10 * f, Math.sin(t * 3.1 - i * 0.6) * amp * f, 0, w);
      }
    };

    const ears = (p: Pose, w: number, t: number, back: number) => {
      const tw = Math.max(0, Math.sin(t * 0.7) - 0.96) * 12;
      p.add(B.earL, -back * 0.5 + tw * 0.3, 0, -back * 0.3 - tw * 0.2, w);
      p.add(B.earR, -back * 0.5 + tw * 0.2, 0, back * 0.3 + tw * 0.2, w);
    };

    // ---- idle ----
    this.anim.register('idle', (p, t, w) => {
      const br = Math.sin(t * 1.5);
      p.addPos(B.hips, 0, br * 0.008 * S, 0, w);
      p.add(B.spine, br * 0.012, Math.sin(t * 0.4) * 0.02, 0, w);
      p.add(B.chest, br * 0.014, 0, 0, w);
      p.add(B.neck, -0.06, Math.sin(t * 0.33) * 0.10, 0, w);
      p.add(B.head, 0.03, Math.sin(t * 0.27) * 0.14, Math.sin(t * 0.19) * 0.04, w);
      for (const L of [B.fl, B.fr]) { p.add(L[1], 0.03, 0, 0, w); p.add(L[2], -0.10, 0, 0, w); }
      for (const L of [B.rl, B.rr]) { p.add(L[1], -0.22, 0, 0, w); p.add(L[2], 0.34, 0, 0, w); p.add(L[3], -0.18, 0, 0, w); }
      tailWag(p, w, t, 0.10, 0.18);
      ears(p, w, t, 0);
    }, { fade: 0.24 });

    // ---- sit ----
    this.anim.register('sit', (p, t, w) => {
      p.addPos(B.hips, 0, -0.30 * S, 0.06 * S, w);
      p.add(B.hips, -0.55, 0, 0, w);
      p.add(B.spine, 0.30, 0, 0, w);
      p.add(B.chest, 0.22, 0, 0, w);
      p.add(B.neck, -0.20, Math.sin(t * 0.4) * 0.08, 0, w);
      p.add(B.head, 0.06, Math.sin(t * 0.31) * 0.12, 0, w);
      for (const L of [B.rl, B.rr]) { p.add(L[1], 1.25, 0, 0, w); p.add(L[2], -1.55, 0, 0, w); p.add(L[3], 0.55, 0, 0, w); }
      for (const L of [B.fl, B.fr]) { p.add(L[1], -0.05, 0, 0, w); p.add(L[2], -0.05, 0, 0, w); }
      tailWag(p, w, t, 0.22, 0.34);
      ears(p, w, t, 0);
    }, { fade: 0.3 });

    /**
     * Quadruped gait. `pairs` gives the phase offset of each of the four legs;
     * a trot is diagonal (0, .5, .5, 0), a gallop is a rotary bound.
     */
    const gait = (cfg: {
      reach: number; lift: number; bodyBob: number; spineFlex: number;
      pairs: [number, number, number, number]; lean: number; tail: number;
    }) => (p: Pose, _t: number, w: number, ctx: { gait: number; time: number }) => {
      const g = ctx.gait * TAU;
      const legs = [B.fl, B.fr, B.rl, B.rr];
      const rear = [false, false, true, true];
      for (let i = 0; i < 4; i++) {
        const ph = g + cfg.pairs[i] * TAU;
        const swing = Math.sin(ph) * cfg.reach;
        const lift = Math.max(0, Math.sin(ph + 0.4)) ** 1.5 * cfg.lift;
        const L = legs[i];
        if (rear[i]) {
          p.add(L[1], -swing - 0.22 - lift * 0.5, 0, 0, w);
          p.add(L[2], 0.34 + lift * 1.5, 0, 0, w);
          p.add(L[3], -0.18 - lift * 0.7 + Math.max(0, -Math.sin(ph)) * 0.3, 0, 0, w);
        } else {
          p.add(L[1], swing + 0.04 + lift * 0.4, 0, 0, w);
          p.add(L[2], -0.12 - lift * 1.35, 0, 0, w);
          p.add(L[3], lift * 0.9 + Math.max(0, -Math.sin(ph)) * 0.25, 0, 0, w);
        }
      }
      const bob = Math.cos(g * 2) * cfg.bodyBob;
      p.addPos(B.hips, 0, bob * S, 0, w);
      p.add(B.hips, cfg.lean * 0.4 + Math.sin(g * 2) * cfg.spineFlex, 0, 0, w);
      p.add(B.spine, -Math.sin(g * 2) * cfg.spineFlex * 1.4, 0, 0, w);
      p.add(B.chest, Math.sin(g * 2) * cfg.spineFlex * 0.9 - cfg.lean * 0.3, 0, 0, w);
      p.add(B.neck, -cfg.lean * 0.5 - Math.cos(g * 2) * 0.05, 0, 0, w);
      p.add(B.head, cfg.lean * 0.35 + Math.cos(g * 2) * 0.04, 0, 0, w);
      tailWag(p, w, ctx.time, cfg.tail, 0.05 - cfg.lean * 0.4);
      ears(p, w, ctx.time, cfg.lean * 0.8);
    };

    this.anim.register('walk', gait({ reach: 0.36, lift: 0.30, bodyBob: 0.012, spineFlex: 0.04, pairs: [0, 0.5, 0.5, 0], lean: 0.0, tail: 0.16 }), { fade: 0.2 });
    this.anim.register('trot', gait({ reach: 0.52, lift: 0.52, bodyBob: 0.022, spineFlex: 0.07, pairs: [0, 0.5, 0.5, 0], lean: 0.10, tail: 0.10 }), { fade: 0.18 });
    this.anim.register('run', gait({ reach: 0.72, lift: 0.80, bodyBob: 0.045, spineFlex: 0.18, pairs: [0, 0.12, 0.55, 0.67], lean: 0.24, tail: 0.06 }), { fade: 0.18 });

    // ---- airborne ----
    this.anim.register('air', (p, t, w) => {
      p.add(B.hips, 0.12, 0, 0, w);
      p.add(B.spine, -0.12, 0, 0, w);
      p.add(B.chest, -0.10, 0, 0, w);
      p.add(B.neck, -0.18, 0, 0, w);
      for (const L of [B.fl, B.fr]) { p.add(L[1], -0.55, 0, 0, w); p.add(L[2], -0.75, 0, 0, w); }
      for (const L of [B.rl, B.rr]) { p.add(L[1], 0.45, 0, 0, w); p.add(L[2], 0.85, 0, 0, w); }
      tailWag(p, w, t, 0.05, -0.55);
    }, { fade: 0.14 });

    // ---- howl ----
    this.anim.register('howl', (p, t, w) => {
      const k = Math.sin(clamp01(t) * Math.PI) ** 0.6;
      p.add(B.neck, -0.95 * k, 0, 0, w);
      p.add(B.head, -0.55 * k, 0, 0, w);
      p.add(B.jaw, 0.42 * k, 0, 0, w);
      p.add(B.chest, -0.16 * k, 0, 0, w);
      p.addPos(B.hips, 0, -0.05 * k * S, 0, w);
      for (const L of [B.rl, B.rr]) { p.add(L[1], 0.25 * k, 0, 0, w); p.add(L[2], -0.15 * k, 0, 0, w); }
      tailWag(p, w, t, 0.06, 0.45 * k);
      p.add(B.earL, -0.4 * k, 0, -0.2 * k, w);
      p.add(B.earR, -0.4 * k, 0, 0.2 * k, w);
    }, { fade: 0.2, once: true, duration: 2.2 });

    // ---- lunge attack ----
    this.anim.register('lunge', (p, t, w) => {
      const wind = smoothstep(0, 0.22, t) * (1 - smoothstep(0.22, 0.42, t));
      const snap = smoothstep(0.24, 0.44, t) * (1 - smoothstep(0.62, 1, t));
      p.add(B.hips, -0.35 * wind + 0.40 * snap, 0, 0, w);
      p.add(B.spine, -0.28 * wind + 0.34 * snap, 0, 0, w);
      p.add(B.chest, -0.22 * wind + 0.30 * snap, 0, 0, w);
      p.add(B.neck, 0.30 * wind - 0.52 * snap, 0, 0, w);
      p.add(B.head, 0.20 * wind - 0.30 * snap, 0, 0, w);
      p.add(B.jaw, 0.15 * wind + 0.62 * snap, 0, 0, w);
      for (const L of [B.fl, B.fr]) { p.add(L[1], 0.6 * wind - 0.9 * snap, 0, 0, w); p.add(L[2], -0.7 * wind - 0.5 * snap, 0, 0, w); }
      for (const L of [B.rl, B.rr]) { p.add(L[1], -0.9 * wind + 0.5 * snap, 0, 0, w); p.add(L[2], 1.1 * wind - 0.3 * snap, 0, 0, w); }
      tailWag(p, w, t, 0.05, -0.4 * snap + 0.3 * wind);
    }, { fade: 0.08, once: true, duration: 0.62 });

    // ---- hurt ----
    this.anim.register('hurt', (p, t, w) => {
      const k = Math.exp(-t * 6) * (1 - smoothstep(0.6, 1, t));
      p.add(B.hips, -0.25 * k, 0.2 * k, 0, w);
      p.add(B.spine, 0.3 * k, -0.2 * k, 0, w);
      p.add(B.neck, 0.35 * k, 0.2 * k, 0, w);
      p.add(B.head, 0.25 * k, 0, 0, w);
      tailWag(p, w, t, 0.02, 0.9 * k);
      p.add(B.earL, -0.8 * k, 0, -0.4 * k, w);
      p.add(B.earR, -0.8 * k, 0, 0.4 * k, w);
    }, { fade: 0.06, once: true, duration: 0.5 });
  }

  advanceGait(dt: number, speed: number) {
    this.gait = (this.gait + (speed * dt) / (1.55 * S)) % 1;
  }

  update(dt: number) {
    this.anim.ctx.gait = this.gait;
    this.anim.update(dt);

    // head look-at layered on top
    if (this.lookTarget && this.lookWeight > 0.01) {
      this.group.updateMatrixWorld(true);
      const v = this.lookTarget.clone();
      this.group.worldToLocal(v);
      const yaw = Math.atan2(-v.x, -v.z);
      const dist = Math.hypot(v.x, v.z);
      const pitch = Math.atan2(v.y - 0.8 * S, dist);
      this.lookYaw = damp(this.lookYaw, THREE.MathUtils.clamp(yaw, -1.2, 1.2), 8, dt);
      this.lookPitch = damp(this.lookPitch, THREE.MathUtils.clamp(pitch, -0.5, 0.7), 8, dt);
      const lw = this.lookWeight;
      this.rig.get('head').rotateY(this.lookYaw * 0.6 * lw);
      this.rig.get('head').rotateX(-this.lookPitch * 0.5 * lw);
      this.rig.get('neck').rotateY(this.lookYaw * 0.32 * lw);
      this.rig.get('neck').rotateX(-this.lookPitch * 0.3 * lw);
    }

    // the tail lags behind turns
    const yaw = this.group.rotation.y;
    let d = yaw - this.prevYaw;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.prevYaw = yaw;
    this.yawLag = lerp(this.yawLag, THREE.MathUtils.clamp(d / Math.max(dt, 1e-3), -6, 6), 1 - Math.exp(-dt * 8));
    for (let i = 0; i < 4; i++) {
      const f = (i + 1) / 4;
      this.rig.get(`tail${i + 1}`).rotateY(this.yawLag * 0.055 * f);
    }
  }

  bonePos(name: string, out = new THREE.Vector3()) {
    const b = this.rig.get(name);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material[]).forEach((m) => m.dispose());
  }
}

export { S as WOLF_SCALE };
