/**
 * REALMS — humanoid base: skeleton, body mesh and the shared animation library.
 *
 * The player, the villagers and every humanoid enemy share this skeleton and
 * this animation set; they differ only in proportions, materials and the gear
 * layered on top. Every clip is written by hand as a function of phase, which
 * costs nothing to load and lets combat drive timing directly (an attack's
 * damage window is literally a slice of its animation phase).
 */

import * as THREE from 'three';
import { Animator, Pose, Rig, type AnimCtx, type BoneDef, type SkinSegment } from './rig';
import { limb, tube, skull, roundedBox, mirrorX, at, V, mergeGeometries } from './geom';
import { clamp01, lerp, smoothstep, TAU } from '../core/math';

export interface HumanoidProfile {
  height: number;        // eye-to-heel scale reference, ~1.85 for the player
  shoulder: number;      // half-width at the shoulders
  hip: number;
  bulk: number;          // limb thickness multiplier
  neck: number;
  headScale: number;
  armLength: number;
  legLength: number;
  hunch: number;         // forward lean baked into the bind pose
}

export const PLAYER_PROFILE: HumanoidProfile = {
  height: 1.86, shoulder: 0.235, hip: 0.135, bulk: 1.0,
  neck: 0.055, headScale: 1.0, armLength: 1.0, legLength: 1.0, hunch: 0.0,
};

export function humanoidBones(p: HumanoidProfile): BoneDef[] {
  const s = p.height / 1.86;
  const y = (v: number) => v * s;
  const L = p.legLength, A = p.armLength;
  const sh = p.shoulder * s;
  const hp = p.hip * s;
  return [
    { name: 'root', parent: null, head: [0, 0, 0] },
    { name: 'hips', parent: 'root', head: [0, y(0.99) * L, 0] },
    { name: 'spine', parent: 'hips', head: [0, y(1.13) * L, y(-0.005)] },
    { name: 'chest', parent: 'spine', head: [0, y(1.32) * L, y(-0.012)] },
    { name: 'neck', parent: 'chest', head: [0, y(1.505) * L, y(0.0)] },
    { name: 'head', parent: 'neck', head: [0, y(1.575) * L, y(0.008)] },
    { name: 'headTop', parent: 'head', head: [0, y(1.80) * L, y(0.008)] },

    { name: 'clavL', parent: 'chest', head: [sh * 0.30, y(1.455) * L, 0] },
    { name: 'upperArmL', parent: 'clavL', head: [sh, y(1.442) * L, 0] },
    { name: 'lowerArmL', parent: 'upperArmL', head: [sh + 0.006, y(1.442) * L - y(0.27) * A, y(0.012)] },
    { name: 'handL', parent: 'lowerArmL', head: [sh + 0.010, y(1.442) * L - y(0.52) * A, y(0.020)] },
    { name: 'fingersL', parent: 'handL', head: [sh + 0.010, y(1.442) * L - y(0.63) * A, y(0.022)] },

    { name: 'clavR', parent: 'chest', head: [-sh * 0.30, y(1.455) * L, 0] },
    { name: 'upperArmR', parent: 'clavR', head: [-sh, y(1.442) * L, 0] },
    { name: 'lowerArmR', parent: 'upperArmR', head: [-sh - 0.006, y(1.442) * L - y(0.27) * A, y(0.012)] },
    { name: 'handR', parent: 'lowerArmR', head: [-sh - 0.010, y(1.442) * L - y(0.52) * A, y(0.020)] },
    { name: 'fingersR', parent: 'handR', head: [-sh - 0.010, y(1.442) * L - y(0.63) * A, y(0.022)] },
    { name: 'gripR', parent: 'handR', head: [-sh - 0.010, y(1.442) * L - y(0.56) * A, y(0.020)] },

    { name: 'upperLegL', parent: 'hips', head: [hp, y(0.955) * L, 0] },
    { name: 'lowerLegL', parent: 'upperLegL', head: [hp + 0.004, y(0.545) * L, y(0.012)] },
    { name: 'footL', parent: 'lowerLegL', head: [hp + 0.006, y(0.095) * L, y(-0.012)] },
    { name: 'toeL', parent: 'footL', head: [hp + 0.006, y(0.030) * L, y(-0.145)] },

    { name: 'upperLegR', parent: 'hips', head: [-hp, y(0.955) * L, 0] },
    { name: 'lowerLegR', parent: 'upperLegR', head: [-hp - 0.004, y(0.545) * L, y(0.012)] },
    { name: 'footR', parent: 'lowerLegR', head: [-hp - 0.006, y(0.095) * L, y(-0.012)] },
    { name: 'toeR', parent: 'footR', head: [-hp - 0.006, y(0.030) * L, y(-0.145)] },

    { name: 'cloak1', parent: 'chest', head: [0, y(1.40) * L, y(0.07)] },
    { name: 'cloak2', parent: 'cloak1', head: [0, y(1.05) * L, y(0.10)] },
    { name: 'cloak3', parent: 'cloak2', head: [0, y(0.66) * L, y(0.13)] },
    { name: 'cloak4', parent: 'cloak3', head: [0, y(0.28) * L, y(0.16)] },
  ];
}

/* ------------------------------------------------------------------ *
 * Body mesh
 * ------------------------------------------------------------------ */

export function humanoidBody(rig: Rig, p: HumanoidProfile) {
  const w = (n: string) => rig.worldOf(n).clone();
  const b = p.bulk;
  const s = p.height / 1.86;

  const hips = w('hips'), spine = w('spine'), chest = w('chest'), neck = w('neck'), head = w('head');

  // --- torso: a swept tube with an elliptical cross-section ---
  const torsoPath = [
    V(0, hips.y - 0.10 * s, 0.005),
    V(0, hips.y + 0.02 * s, 0.0),
    spine.clone(),
    V(0, (spine.y + chest.y) / 2, chest.z - 0.004),
    chest.clone(),
    V(0, chest.y + 0.10 * s, chest.z + 0.004),
    V(0, neck.y - 0.005 * s, 0),
  ];
  const torsoR = [0.150, 0.145, 0.140, 0.150, 0.163, 0.158, 0.108].map((r) => r * s * b);
  const squashX = [1.18, 1.24, 1.22, 1.26, 1.34, 1.26, 0.92];
  const squashZ = [0.86, 0.84, 0.80, 0.78, 0.80, 0.80, 0.86];
  const torso = tube(torsoPath, torsoR, { radial: 16, squashX, squashZ });

  // --- neck & head ---
  const neckGeo = limb(V(0, neck.y - 0.03 * s, 0), V(0, head.y - 0.015 * s, head.z), 0.062 * s * b, 0.055 * s * b, 10);
  const headGeo = skull(0.118 * s * p.headScale);
  headGeo.translate(head.x, head.y + 0.085 * s * p.headScale, head.z);

  // --- arms ---
  const mkArm = (side: 1 | -1) => {
    const sfx = side > 0 ? 'L' : 'R';
    const sh = w('upperArmL').clone(); sh.x *= side;
    const el = w('lowerArmL').clone(); el.x *= side;
    const hd = w('handL').clone(); hd.x *= side;
    const fg = w('fingersL').clone(); fg.x *= side;
    const upper = limb(sh, el, 0.070 * s * b, 0.052 * s * b, 10, 1.10);
    const lower = limb(el, hd, 0.052 * s * b, 0.040 * s * b, 10, 1.06);
    const palm = roundedBox(0.055 * s * b, 0.115 * s, 0.085 * s * b, 0.5, 2);
    palm.translate(hd.x, (hd.y + fg.y) / 2, hd.z);
    const shoulderCap = new THREE.SphereGeometry(0.078 * s * b, 12, 10);
    shoulderCap.translate(sh.x, sh.y, sh.z);
    void sfx;
    return [upper, lower, palm, shoulderCap];
  };

  // --- legs ---
  const mkLeg = (side: 1 | -1) => {
    const hip = w('upperLegL').clone(); hip.x *= side;
    const knee = w('lowerLegL').clone(); knee.x *= side;
    const foot = w('footL').clone(); foot.x *= side;
    const toe = w('toeL').clone(); toe.x *= side;
    const thigh = limb(hip, knee, 0.098 * s * b, 0.066 * s * b, 12, 1.08);
    const shin = limb(knee, foot, 0.066 * s * b, 0.048 * s * b, 12, 1.10);
    const boot = roundedBox(0.088 * s * b, 0.075 * s, 0.24 * s, 0.35, 2);
    boot.translate(foot.x, foot.y - 0.018 * s, (foot.z + toe.z) / 2 - 0.01 * s);
    return [thigh, shin, boot];
  };

  // ears, so the bald silhouette does not read as a mannequin
  const ears: THREE.BufferGeometry[] = [];
  for (const side of [1, -1] as const) {
    const e = new THREE.SphereGeometry(0.030 * s, 10, 8);
    e.scale(0.42, 1.20, 0.85);
    e.translate(side * 0.104 * s * p.headScale, head.y + 0.082 * s, head.z - 0.006 * s);
    ears.push(e);
  }

  const armL = mkArm(1), armR = mkArm(-1);
  const legL = mkLeg(1), legR = mkLeg(-1);
  return {
    // bare skin: head, ears and the hands
    skin: [headGeo, ...ears, armL[2], armR[2]],
    // everything else wears the dark under-layer
    suit: [
      torso, neckGeo,
      armL[0], armL[1], armL[3], armR[0], armR[1], armR[3],
      ...legL, ...legR,
    ],
  };
}

/** Skin weight segments derived from the bind skeleton. */
export function humanoidSegments(rig: Rig, p: HumanoidProfile): SkinSegment[] {
  const s = p.height / 1.86;
  const w = (n: string) => rig.worldOf(n);
  const seg = (bone: string, a: THREE.Vector3, bb: THREE.Vector3, radius: number, falloff = 2.4): SkinSegment =>
    ({ bone, a: a.clone(), b: bb.clone(), radius: radius * s, falloff });
  const out: SkinSegment[] = [
    seg('hips', w('hips').clone().setY(w('hips').y - 0.13 * s), w('spine'), 0.30),
    seg('spine', w('spine'), w('chest'), 0.30),
    seg('chest', w('chest'), w('neck'), 0.34),
    seg('neck', w('neck'), w('head'), 0.13),
    seg('head', w('head'), w('headTop'), 0.24, 1.6),
  ];
  for (const side of ['L', 'R'] as const) {
    out.push(
      seg(`clav${side}`, w(`clav${side}`), w(`upperArm${side}`), 0.12),
      seg(`upperArm${side}`, w(`upperArm${side}`), w(`lowerArm${side}`), 0.155),
      seg(`lowerArm${side}`, w(`lowerArm${side}`), w(`hand${side}`), 0.125),
      seg(`hand${side}`, w(`hand${side}`), w(`fingers${side}`), 0.115, 1.8),
      seg(`upperLeg${side}`, w(`upperLeg${side}`), w(`lowerLeg${side}`), 0.20),
      seg(`lowerLeg${side}`, w(`lowerLeg${side}`), w(`foot${side}`), 0.155),
      seg(`foot${side}`, w(`foot${side}`), w(`toe${side}`), 0.16, 1.8),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Animation library
 * ------------------------------------------------------------------ */

export interface BoneIds {
  hips: number; spine: number; chest: number; neck: number; head: number;
  clavL: number; clavR: number;
  armL: number; armR: number; foreL: number; foreR: number; handL: number; handR: number;
  legL: number; legR: number; shinL: number; shinR: number; footL: number; footR: number;
  toeL: number; toeR: number;
  cloak: number[];
}

export function boneIds(rig: Rig): BoneIds {
  const i = (n: string) => rig.idx(n);
  return {
    hips: i('hips'), spine: i('spine'), chest: i('chest'), neck: i('neck'), head: i('head'),
    clavL: i('clavL'), clavR: i('clavR'),
    armL: i('upperArmL'), armR: i('upperArmR'),
    foreL: i('lowerArmL'), foreR: i('lowerArmR'),
    handL: i('handL'), handR: i('handR'),
    legL: i('upperLegL'), legR: i('upperLegR'),
    shinL: i('lowerLegL'), shinR: i('lowerLegR'),
    footL: i('footL'), footR: i('footR'),
    toeL: i('toeL'), toeR: i('toeR'),
    cloak: [i('cloak1'), i('cloak2'), i('cloak3'), i('cloak4')],
  };
}

const sin = Math.sin, cos = Math.cos;

/**
 * Register the full humanoid clip set on an animator.
 * `combatStance` gives enemies and the armed player a weapon-forward guard.
 */
export function registerHumanoidAnims(anim: Animator, rig: Rig, opts: { armed?: boolean; scale?: number } = {}) {
  const B = boneIds(rig);
  const armed = opts.armed ?? true;

  /** Neutral guard the other clips are drawn toward. */
  const guard = (p: Pose, w: number) => {
    p.add(B.armR, -0.55, -0.14, armed ? -0.62 : -0.10, w);
    p.add(B.foreR, -1.02, 0.10, -0.16, w);
    p.add(B.handR, 0.12, 0.0, armed ? 0.42 : 0.0, w);
    p.add(B.armL, -0.20, 0.10, 0.20, w);
    p.add(B.foreL, -0.62, -0.06, 0.10, w);
    p.add(B.handL, 0.08, 0, -0.08, w);
  };

  const cloakSettle = (p: Pose, w: number, t: number, lean: number) => {
    for (let i = 0; i < B.cloak.length; i++) {
      const f = (i + 1) / B.cloak.length;
      p.add(B.cloak[i], 0.06 * f + lean * 0.5 * f + sin(t * 1.4 + i) * 0.02, sin(t * 0.9 + i * 1.7) * 0.03, 0, w);
    }
  };

  // ---------------- idle ----------------
  anim.register('idle', (p, t, w, ctx) => {
    const breath = sin(t * 1.35);
    const sway = sin(t * 0.52);
    p.add(B.hips, 0.01 + breath * 0.006, sway * 0.03, sway * 0.012, w);
    p.addPos(B.hips, 0, breath * 0.008, 0, w);
    p.add(B.spine, 0.02 + breath * 0.012, -sway * 0.02, 0, w);
    p.add(B.chest, 0.01 + breath * 0.016, -sway * 0.02, 0, w);
    p.add(B.neck, -0.04 - breath * 0.01, sway * 0.05, 0, w);
    p.add(B.head, -0.02, sin(t * 0.31) * 0.16, sin(t * 0.23) * 0.03, w);
    guard(p, w);
    p.add(B.armR, breath * 0.02, 0, 0, w);
    p.add(B.armL, breath * 0.02, 0, 0, w);
    p.add(B.legL, 0.02, 0, 0.045, w);
    p.add(B.legR, 0.02, 0, -0.045, w);
    p.add(B.shinL, -0.05, 0, 0, w);
    p.add(B.shinR, -0.05, 0, 0, w);
    cloakSettle(p, w, t, 0);
    void ctx;
  }, { fade: 0.22 });

  // ---------------- walk / run ----------------
  const locomotion = (stride: number, lean: number, armSwing: number, bounce: number, liftScale: number) =>
    (p: Pose, _t: number, w: number, ctx: AnimCtx) => {
      const g = ctx.gait * TAU;
      const bob = cos(g * 2) * bounce;
      const lift = (ph: number) => Math.max(0, sin(ph)) ** 1.4;

      p.addPos(B.hips, 0, bob, 0, w);
      p.add(B.hips, lean * 0.55 + cos(g * 2) * 0.02, sin(g) * 0.09, sin(g) * 0.05, w);
      p.add(B.spine, lean * 0.35, -sin(g) * 0.07, 0, w);
      p.add(B.chest, lean * 0.30, -sin(g) * 0.10, 0, w);
      p.add(B.neck, -lean * 0.55, 0, 0, w);
      p.add(B.head, -lean * 0.35 + cos(g * 2) * 0.02, sin(g) * 0.04, 0, w);

      // legs: swing + knee lift, with a heel-strike/toe-off roll
      const legPhase = [g, g + Math.PI];
      const legs = [
        { hip: B.legL, shin: B.shinL, foot: B.footL, toe: B.toeL, sgn: 1 },
        { hip: B.legR, shin: B.shinR, foot: B.footR, toe: B.toeR, sgn: -1 },
      ];
      for (let i = 0; i < 2; i++) {
        const ph = legPhase[i];
        const L = legs[i];
        const swing = sin(ph) * stride;
        const knee = -lift(ph + 0.5) * 1.05 * liftScale - 0.06;
        p.add(L.hip, swing - lean * 0.5, 0, L.sgn * 0.03, w);
        p.add(L.shin, knee, 0, 0, w);
        const plant = smoothstep(0.1, -0.6, sin(ph));
        p.add(L.foot, -swing * 0.35 + plant * 0.22 + lift(ph + 0.5) * 0.32, 0, 0, w);
        p.add(L.toe, Math.max(0, -sin(ph)) * 0.42, 0, 0, w);
      }

      // arms counter-swing
      const aR = -sin(g) * armSwing;
      const aL = sin(g) * armSwing;
      guard(p, w * 0.55);
      p.add(B.armR, aR * 0.9 - 0.30 - lean * 0.3, -0.10, armed ? -0.5 : -0.10, w * 0.45);
      p.add(B.foreR, -0.75 - Math.max(0, aR) * 0.5, 0.08, -0.14, w * 0.45);
      p.add(B.armL, aL * 1.0 - 0.16 - lean * 0.3, 0.10, 0.18, w * 0.45);
      p.add(B.foreL, -0.55 - Math.max(0, aL) * 0.7, -0.05, 0.08, w * 0.45);
      p.add(B.clavL, 0, 0, sin(g) * 0.03, w);
      p.add(B.clavR, 0, 0, sin(g) * 0.03, w);
      cloakSettle(p, w, ctx.time, lean * 1.4 + 0.25);
    };

  anim.register('walk', locomotion(0.62, 0.06, 0.42, 0.030, 1.0), { fade: 0.18 });
  anim.register('run', locomotion(0.86, 0.20, 0.72, 0.052, 1.25), { fade: 0.18 });
  anim.register('sprint', locomotion(1.02, 0.34, 0.95, 0.070, 1.45), { fade: 0.18 });

  // ---------------- strafing (locked on) ----------------
  anim.register('strafe', (p, _t, w, ctx) => {
    const g = ctx.gait * TAU;
    const dir = Math.sign(ctx.strafe) || 1;
    p.addPos(B.hips, 0, cos(g * 2) * 0.022, 0, w);
    p.add(B.hips, 0.05, -dir * 0.22, 0, w);
    p.add(B.spine, 0.03, dir * 0.10, 0, w);
    p.add(B.chest, 0.02, dir * 0.16, 0, w);
    p.add(B.head, 0, -dir * 0.26, 0, w);
    for (let i = 0; i < 2; i++) {
      const ph = g + i * Math.PI;
      const L = i === 0
        ? { hip: B.legL, shin: B.shinL, foot: B.footL, sgn: 1 }
        : { hip: B.legR, shin: B.shinR, foot: B.footR, sgn: -1 };
      p.add(L.hip, sin(ph) * 0.28, 0, L.sgn * 0.18 + sin(ph) * dir * 0.22, w);
      p.add(L.shin, -Math.max(0, sin(ph + 0.5)) * 0.7 - 0.1, 0, 0, w);
      p.add(L.foot, 0.1, 0, 0, w);
    }
    guard(p, w);
    cloakSettle(p, w, ctx.time, 0.2);
  }, { fade: 0.18 });

  // ---------------- air ----------------
  anim.register('jump', (p, _t, w, ctx) => {
    const rise = clamp01(ctx.extra.rise ?? 0.5);
    p.add(B.hips, -0.12 + rise * 0.10, 0, 0, w);
    p.add(B.spine, -0.10, 0, 0, w);
    p.add(B.chest, -0.06, 0, 0, w);
    p.add(B.armR, -1.5 + rise * 0.6, -0.3, -0.5, w);
    p.add(B.foreR, -0.9, 0, 0, w);
    p.add(B.armL, -1.9 + rise * 0.5, 0.35, 0.5, w);
    p.add(B.foreL, -0.7, 0, 0, w);
    p.add(B.legL, -0.55 + rise * 0.85, 0, 0.06, w);
    p.add(B.legR, -0.20 + rise * 0.35, 0, -0.06, w);
    p.add(B.shinL, -1.15 + rise * 0.7, 0, 0, w);
    p.add(B.shinR, -0.55 + rise * 0.35, 0, 0, w);
    p.add(B.footL, 0.35, 0, 0, w);
    p.add(B.footR, 0.20, 0, 0, w);
    cloakSettle(p, w, ctx.time, -0.5);
  }, { fade: 0.12 });

  anim.register('fall', (p, t, w, ctx) => {
    p.add(B.hips, 0.10, sin(t * 2.1) * 0.05, 0, w);
    p.add(B.chest, -0.16, 0, 0, w);
    p.add(B.armR, -2.1, -0.5, -0.6, w);
    p.add(B.foreR, -0.5, 0, 0, w);
    p.add(B.armL, -2.3, 0.5, 0.6, w);
    p.add(B.foreL, -0.4, 0, 0, w);
    p.add(B.legL, -0.35, 0, 0.10, w);
    p.add(B.legR, 0.20, 0, -0.10, w);
    p.add(B.shinL, -0.85, 0, 0, w);
    p.add(B.shinR, -0.35, 0, 0, w);
    cloakSettle(p, w, ctx.time, -0.9);
  }, { fade: 0.16 });

  anim.register('land', (p, t, w, ctx) => {
    const k = Math.exp(-t * 7.5) * (1 - t);
    p.addPos(B.hips, 0, -0.20 * k, 0, w);
    p.add(B.hips, 0.32 * k, 0, 0, w);
    p.add(B.spine, 0.16 * k, 0, 0, w);
    p.add(B.chest, 0.10 * k, 0, 0, w);
    p.add(B.legL, 0.72 * k, 0, 0.12, w);
    p.add(B.legR, 0.72 * k, 0, -0.12, w);
    p.add(B.shinL, -1.5 * k, 0, 0, w);
    p.add(B.shinR, -1.5 * k, 0, 0, w);
    p.add(B.footL, 0.72 * k, 0, 0, w);
    p.add(B.footR, 0.72 * k, 0, 0, w);
    p.add(B.armR, -0.9 * k, 0, -0.3 * k, w);
    p.add(B.armL, -0.9 * k, 0, 0.3 * k, w);
    cloakSettle(p, w, ctx.time, 0.6 * k);
  }, { fade: 0.10, once: true, duration: 0.45 });

  // ---------------- dodge roll ----------------
  anim.register('roll', (p, t, w, ctx) => {
    const k = smoothstep(0, 0.25, t) * smoothstep(1.0, 0.72, t);
    const tuck = Math.sin(clamp01(t) * Math.PI);
    p.add(B.hips, 1.1 * tuck, 0, 0, w);
    p.add(B.spine, 0.75 * tuck, 0, 0, w);
    p.add(B.chest, 0.55 * tuck, 0, 0, w);
    p.add(B.neck, 0.45 * tuck, 0, 0, w);
    p.add(B.legL, 1.5 * tuck + 0.1, 0, 0.15, w);
    p.add(B.legR, 1.35 * tuck + 0.1, 0, -0.15, w);
    p.add(B.shinL, -2.0 * tuck, 0, 0, w);
    p.add(B.shinR, -2.2 * tuck, 0, 0, w);
    p.add(B.armR, -0.5 - 1.1 * tuck, -0.4, -0.8, w);
    p.add(B.foreR, -1.5 * tuck - 0.5, 0, 0, w);
    p.add(B.armL, -0.5 - 1.3 * tuck, 0.4, 0.8, w);
    p.add(B.foreL, -1.6 * tuck - 0.5, 0, 0, w);
    cloakSettle(p, w, ctx.time, -1.2 * k);
  }, { fade: 0.07, once: true, duration: 0.62 });

  // ---------------- attacks ----------------
  /** Shared swing shape: wind up, snap through, recover. */
  const swing = (cfg: {
    windup: number; strike: number;
    startArm: [number, number, number]; endArm: [number, number, number];
    startFore: number; endFore: number;
    torso: [number, number]; hips: [number, number];
    lead?: number;
  }) => (p: Pose, t: number, w: number, ctx: AnimCtx) => {
    const wu = cfg.windup, st = cfg.strike;
    let phase: number;
    if (t < wu) phase = -smoothstep(0, wu, t);                          // -1 .. 0 windup
    else if (t < st) phase = smoothstep(wu, st, t) * 1.0;               // 0 .. 1 strike
    else phase = 1 - smoothstep(st, 1, t) * 1.0;                        // recover
    const back = Math.max(0, -phase);
    const fwd = Math.max(0, phase);
    const snap = fwd * fwd * (3 - 2 * fwd);

    const arm: [number, number, number] = [
      lerp(cfg.startArm[0], cfg.endArm[0], snap) - back * 0.5,
      lerp(cfg.startArm[1], cfg.endArm[1], snap) - back * 0.25,
      lerp(cfg.startArm[2], cfg.endArm[2], snap) - back * 0.5,
    ];
    p.add(B.armR, arm[0], arm[1], arm[2], w);
    p.add(B.foreR, lerp(cfg.startFore, cfg.endFore, snap), 0.1, -0.1, w);
    p.add(B.handR, 0.1, 0, 0.35, w);

    const twist = lerp(cfg.torso[0], cfg.torso[1], snap) - back * 0.35;
    p.add(B.chest, 0.06, twist, twist * 0.18, w);
    p.add(B.spine, 0.04, twist * 0.55, 0, w);
    p.add(B.hips, lerp(cfg.hips[0], cfg.hips[1], snap) * 0.0 + 0.02, lerp(cfg.hips[0], cfg.hips[1], snap), 0, w);
    p.add(B.neck, -0.05, -twist * 0.35, 0, w);
    p.add(B.head, 0, -twist * 0.25, 0, w);

    p.add(B.armL, -0.4 - back * 0.4 + snap * 0.5, 0.5 + twist * 0.3, 0.6, w);
    p.add(B.foreL, -1.1 - back * 0.4, 0, 0, w);

    const lead = cfg.lead ?? 1;
    p.add(B.legL, (0.24 * snap - 0.10 * back) * lead, 0, 0.10, w);
    p.add(B.legR, (-0.20 * snap + 0.14 * back) * lead, 0, -0.10, w);
    p.add(B.shinL, -0.30 - 0.20 * snap, 0, 0, w);
    p.add(B.shinR, -0.22 - 0.10 * back, 0, 0, w);
    cloakSettle(p, w, ctx.time, -0.4 * snap + 0.3 * back);
  };

  anim.register('attack1', swing({
    windup: 0.24, strike: 0.46,
    startArm: [-1.55, -0.55, -1.30], endArm: [0.55, 0.55, 0.75],
    startFore: -1.55, endFore: -0.22,
    torso: [-0.55, 0.62], hips: [-0.22, 0.26],
  }), { fade: 0.06, once: true, duration: 0.60 });

  anim.register('attack2', swing({
    windup: 0.22, strike: 0.42,
    startArm: [0.35, 0.85, 1.05], endArm: [-0.95, -0.75, -1.25],
    startFore: -0.35, endFore: -1.30,
    torso: [0.62, -0.66], hips: [0.24, -0.28],
    lead: -1,
  }), { fade: 0.06, once: true, duration: 0.56 });

  anim.register('attack3', (p, t, w, ctx) => {
    // overhead cleave with a step-through and a hard stop
    const wu = 0.34, st = 0.56;
    let phase: number;
    if (t < wu) phase = -smoothstep(0, wu, t);
    else if (t < st) phase = smoothstep(wu, st, t);
    else phase = 1 - smoothstep(st, 1, t) * 0.85;
    const back = Math.max(0, -phase);
    const fwd = Math.max(0, phase);
    const snap = fwd * fwd * (3 - 2 * fwd);
    p.add(B.armR, lerp(-2.55, 1.30, snap) - back * 0.4, -0.15, -0.35 + snap * 0.3, w);
    p.add(B.foreR, lerp(-0.55, -0.20, snap), 0, 0, w);
    p.add(B.handR, 0.1, 0, 0.3, w);
    p.add(B.armL, lerp(-2.35, 1.05, snap), 0.35, 0.45, w);
    p.add(B.foreL, lerp(-0.75, -0.35, snap), 0, 0, w);
    p.add(B.chest, lerp(-0.42, 0.55, snap), 0.05, 0, w);
    p.add(B.spine, lerp(-0.30, 0.42, snap), 0, 0, w);
    p.add(B.hips, lerp(-0.16, 0.26, snap), 0, 0, w);
    p.add(B.neck, lerp(0.30, -0.30, snap), 0, 0, w);
    p.addPos(B.hips, 0, -0.10 * snap, 0, w);
    p.add(B.legL, 0.55 * snap - 0.2 * back, 0, 0.12, w);
    p.add(B.legR, -0.30 * snap + 0.30 * back, 0, -0.12, w);
    p.add(B.shinL, -0.85 * snap - 0.2, 0, 0, w);
    p.add(B.shinR, -0.35 - 0.25 * back, 0, 0, w);
    cloakSettle(p, w, ctx.time, -0.7 * snap + 0.5 * back);
  }, { fade: 0.06, once: true, duration: 0.78 });

  // ---------------- ability cast ----------------
  anim.register('cast', (p, t, w, ctx) => {
    const rise = smoothstep(0, 0.4, t);
    const hold = smoothstep(0.35, 0.5, t) * smoothstep(1.0, 0.7, t);
    const push = smoothstep(0.45, 0.62, t) * smoothstep(1.0, 0.78, t);
    p.add(B.armL, -1.15 * rise - 0.6 * push, 0.35 + 0.2 * hold, 0.45 - 0.3 * push, w);
    p.add(B.foreL, -0.85 + 0.55 * push, 0, 0, w);
    p.add(B.handL, 0.3 * hold, 0, 0, w);
    p.add(B.armR, -0.75 - 0.25 * rise, -0.2, -0.7, w);
    p.add(B.foreR, -1.15, 0, 0, w);
    p.add(B.chest, -0.16 * rise + 0.22 * push, 0.18 * rise - 0.28 * push, 0, w);
    p.add(B.spine, -0.10 * rise + 0.12 * push, 0.1 * rise, 0, w);
    p.add(B.head, -0.20 * rise + 0.15 * push, 0.10 * rise, 0, w);
    p.add(B.legL, 0.10, 0, 0.10, w);
    p.add(B.legR, -0.12, 0, -0.10, w);
    p.add(B.shinL, -0.22, 0, 0, w);
    p.add(B.shinR, -0.18, 0, 0, w);
    cloakSettle(p, w, ctx.time, -0.35 * rise + 0.5 * push);
  }, { fade: 0.09, once: true, duration: 0.75 });

  // ---------------- reactions ----------------
  anim.register('hurt', (p, t, w, ctx) => {
    const k = Math.exp(-t * 6) * (1 - smoothstep(0.6, 1, t));
    p.add(B.hips, -0.22 * k, 0.10 * k, 0, w);
    p.add(B.spine, -0.30 * k, -0.14 * k, 0.10 * k, w);
    p.add(B.chest, -0.36 * k, -0.18 * k, 0.14 * k, w);
    p.add(B.neck, -0.30 * k, 0, 0, w);
    p.add(B.head, -0.30 * k, 0.14 * k, 0, w);
    p.add(B.armR, -0.55 * k, 0, -0.35 * k, w);
    p.add(B.armL, -0.75 * k, 0, 0.45 * k, w);
    p.add(B.foreL, -0.55 * k, 0, 0, w);
    p.add(B.legL, -0.18 * k, 0, 0.1, w);
    p.add(B.legR, 0.12 * k, 0, -0.1, w);
    cloakSettle(p, w, ctx.time, 0.5 * k);
  }, { fade: 0.05, once: true, duration: 0.5 });

  anim.register('death', (p, t, w, ctx) => {
    const k = smoothstep(0, 0.55, t);
    const s = smoothstep(0.15, 0.8, t);
    p.add(B.hips, 0.35 * k + 0.5 * s, 0.35 * k, 0.6 * s, w);
    p.addPos(B.hips, 0, -0.62 * s, 0, w);
    p.add(B.spine, 0.35 * k, -0.2 * k, 0.25 * s, w);
    p.add(B.chest, 0.30 * k, -0.25 * k, 0.2 * s, w);
    p.add(B.neck, -0.45 * k, 0.2 * k, 0, w);
    p.add(B.head, 0.35 * s, 0.3 * k, 0, w);
    p.add(B.armR, -0.35 - 0.9 * s, 0.2, -0.9 * s, w);
    p.add(B.armL, -0.35 - 1.1 * s, -0.2, 0.9 * s, w);
    p.add(B.legL, 0.9 * s, 0, 0.35 * s, w);
    p.add(B.legR, 0.5 * s, 0, -0.25 * s, w);
    p.add(B.shinL, -1.5 * s, 0, 0, w);
    p.add(B.shinR, -0.9 * s, 0, 0, w);
    cloakSettle(p, w, ctx.time, 0.4 * s);
  }, { fade: 0.14, once: true, duration: 2.4 });

  return B;
}

/** Merge a list of geometries into one non-indexed buffer with material groups. */
export function mergeParts(groups: THREE.BufferGeometry[][]) {
  const merged: THREE.BufferGeometry[] = [];
  for (const g of groups) {
    const flat = g.filter(Boolean).map((x) => {
      const c = x.index ? x.toNonIndexed() : x;
      // normalise the attribute set so merging never fails
      const keep = new THREE.BufferGeometry();
      keep.setAttribute('position', c.getAttribute('position'));
      keep.setAttribute('normal', c.getAttribute('normal'));
      const uv = c.getAttribute('uv');
      keep.setAttribute('uv', uv ?? new THREE.Float32BufferAttribute(new Float32Array(c.getAttribute('position').count * 2), 2));
      return keep;
    });
    if (flat.length === 0) {
      const empty = new THREE.BufferGeometry();
      empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
      empty.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
      merged.push(empty);
    } else {
      merged.push(mergeGeometries(flat, false)!);
    }
  }
  return mergeGeometries(merged, true)!;
}

export { mirrorX, at, V, limb, tube, roundedBox, skull, clamp01, lerp, smoothstep };
