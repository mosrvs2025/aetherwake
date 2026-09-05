/**
 * REALMS — the UI-facing store.
 *
 * The simulation never reads from here; it only pushes. Keeping the HUD on a
 * one-way feed means React re-renders can never stall or perturb the frame
 * loop, and the whole interface could be swapped out without touching gameplay.
 */

import { create } from 'zustand';

export type Phase = 'boot' | 'loading' | 'title' | 'intro' | 'playing' | 'dead' | 'victory';

export interface QuestObjective {
  id: string;
  text: string;
  done: boolean;
  count?: number;
  target?: number;
  /** World position for the compass marker. */
  marker?: [number, number, number];
}

export interface QuestView {
  id: string;
  title: string;
  summary: string;
  objectives: QuestObjective[];
  complete: boolean;
}

export interface ItemView {
  id: string;
  name: string;
  rarity: 'common' | 'fine' | 'rare' | 'relic';
  desc: string;
  count: number;
  kind: string;
}

export interface Toast {
  id: number;
  kind: 'discovery' | 'quest' | 'item' | 'level' | 'info' | 'objective';
  title: string;
  subtitle?: string;
  at: number;
}

export interface FloatingNumber {
  id: number;
  amount: number;
  crit: boolean;
  toPlayer: boolean;
  kind: string;
  x: number; y: number;   // screen space, 0..1
  born: number;
}

export interface CompassMark {
  id: string;
  kind: 'quest' | 'landmark' | 'shrine' | 'enemy' | 'npc' | 'boss' | 'loot';
  /** Angle in radians relative to the camera forward, -PI..PI. */
  angle: number;
  distance: number;
  label?: string;
  discovered: boolean;
}

export interface MinimapBlip {
  id: string;
  kind: CompassMark['kind'];
  /** Position relative to the player in world units, already rotated to camera. */
  x: number; y: number;
  label?: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
}

export interface DialogueView {
  npc: string;
  portrait: string;
  lines: DialogueLine[];
  index: number;
  options?: Array<{ id: string; text: string }>;
}

interface RealmsState {
  phase: Phase;
  loadingLabel: string;
  loadingProgress: number;

  hp: number; hpMax: number;
  energy: number; energyMax: number;
  stamina: number; staminaMax: number;
  level: number; xp: number; xpNext: number;

  region: string;
  coords: [number, number, number];
  fps: number;
  quality: string;
  drawCalls: number;
  tris: number;
  showDebug: boolean;

  quests: QuestView[];
  activeQuestId: string | null;
  toasts: Toast[];
  numbers: FloatingNumber[];
  compass: CompassMark[];
  blips: MinimapBlip[];
  playerAngle: number;

  prompt: { text: string; key: string } | null;
  dialogue: DialogueView | null;
  inventory: ItemView[];
  abilities: Array<{ id: string; name: string; key: string; cost: number; cooldown: number; cooldownMax: number; unlocked: boolean }>;

  bossName: string | null;
  bossHp: number;
  bossHpMax: number;
  bossPhase: number;

  lockOn: boolean;
  lockName: string | null;
  lockHp: number;
  lockHpMax: number;
  showMap: boolean;
  showJournal: boolean;
  paused: boolean;
  discovered: string[];
  cinematicTitle: { title: string; subtitle: string } | null;
  objectiveBanner: string | null;
  deaths: number;
  playTime: number;
  hint: string | null;
}

interface RealmsActions {
  set: (partial: Partial<RealmsState>) => void;
  pushToast: (t: Omit<Toast, 'id' | 'at'>) => void;
  pushNumber: (n: Omit<FloatingNumber, 'id' | 'born'>) => void;
  gc: (now: number) => void;
  reset: () => void;
}

let toastId = 1;
let numberId = 1;

const initial: RealmsState = {
  phase: 'boot',
  loadingLabel: '',
  loadingProgress: 0,
  hp: 100, hpMax: 100,
  energy: 100, energyMax: 100,
  stamina: 100, staminaMax: 100,
  level: 1, xp: 0, xpNext: 120,
  region: '',
  coords: [0, 0, 0],
  fps: 60,
  quality: 'high',
  drawCalls: 0,
  tris: 0,
  showDebug: false,
  quests: [],
  activeQuestId: null,
  toasts: [],
  numbers: [],
  compass: [],
  blips: [],
  playerAngle: 0,
  prompt: null,
  dialogue: null,
  inventory: [],
  abilities: [],
  bossName: null,
  bossHp: 0,
  bossHpMax: 1,
  bossPhase: 1,
  lockOn: false,
  lockName: null,
  lockHp: 0,
  lockHpMax: 1,
  showMap: false,
  showJournal: false,
  paused: false,
  discovered: [],
  cinematicTitle: null,
  objectiveBanner: null,
  deaths: 0,
  playTime: 0,
  hint: null,
};

export const useRealms = create<RealmsState & RealmsActions>((set) => ({
  ...initial,
  set: (partial) => set(partial),
  pushToast: (t) => set((s) => ({
    toasts: [...s.toasts.slice(-4), { ...t, id: toastId++, at: performance.now() }],
  })),
  pushNumber: (n) => set((s) => ({
    numbers: [...s.numbers.slice(-28), { ...n, id: numberId++, born: performance.now() }],
  })),
  gc: (now) => set((s) => {
    const toasts = s.toasts.filter((t) => now - t.at < 6200);
    const numbers = s.numbers.filter((n) => now - n.born < 1150);
    if (toasts.length === s.toasts.length && numbers.length === s.numbers.length) return {};
    return { toasts, numbers };
  }),
  reset: () => set({ ...initial }),
}));

/** Imperative handle so the game loop can write without subscribing. */
export const realms = {
  get state() { return useRealms.getState(); },
  set(partial: Partial<RealmsState>) {
    useRealms.getState().set(partial);
    if (partial.phase && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__realmsPhase = partial.phase;
    }
  },
  toast(t: Omit<Toast, 'id' | 'at'>) { useRealms.getState().pushToast(t); },
  number(n: Omit<FloatingNumber, 'id' | 'born'>) { useRealms.getState().pushNumber(n); },
  gc(now: number) { useRealms.getState().gc(now); },
};
