import { create } from "zustand";
import {
  findRecipe,
  INFUSIONS,
  POWERS,
  slotsUnlocked,
  type PowerId,
} from "./data/powers";
import { SPAWNS } from "./data/creatures";
import { PICKUPS } from "./data/world";
import { runtime } from "./runtime";

export type Knowledge = "unknown" | "seen" | "witnessed" | "grasped";

export interface AbsorbedPower {
  id: PowerId;
  mutations: string[];
  bornAt: number;
}

export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  t: number;
}

export interface GameStore {
  mode: "title" | "playing" | "weft" | "paused";
  started: boolean;
  weftVisited: boolean;
  timeOfDay: number;
  knowledge: Partial<Record<PowerId, Knowledge>>;
  absorbed: AbsorbedPower[];
  attuned: (PowerId | null)[];
  inventory: Record<string, number>;
  discovered: string[];
  journal: JournalEntry[];
  whispers: { id: number; text: string }[];
  whisperSeq: number;
  hollowDebt: number;
  caches: string[];
  killed: string[];
  npcsTalked: string[];
  lastCamp: { x: number; y: number; z: number };
  placing: "camp" | "totem" | "wall" | "bell" | null;
  seed: number;
  toast: string | null;
  see: (id: PowerId) => void;
  witness: (id: PowerId) => void;
  absorb: (id: PowerId, sourceName: string) => boolean;
  attune: (slot: number, id: PowerId | null) => void;
  braid: (a: PowerId, b: PowerId) => { ok: boolean; result?: PowerId; whisper: string };
  infuse: (powerId: PowerId, item: string) => string;
  addItem: (item: string, n?: number) => void;
  spend: (item: string, n?: number) => boolean;
  whisper: (text: string) => void;
  addJournal: (title: string, body: string) => void;
  setMode: (m: GameStore["mode"]) => void;
  start: () => void;
  enterWeft: () => void;
  leaveWeft: () => void;
  markCache: (id: string) => void;
  markKilled: (id: string) => void;
  save: () => void;
  load: () => void;
  has: (id: PowerId) => boolean;
  hasMutation: (id: PowerId, tag: string) => boolean;
  isAttuned: (id: PowerId) => boolean;
  anyAttuned: (...ids: PowerId[]) => boolean;
  slots: () => number;
}

const SAVE = "aetherwake-save-v1";

function starter(): Pick<
  GameStore,
  | "knowledge"
  | "absorbed"
  | "attuned"
  | "inventory"
  | "discovered"
  | "journal"
  | "hollowDebt"
  | "caches"
  | "killed"
  | "npcsTalked"
  | "lastCamp"
  | "weftVisited"
  | "timeOfDay"
> {
  return {
    knowledge: { hollow_pulse: "grasped" },
    absorbed: [{ id: "hollow_pulse", mutations: [], bornAt: 0 }],
    attuned: [null, null, null],
    inventory: {},
    discovered: [],
    journal: [
      {
        id: "j0",
        title: "The Pulse",
        body: "You arrived already listening. The Vale shimmers where a power lives. You can see songs long before you can steal them.",
        t: 0,
      },
    ],
    hollowDebt: 0,
    caches: [],
    killed: [],
    npcsTalked: [],
    lastCamp: { x: -3.2, y: 8.4, z: 21.4 },
    weftVisited: false,
    timeOfDay: 0.28,
  };
}

export const useGame = create<GameStore>((set, get) => ({
  mode: "title",
  started: false,
  weftVisited: false,
  timeOfDay: 0.28,
  knowledge: { hollow_pulse: "grasped" },
  absorbed: [{ id: "hollow_pulse", mutations: [], bornAt: 0 }],
  attuned: [null, null, null],
  inventory: {},
  discovered: [],
  journal: starter().journal,
  whispers: [],
  whisperSeq: 1,
  hollowDebt: 0,
  caches: [],
  killed: [],
  npcsTalked: [],
  lastCamp: { x: -3.2, y: 8.4, z: 21.4 },
  placing: null,
  seed: 1,
  toast: null,

  has: (id) => get().absorbed.some((p) => p.id === id),
  hasMutation: (id, tag) =>
    get().absorbed.some((p) => p.id === id && p.mutations.includes(tag)),
  isAttuned: (id) => get().attuned.includes(id),
  anyAttuned: (...ids) => ids.some((id) => get().attuned.includes(id)),
  slots: () => slotsUnlocked(get().absorbed.length, get().weftVisited),

  see: (id) => {
    const k = get().knowledge[id];
    if (k && k !== "unknown") return;
    const def = POWERS[id];
    if (!def) return;
    set((s) => ({ knowledge: { ...s.knowledge, [id]: "seen" } }));
    get().whisper(def.seen);
  },

  witness: (id) => {
    const k = get().knowledge[id] ?? "unknown";
    if (k === "witnessed" || k === "grasped") return;
    const def = POWERS[id];
    set((s) => ({ knowledge: { ...s.knowledge, [id]: "witnessed" } }));
    get().whisper(def.witnessed);
    get().addJournal(def.secret, def.witnessed);
  },

  absorb: (id, sourceName) => {
    const s = get();
    if (s.has(id) && id !== "unstable") {
      get().whisper("You already carry that song.");
      return false;
    }
    const k = s.knowledge[id] ?? "unknown";
    if (k !== "witnessed" && k !== "grasped" && id !== "gale_whisper") {
      get().whisper("You have seen it. You have not yet understood it.");
      return false;
    }
    const def = POWERS[id];
    set((st) => ({
      absorbed: [...st.absorbed, { id, mutations: [], bornAt: st.seed }],
      knowledge: { ...st.knowledge, [id]: "grasped" },
      hollowDebt: st.hollowDebt + (id === "hollow_pulse" || id === "gale_whisper" ? 0 : 1),
      seed: st.seed + 1,
      attuned: st.attuned[0] == null ? [id, st.attuned[1], st.attuned[2]] : st.attuned,
    }));
    get().whisper(def.grasped);
    get().addJournal(def.name, `Taken from ${sourceName}. ${def.body}`);
    const chorus = def.chorus[0];
    if (chorus) setTimeout(() => get().whisper(chorus), 1600);
    get().save();
    return true;
  },

  attune: (slot, id) => {
    const n = get().slots();
    if (slot >= n) {
      get().whisper("Your body has no room. Rest. Steal more. The Weft will stretch you.");
      return;
    }
    set((s) => {
      const attuned = [...s.attuned] as (PowerId | null)[];
      if (id) {
        const existing = attuned.indexOf(id);
        if (existing >= 0) attuned[existing] = null;
      }
      attuned[slot] = id;
      return { attuned };
    });
  },

  braid: (a, b) => {
    if (a === b) {
      return { ok: false, whisper: "A song cannot marry itself. Not yet." };
    }
    const recipe = findRecipe(a, b);
    if (recipe) {
      const already = get().has(recipe.out);
      if (!already) {
        set((s) => ({
          absorbed: [
            ...s.absorbed,
            { id: recipe.out, mutations: [], bornAt: s.seed },
          ],
          knowledge: { ...s.knowledge, [recipe.out]: "grasped" },
          discovered: s.discovered.includes(recipe.id)
            ? s.discovered
            : [...s.discovered, recipe.id],
          seed: s.seed + 1,
        }));
      }
      get().whisper(recipe.whisper);
      get().addJournal(POWERS[recipe.out].name, recipe.whisper);
      get().save();
      return { ok: true, result: recipe.out, whisper: recipe.whisper };
    }
    set((s) => ({
      absorbed: [
        ...s.absorbed.filter((p) => p.id !== "unstable"),
        { id: "unstable", mutations: ["flicker"], bornAt: s.seed },
      ],
      knowledge: { ...s.knowledge, unstable: "grasped" },
      seed: s.seed + 1,
    }));
    const whisper = "The braid will not hold. Something flickers anyway.";
    get().whisper(whisper);
    return { ok: true, result: "unstable", whisper };
  },

  infuse: (powerId, item) => {
    const inf = INFUSIONS[item];
    if (!inf) return "That material does not know how to speak to powers.";
    if (!get().spend(item, 1)) return "You do not have it.";
    set((s) => ({
      absorbed: s.absorbed.map((p) =>
        p.id === powerId && !p.mutations.includes(inf.tag)
          ? { ...p, mutations: [...p.mutations, inf.tag] }
          : p,
      ),
    }));
    get().whisper(inf.whisper);
    get().save();
    return inf.whisper;
  },

  addItem: (item, n = 1) => {
    set((s) => ({ inventory: { ...s.inventory, [item]: (s.inventory[item] ?? 0) + n } }));
    if (item === "fallen_plume" && !get().has("gale_whisper")) {
      get().absorb("gale_whisper", "a roadside feather");
    }
  },

  spend: (item, n = 1) => {
    const have = get().inventory[item] ?? 0;
    if (have < n) return false;
    set((s) => ({ inventory: { ...s.inventory, [item]: have - n } }));
    return true;
  },

  whisper: (text) => {
    const id = get().whisperSeq + 1;
    set((s) => ({
      whisperSeq: id,
      whispers: [...s.whispers.slice(-4), { id, text }],
      toast: text,
    }));
    window.setTimeout(() => {
      set((s) => ({
        whispers: s.whispers.filter((w) => w.id !== id),
        toast: s.toast === text ? null : s.toast,
      }));
    }, 5200);
  },

  addJournal: (title, body) => {
    set((s) => ({
      journal: [{ id: `j${s.seed}-${title}`, title, body, t: s.seed }, ...s.journal].slice(0, 40),
    }));
  },

  setMode: (m) => set({ mode: m }),

  start: () => {
    runtime.snapped = false;
    set({ mode: "playing", started: true });
    get().whisper("WASD walks. Arrow keys turn. Drag the mouse to look. Take the humming feather on the road.");
  },

  enterWeft: () => {
    set({ mode: "weft", weftVisited: true });
    get().whisper("You fall inward. Your stolen songs have geography.");
  },

  leaveWeft: () => {
    set({ mode: "playing" });
    get().whisper("The outer Vale resumes, slightly less certain of itself.");
  },

  markCache: (id) =>
    set((s) => ({ caches: s.caches.includes(id) ? s.caches : [...s.caches, id] })),
  markKilled: (id) =>
    set((s) => ({ killed: s.killed.includes(id) ? s.killed : [...s.killed, id] })),

  save: () => {
    try {
      const s = get();
      const data = {
        weftVisited: s.weftVisited,
        timeOfDay: runtime.timeOfDay,
        knowledge: s.knowledge,
        absorbed: s.absorbed,
        attuned: s.attuned,
        inventory: s.inventory,
        discovered: s.discovered,
        journal: s.journal,
        hollowDebt: s.hollowDebt,
        caches: s.caches,
        killed: s.killed,
        npcsTalked: s.npcsTalked,
        lastCamp: s.lastCamp,
        player: runtime.player.toArray(),
        yaw: runtime.yaw,
        hp: runtime.hp,
      };
      localStorage.setItem(SAVE, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  },

  load: () => {
    try {
      const raw = localStorage.getItem(SAVE);
      if (!raw) return;
      const d = JSON.parse(raw);
      set({
        weftVisited: d.weftVisited ?? false,
        timeOfDay: d.timeOfDay ?? 0.28,
        knowledge: d.knowledge ?? { hollow_pulse: "grasped" },
        absorbed: d.absorbed ?? starter().absorbed,
        attuned: d.attuned ?? [null, null, null],
        inventory: d.inventory ?? {},
        discovered: d.discovered ?? [],
        journal: d.journal ?? starter().journal,
        hollowDebt: d.hollowDebt ?? 0,
        caches: d.caches ?? [],
        killed: d.killed ?? [],
        npcsTalked: d.npcsTalked ?? [],
        lastCamp: d.lastCamp ?? starter().lastCamp,
        started: true,
        mode: "title",
      });
      if (d.player) runtime.player.fromArray(d.player);
      if (typeof d.yaw === "number") runtime.yaw = d.yaw;
      if (typeof d.hp === "number") runtime.hp = d.hp;
      if (typeof d.timeOfDay === "number") runtime.timeOfDay = d.timeOfDay;
    } catch {
      /* ignore */
    }
  },
}));

export function hasSave() {
  try {
    return !!localStorage.getItem(SAVE);
  } catch {
    return false;
  }
}

export { SPAWNS, PICKUPS };
