/**
 * REALMS — quests.
 *
 * A tiny event-driven log: the world emits facts ("discovered X", "killed a
 * husk", "picked up a sealstone", "talked to Maren") and the log decides what
 * that means. Objectives carry world markers so the compass and minimap are
 * generated from the same data the journal shows.
 */

import { realms, type QuestObjective, type QuestView } from './state';
import { LANDMARKS } from '../world/atlas';

export type QuestEvent =
  | { type: 'discover'; id: string }
  | { type: 'kill'; kind: string; region?: string }
  | { type: 'collect'; item: string; count?: number }
  | { type: 'talk'; npc: string }
  | { type: 'interact'; id: string }
  | { type: 'boss'; id: string; stage: 'engaged' | 'defeated' };

interface ObjectiveDef extends QuestObjective {
  match: (e: QuestEvent) => boolean;
}

interface QuestDef {
  id: string;
  title: string;
  summary: string;
  objectives: ObjectiveDef[];
  /** Quests that unlock when this one completes. */
  next?: string[];
  autoStart?: boolean;
  xp: number;
  reward?: string;
}

const lm = (id: string): [number, number, number] => {
  const l = LANDMARKS.find((x) => x.id === id)!;
  return [l.x, 0, l.z];
};

export const QUESTS: QuestDef[] = [
  {
    id: 'the_long_road',
    title: 'The Long Road',
    summary:
      'The Warden of the Fall has not answered the beacons in nine years. ' +
      'Cross the shelf and find out what is still sitting on that throne.',
    autoStart: true,
    xp: 250,
    objectives: [
      {
        id: 'discover_keep', text: 'Discover Skyfall Keep', done: false,
        marker: lm('skyfall_keep'),
        match: (e) => e.type === 'discover' && e.id === 'skyfall_keep',
      },
    ],
    next: ['the_wardens_key'],
  },
  {
    id: 'amberfell_warning',
    title: "Amberfell's Warning",
    summary: 'Smoke still rises from the last village on the shelf. Someone there is still alive.',
    xp: 120,
    objectives: [
      {
        id: 'find_amberfell', text: 'Find Amberfell', done: false,
        marker: lm('amberfell'),
        match: (e) => e.type === 'discover' && e.id === 'amberfell',
      },
      {
        id: 'talk_maren', text: 'Speak with Elder Maren', done: false,
        marker: [-136, 0, 242],
        match: (e) => e.type === 'talk' && e.npc === 'elder',
      },
    ],
    next: ['embers_in_the_wood'],
  },
  {
    id: 'embers_in_the_wood',
    title: 'Embers in the Wood',
    summary: 'The husks came out of Emberpine three nights ago and have not gone back in. Thin them out.',
    xp: 180,
    reward: 'emberfruit',
    objectives: [
      {
        id: 'kill_husks', text: 'Destroy the husks', done: false, count: 0, target: 6,
        marker: lm('emberpine'),
        match: (e) => e.type === 'kill' && (e.kind === 'husk' || e.kind === 'stalker'),
      },
      {
        id: 'return_maren', text: 'Return to Elder Maren', done: false,
        marker: [-136, 0, 242],
        match: (e) => e.type === 'talk' && e.npc === 'elder',
      },
    ],
  },
  {
    id: 'the_wardens_key',
    title: "The Warden's Key",
    summary:
      'The Gate below the Keep is sealed with three sealstones. They were scattered when the ' +
      'shelf broke. Find them, and the road north opens.',
    xp: 400,
    objectives: [
      {
        id: 'sealstones', text: 'Recover the sealstones', done: false, count: 0, target: 3,
        marker: lm('colonnade'),
        match: (e) => e.type === 'collect' && e.item === 'sealstone',
      },
      {
        id: 'open_gate', text: "Open the Warden's Gate", done: false,
        marker: lm('wardens_gate'),
        match: (e) => e.type === 'interact' && e.id === 'wardens_gate',
      },
    ],
    next: ['the_warden'],
  },
  {
    id: 'the_warden',
    title: 'The Warden of the Fall',
    summary: 'Whatever is wearing the Warden’s armour is waiting in the courtyard. Put it down.',
    xp: 1200,
    objectives: [
      {
        id: 'kill_boss', text: 'Defeat the Warden of the Fall', done: false,
        marker: [-60, 0, -560],
        match: (e) => e.type === 'boss' && e.stage === 'defeated',
      },
    ],
  },
];

export class QuestLog {
  private defs = new Map<string, QuestDef>();
  private state = new Map<string, { started: boolean; complete: boolean; objectives: Map<string, QuestObjective> }>();
  activeId: string | null = null;
  onComplete: ((q: QuestDef) => void) | null = null;
  onObjective: ((q: QuestDef, o: QuestObjective) => void) | null = null;
  onStart: ((q: QuestDef) => void) | null = null;

  constructor() {
    for (const q of QUESTS) {
      this.defs.set(q.id, q);
      this.state.set(q.id, {
        started: !!q.autoStart,
        complete: false,
        objectives: new Map(q.objectives.map((o) => [o.id, { ...o, match: undefined } as QuestObjective])),
      });
    }
    this.activeId = QUESTS.find((q) => q.autoStart)?.id ?? null;
  }

  start(id: string) {
    const st = this.state.get(id);
    const def = this.defs.get(id);
    if (!st || !def || st.started) return;
    st.started = true;
    if (!this.activeId || this.isComplete(this.activeId)) this.activeId = id;
    this.onStart?.(def);
    this.sync();
  }

  isStarted(id: string) { return this.state.get(id)?.started ?? false; }
  isComplete(id: string) { return this.state.get(id)?.complete ?? false; }

  objectiveDone(questId: string, objId: string) {
    return this.state.get(questId)?.objectives.get(objId)?.done ?? false;
  }

  notify(e: QuestEvent) {
    let changed = false;
    for (const def of QUESTS) {
      const st = this.state.get(def.id)!;
      if (!st.started || st.complete) continue;
      let prevDone = true;
      for (const od of def.objectives) {
        const obj = st.objectives.get(od.id)!;
        if (obj.done) continue;
        // objectives are ordered: later ones only accept events once earlier ones are done
        if (!prevDone) break;
        if (!od.match(e)) { prevDone = false; break; }
        if (obj.target !== undefined) {
          obj.count = (obj.count ?? 0) + (e.type === 'collect' ? (e.count ?? 1) : 1);
          if (obj.count >= obj.target) obj.done = true;
        } else {
          obj.done = true;
        }
        changed = true;
        if (obj.done) this.onObjective?.(def, obj);
        break;
      }
      if ([...st.objectives.values()].every((o) => o.done)) {
        st.complete = true;
        changed = true;
        this.onComplete?.(def);
        for (const n of def.next ?? []) this.start(n);
        if (this.activeId === def.id) {
          const nextActive = QUESTS.find((q) => this.state.get(q.id)!.started && !this.state.get(q.id)!.complete);
          this.activeId = nextActive?.id ?? null;
        }
      }
    }
    if (changed) this.sync();
    return changed;
  }

  /** The objective the compass should point at right now. */
  currentMarker(): { pos: [number, number, number]; text: string } | null {
    const id = this.activeId;
    if (!id) return null;
    const st = this.state.get(id);
    const def = this.defs.get(id);
    if (!st || !def) return null;
    for (const od of def.objectives) {
      const obj = st.objectives.get(od.id)!;
      if (!obj.done && obj.marker) return { pos: obj.marker, text: obj.text };
    }
    return null;
  }

  views(): QuestView[] {
    const out: QuestView[] = [];
    for (const def of QUESTS) {
      const st = this.state.get(def.id)!;
      if (!st.started) continue;
      out.push({
        id: def.id,
        title: def.title,
        summary: def.summary,
        complete: st.complete,
        objectives: def.objectives.map((o) => ({ ...st.objectives.get(o.id)! })),
      });
    }
    return out;
  }

  sync() {
    realms.set({ quests: this.views(), activeQuestId: this.activeId });
  }

  def(id: string) { return this.defs.get(id); }
}
