"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { runtime } from "@/game/runtime";
import { useGame, hasSave } from "@/game/store";
import { BIOME_NAME, biomeAt } from "@/game/data/world";
import { ITEM_FLAVOR, ITEM_NAMES, POWERS, type PowerId } from "@/game/data/powers";
import { unlockAudio, sting } from "@/game/audio";
import { cn } from "@/lib/utils";

export function TitleScreen() {
  const mode = useGame((s) => s.mode);
  const start = useGame((s) => s.start);
  const load = useGame((s) => s.load);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(hasSave()), []);
  if (mode !== "title") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-end pb-16 sm:justify-center sm:pb-0">
      <div className="pointer-events-auto mx-4 max-w-xl rounded-3xl border border-amber-200/20 bg-black/50 px-8 py-10 text-center shadow-[0_0_80px_rgba(88,28,135,0.35)] backdrop-blur-md">
        <p className="font-[family-name:var(--font-sans)] text-xs tracking-[0.4em] text-amber-200/70 uppercase">
          A vertical slice of the Shattered Vale
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl text-amber-50 sm:text-7xl">
          Aetherwake
        </h1>
        <p className="mt-4 text-pretty text-sm leading-relaxed text-amber-100/75 sm:text-base">
          Almost everything here is still singing. Witness a power in the wild,
          steal it when it is weak or willing, then rest — and discover that
          your stolen songs have geography.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button
            size="lg"
            onClick={() => {
              unlockAudio();
              sting("ui");
              start();
            }}
          >
            Enter the Vale
          </Button>
          {saved && (
            <Button
              variant="runic"
              size="lg"
              onClick={() => {
                load();
                unlockAudio();
                start();
              }}
            >
              Resume a memory
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function HUD() {
  const mode = useGame((s) => s.mode);
  const attuned = useGame((s) => s.attuned);
  const absorbed = useGame((s) => s.absorbed);
  const toast = useGame((s) => s.toast);
  const placing = useGame((s) => s.placing);
  const slots = useGame((s) => s.slots());
  const debt = useGame((s) => s.hollowDebt);
  const [panel, setPanel] = useState<"none" | "journal" | "craft" | "help">("none");
  const [hp, setHp] = useState(100);
  const [stam, setStam] = useState(100);
  const [prompt, setPrompt] = useState("");
  const [biome, setBiome] = useState("The Shattered Vale");
  const [compass, setCompass] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setHp(runtime.hp);
      setStam(runtime.stamina);
      setPrompt(runtime.prompt);
      setBiome(BIOME_NAME[biomeAt(runtime.player.x, runtime.player.z)]);
      setCompass(((-runtime.yaw) * 180) / Math.PI);
    }, 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const open = panel !== "none" || mode === "weft";
    runtime.uiOpen = panel !== "none";
    if (open && panel !== "none") document.exitPointerLock?.();
  }, [panel, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        e.preventDefault();
        setPanel((p) => (p === "journal" ? "none" : "journal"));
      }
      if (e.code === "KeyC") setPanel((p) => (p === "craft" ? "none" : "craft"));
      if (e.code === "KeyH" || e.code === "Slash")
        setPanel((p) => (p === "help" ? "none" : "help"));
      if (e.code === "Escape") setPanel("none");
      if (e.code === "Digit1") useGame.getState().attune(0, cycle(0));
      if (e.code === "Digit2") useGame.getState().attune(1, cycle(1));
      if (e.code === "Digit3") useGame.getState().attune(2, cycle(2));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [absorbed]);

  if (mode === "title") return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 text-amber-50">
      <div className="absolute left-4 top-4 right-4 flex items-start justify-between gap-4">
        <div className="min-w-[180px] max-w-xs">
          <p className="font-[family-name:var(--font-display)] text-lg leading-none">{biome}</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-amber-200/50">
            Hollow debt {debt} · songs {absorbed.length}
          </p>
          <Bar value={hp} color="bg-rose-400" label="vital" />
          <Bar value={stam} color="bg-sky-300" label="breath" />
        </div>
        <div className="hidden h-10 w-28 overflow-hidden rounded-full border border-white/10 bg-black/40 sm:block">
          <div
            className="flex h-full w-[400%] items-center justify-around text-[10px] tracking-[0.3em] text-amber-100/70"
            style={{ transform: `translateX(${((compass % 360) / 360) * -25}%)` }}
          >
            <span>N</span><span>E</span><span>S</span><span>W</span>
            <span>N</span><span>E</span><span>S</span><span>W</span>
          </div>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <Button variant="runic" size="sm" onClick={() => setPanel("journal")}>
            Journal
          </Button>
          <Button variant="runic" size="sm" onClick={() => setPanel("craft")}>
            Hearth
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPanel("help")}>
            Controls
          </Button>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 w-[min(92vw,640px)] -translate-x-1/2">
        {prompt && (
          <p className="mb-3 text-center font-[family-name:var(--font-display)] text-lg text-amber-100 drop-shadow">
            {prompt}
          </p>
        )}
        {toast && (
          <p className="mb-4 text-center text-sm italic text-violet-200/90">{toast}</p>
        )}
        {placing && (
          <p className="mb-2 text-center text-xs uppercase tracking-[0.3em] text-amber-200/70">
            Placing {placing} — click F to set it down
          </p>
        )}
        <div className="flex justify-center gap-3">
          {[0, 1, 2].map((i) => {
            const id = attuned[i];
            const locked = i >= slots;
            const def = id ? POWERS[id] : null;
            return (
              <button
                key={i}
                className={cn(
                  "pointer-events-auto flex h-16 w-16 flex-col items-center justify-center rounded-2xl border bg-black/45 backdrop-blur-sm transition",
                  locked
                    ? "border-white/5 opacity-30"
                    : def
                      ? "border-amber-200/40 shadow-[0_0_24px_rgba(251,191,36,0.2)]"
                      : "border-white/10",
                )}
                onClick={() => {
                  if (locked) return;
                  useGame.getState().attune(i, cycle(i));
                }}
              >
                <span className="text-[10px] uppercase tracking-widest text-amber-200/50">
                  {["Q", "E", "R"][i]}
                </span>
                <span className="px-1 text-center text-[10px] leading-tight">
                  {locked ? "—" : def ? def.name.split(" ")[0] : "empty"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-center text-[10px] text-amber-100/40">
          Attunement is a body, not a menu. 1 / 2 / 3 cycle what lives in a limb.
        </p>
      </div>

      <TouchPad />

      {mode === "weft" && (
        <div className="absolute left-4 bottom-6 max-w-sm text-sm text-violet-100/80">
          <p className="font-[family-name:var(--font-display)] text-xl">The Weft</p>
          <p className="mt-1 text-xs leading-relaxed">
            Your stolen powers are places now. Lift one. Walk it into another.
            Some braids hold. Some flicker. The Vale will not list the rest.
          </p>
          <Button
            className="pointer-events-auto mt-3"
            variant="runic"
            size="sm"
            onClick={() => useGame.getState().leaveWeft()}
          >
            Wake
          </Button>
        </div>
      )}

      {panel === "journal" && <Journal onClose={() => setPanel("none")} />}
      {panel === "craft" && <Craft onClose={() => setPanel("none")} />}
      {panel === "help" && <Help onClose={() => setPanel("none")} />}
    </div>
  );
}

function cycle(slot: number): PowerId | null {
  const s = useGame.getState();
  const ids: PowerId[] = s.absorbed.map((p) => p.id).filter((id) => id !== "hollow_pulse");
  if (ids.length === 0) return null;
  const cur = s.attuned[slot];
  const idx = cur ? ids.indexOf(cur) : -1;
  const next = ids[(idx + 1) % (ids.length + 1)];
  return next ?? null;
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="mt-2">
      <div className="mb-0.5 flex justify-between text-[9px] uppercase tracking-[0.2em] text-amber-100/40">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function Journal({ onClose }: { onClose: () => void }) {
  const journal = useGame((s) => s.journal);
  const knowledge = useGame((s) => s.knowledge);
  const absorbed = useGame((s) => s.absorbed);
  return (
    <Panel title="Fragments" onClose={onClose}>
      <p className="mb-4 text-xs text-amber-100/60">
        You do not get a bestiary. You get what you have touched, and the lies
        the Chorus tells about the rest.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {absorbed.map((p) => (
          <span
            key={p.id}
            className="rounded-full border border-white/10 px-2 py-0.5 text-[10px]"
            style={{ color: POWERS[p.id].color }}
          >
            {POWERS[p.id].name}
            {p.mutations.length ? ` · ${p.mutations.join(", ")}` : ""}
          </span>
        ))}
      </div>
      <ul className="space-y-3 text-sm">
        {journal.map((j) => (
          <li key={j.id}>
            <p className="font-[family-name:var(--font-display)] text-amber-100">{j.title}</p>
            <p className="text-amber-100/70">{j.body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6 border-t border-white/10 pt-3 text-[11px] text-amber-100/50">
        {Object.entries(knowledge)
          .filter(([, k]) => k === "seen" || k === "witnessed")
          .map(([id, k]) => (
            <p key={id}>
              {k === "seen" ? POWERS[id as PowerId].seen : POWERS[id as PowerId].witnessed}
            </p>
          ))}
      </div>
    </Panel>
  );
}

function Craft({ onClose }: { onClose: () => void }) {
  const inv = useGame((s) => s.inventory);
  const absorbed = useGame((s) => s.absorbed);
  const setPlacing = (k: "camp" | "totem" | "wall" | "bell") => {
    useGame.setState({ placing: k });
    useGame.getState().whisper(`The Vale will take a ${k} where you stand and press F.`);
    onClose();
  };
  const items = Object.entries(inv).filter(([, n]) => n > 0);
  return (
    <Panel title="Hearth & Hands" onClose={onClose}>
      <p className="mb-3 text-xs text-amber-100/60">
        Build in the world. Infuse a song with a material. Results are not listed.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="runic" size="sm" onClick={() => setPlacing("camp")}>
          Camp
        </Button>
        <Button variant="runic" size="sm" onClick={() => setPlacing("totem")}>
          Totem
        </Button>
        <Button variant="runic" size="sm" onClick={() => setPlacing("wall")}>
          Wall
        </Button>
        <Button variant="runic" size="sm" onClick={() => setPlacing("bell")}>
          Lure bell
        </Button>
      </div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200/40">Pockets</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.length === 0 && <li className="text-amber-100/40">Empty. The ground is generous if you look down.</li>}
        {items.map(([id, n]) => (
          <li key={id} className="flex justify-between gap-4">
            <span>
              {ITEM_NAMES[id] ?? id} × {n}
              <span className="block text-[11px] text-amber-100/45">{ITEM_FLAVOR[id]}</span>
            </span>
            {INFUSABLE.includes(id) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const power = useGame.getState().attuned[0];
                  if (!power) {
                    useGame.getState().whisper("Attune a song first. Infusion needs a body.");
                    return;
                  }
                  useGame.getState().infuse(power, id);
                }}
              >
                Infuse attuned
              </Button>
            )}
          </li>
        ))}
      </ul>
      {absorbed.length > 1 && (
        <p className="mt-4 text-[11px] text-violet-200/60">
          Grafting a totem with an attuned song pays a little hollow debt back.
          Taking without giving tears the Vale.
        </p>
      )}
    </Panel>
  );
}

const INFUSABLE = [
  "quickglass",
  "nightiron",
  "weftseed",
  "hollowash",
  "embercoal",
  "stormglass",
  "sporegel",
  "tidepearl",
  "basaltheart",
  "kiteplume",
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <Panel title="How the Vale is touched" onClose={onClose}>
      <ul className="space-y-2 text-sm text-amber-100/80">
        <li><b>WASD</b> move · <b>mouse</b> look · <b>Shift</b> sprint · <b>Space</b> jump / glide</li>
        <li><b>Click</b> strike · <b>F</b> take, speak, absorb (hold), place</li>
        <li><b>Q E R</b> surge the songs attuned to your limbs</li>
        <li><b>1 2 3</b> cycle attunement · <b>C</b> hearth · <b>Tab</b> journal</li>
        <li>Rest at a Weft Camp to enter the inner world and braid powers.</li>
        <li>You will see shimmering long before you can steal it. Watch it work.</li>
        <li>Two songs that should not know each other sometimes do. Try.</li>
      </ul>
    </Panel>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-amber-200/20 bg-[#140e18]/95 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TouchPad() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch("ontouchstart" in window);
  }, []);
  if (!touch) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-between px-4 sm:hidden">
      <Joystick
        onChange={(x, y) => {
          runtime.touch.moveX = x;
          runtime.touch.moveY = y;
        }}
      />
      <div className="pointer-events-auto flex flex-col gap-2">
        <Button size="sm" variant="runic" onPointerDown={() => (inputSpace(true))} onPointerUp={() => inputSpace(false)}>
          Jump
        </Button>
        <Button size="sm" variant="runic" onClick={() => { runtime.attackPressed = true; }}>
          Strike
        </Button>
        <Button size="sm" onClick={() => useGame.getState().whisper(runtime.prompt || "…")}>
          F
        </Button>
      </div>
    </div>
  );
}

function inputSpace(down: boolean) {
  const e = new KeyboardEvent(down ? "keydown" : "keyup", { code: "Space" });
  window.dispatchEvent(e);
}

function Joystick({ onChange }: { onChange: (x: number, y: number) => void }) {
  return (
    <div
      className="pointer-events-auto h-28 w-28 rounded-full border border-white/15 bg-black/30"
      onTouchMove={(e) => {
        const t = e.touches[0];
        const r = e.currentTarget.getBoundingClientRect();
        const x = (t.clientX - r.left) / r.width * 2 - 1;
        const y = (t.clientY - r.top) / r.height * 2 - 1;
        onChange(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
      }}
      onTouchEnd={() => onChange(0, 0)}
    />
  );
}
