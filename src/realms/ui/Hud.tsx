'use client';

/**
 * REALMS — the interface.
 *
 * Everything reads from the store with narrow selectors so a health tick does
 * not re-render the minimap. The HUD is pure DOM/CSS on top of the canvas:
 * cheaper than drawing it in WebGL, crisper at any DPI, and it keeps the
 * renderer free for the world.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { STICK_R, touchStick } from '../core/input';
import { useRealms, type CompassMark, type MinimapBlip } from '../game/state';

/* ------------------------------------------------------------------ *
 * Bits
 * ------------------------------------------------------------------ */

function Bar({
  value, max, color, glow, height = 10, label, showText = false, ghost = true, pulse = false,
}: {
  value: number; max: number; color: string; glow?: string; height?: number;
  label?: string; showText?: boolean; ghost?: boolean; pulse?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100;
  return (
    <div className="relative">
      <div className={`rl-bar rounded-[3px]${pulse ? ' rl-anim-pulse' : ''}`} style={{ height }}>
        {ghost && (
          <div
            className="rl-bar-ghost"
            style={{ width: `${pct}%`, background: 'rgba(255,255,255,0.5)' }}
          />
        )}
        <i
          style={{
            width: `${pct}%`,
            background: color,
            boxShadow: glow ? `0 0 12px ${glow}, inset 0 1px 0 rgba(255,255,255,0.28)` : undefined,
          }}
        />
      </div>
      {label && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-1.5">
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/55 rl-etch">{label}</span>
          {showText && (
            <span className="text-[9px] font-semibold tabular-nums text-white/80 rl-etch">
              {Math.ceil(value)}/{Math.ceil(max)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Vitals — bottom left
 * ------------------------------------------------------------------ */

function Vitals() {
  const hp = useRealms((s) => s.hp);
  const hpMax = useRealms((s) => s.hpMax);
  const energy = useRealms((s) => s.energy);
  const energyMax = useRealms((s) => s.energyMax);
  const stamina = useRealms((s) => s.stamina);
  const staminaMax = useRealms((s) => s.staminaMax);
  const level = useRealms((s) => s.level);
  const xp = useRealms((s) => s.xp);
  const xpNext = useRealms((s) => s.xpNext);

  const low = hp / hpMax < 0.3;

  return (
    <div className="rl-hud-vitals pointer-events-none absolute bottom-5 left-5 flex items-end gap-3 select-none">
      <div className="relative grid h-[62px] w-[62px] place-items-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(120,150,190,0.16)" strokeWidth="5" />
          <circle
            cx="50" cy="50" r="42" fill="none" stroke="var(--gold)" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(xp / Math.max(1, xpNext)) * 264} 264`}
            style={{ filter: 'drop-shadow(0 0 6px rgba(217,185,120,0.55))', transition: 'stroke-dasharray 500ms ease' }}
          />
        </svg>
        <div className="rl-panel grid h-[46px] w-[46px] place-items-center rounded-full">
          <span className="rl-display rl-etch text-[19px] font-bold leading-none text-[#f0e2c2]">{level}</span>
        </div>
      </div>

      <div className="w-[286px] space-y-[5px] pb-1">
        <Bar
          value={hp} max={hpMax} height={16} label="Vitality" showText pulse={low}
          color={low
            ? 'linear-gradient(90deg,#ff5a4a,#ff8a5c)'
            : 'linear-gradient(90deg,#c9372c,#e86a4a 60%,#f0a06a)'}
          glow={low ? 'rgba(255,90,74,0.65)' : 'rgba(224,72,60,0.45)'}
        />
        <Bar
          value={energy} max={energyMax} height={11} label="Aether"
          color="linear-gradient(90deg,#1e6fb0,#63b6ff 65%,#a7dcff)"
          glow="rgba(99,182,255,0.5)"
        />
        <div className="h-[5px]">
          <Bar value={stamina} max={staminaMax} height={5} ghost={false}
            color="linear-gradient(90deg,#8a7238,#e0c27a)" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Abilities — bottom centre
 * ------------------------------------------------------------------ */

const ABILITY_GLYPH: Record<string, string> = {
  surge: 'M12 2 L20 12 L12 22 L4 12 Z',
  riftstep: 'M4 20 L14 4 L12 12 L20 12 L9 22 L12 14 Z',
  fury: 'M3 14 L7 6 L12 10 L17 6 L21 14 L12 21 Z',
};

function Abilities() {
  const abilities = useRealms((s) => s.abilities);
  const energy = useRealms((s) => s.energy);
  // A ring that fires the moment an ability goes on cooldown. Pressing a key
  // and watching a number appear is information; the flash is acknowledgement,
  // and the two are not the same thing.
  //
  // Driven off a store subscription rather than a render-time comparison, so
  // the rising edge is caught exactly once however often the HUD re-renders.
  const [fired, setFired] = useState<Record<string, number>>({});
  useEffect(() => {
    const last: Record<string, number> = {};
    return useRealms.subscribe((st) => {
      const rising: string[] = [];
      for (const a of st.abilities) {
        if ((last[a.id] ?? 0) < 0.05 && a.cooldown > 0.05) rising.push(a.id);
        last[a.id] = a.cooldown;
      }
      if (rising.length) {
        setFired((f) => {
          const next = { ...f };
          for (const id of rising) next[id] = (next[id] ?? 0) + 1;
          return next;
        });
      }
    });
  }, []);
  return (
    <div className="rl-hud-abilities pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-[26px] select-none">
      {abilities.map((a) => {
        const cooling = a.cooldown > 0.001;
        const ready = !cooling && energy >= a.cost;
        return (
          <div key={a.id} className="relative">
            <div
              className="rl-panel relative grid h-[54px] w-[54px] place-items-center rounded-[7px] overflow-hidden"
              style={{
                borderColor: ready ? 'rgba(99,182,255,0.45)' : 'rgba(140,175,215,0.14)',
                boxShadow: ready
                  ? '0 0 22px rgba(99,182,255,0.20), inset 0 1px 0 rgba(190,220,255,0.10)'
                  : undefined,
              }}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ opacity: ready ? 1 : 0.34 }}>
                <path d={ABILITY_GLYPH[a.id]} fill="none" stroke={ready ? '#a7dcff' : '#7c93ad'} strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              {cooling && (
                <div
                  className="absolute inset-0 bg-black/62"
                  style={{ clipPath: `inset(0 0 ${(1 - a.cooldown / a.cooldownMax) * 100}% 0)` }}
                />
              )}
              {cooling && (
                <span className="absolute inset-0 grid place-items-center text-[15px] font-semibold tabular-nums text-white/85 rl-etch">
                  {a.cooldown.toFixed(1)}
                </span>
              )}
            </div>
            {fired[a.id] ? (
              <span
                key={fired[a.id]}
                className="rl-anim-cast pointer-events-none absolute -inset-1 rounded-[9px] border border-[#a7dcff]"
              />
            ) : null}
            <span className="absolute -top-1.5 -left-1.5 grid h-[19px] w-[19px] place-items-center rounded-[4px] border border-white/15 bg-black/80 text-[10px] font-bold text-white/75">
              {a.key}
            </span>
            <span className="pointer-events-none absolute -bottom-[15px] left-1/2 w-[92px] -translate-x-1/2 truncate text-center text-[8.5px] uppercase tracking-[0.10em] text-white/38">
              {a.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Compass strip — top centre
 * ------------------------------------------------------------------ */

const CARDINALS: Array<[string, number]> = [
  ['N', 0], ['NE', Math.PI / 4], ['E', Math.PI / 2], ['SE', (3 * Math.PI) / 4],
  ['S', Math.PI], ['SW', -(3 * Math.PI) / 4], ['W', -Math.PI / 2], ['NW', -Math.PI / 4],
];

const MARK_STYLE: Record<CompassMark['kind'], { color: string; glyph: string }> = {
  quest: { color: '#f4d47a', glyph: '◆' },
  landmark: { color: '#9fd0ff', glyph: '▲' },
  shrine: { color: '#7fe3c0', glyph: '✦' },
  enemy: { color: '#ff7a68', glyph: '●' },
  npc: { color: '#e6d3a8', glyph: '❖' },
  boss: { color: '#ff5a4a', glyph: '✖' },
  loot: { color: '#c8a0ff', glyph: '◇' },
};

function Compass() {
  const marks = useRealms((s) => s.compass);
  const yaw = useRealms((s) => s.playerAngle);
  const width = 520;
  const span = Math.PI * 0.95;

  const place = (angle: number) => {
    let a = angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    if (Math.abs(a) > span / 2) return null;
    return (a / span) * width + width / 2;
  };

  return (
    <div className="rl-hud-compass pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 select-none">
      <div
        className="relative h-[34px] overflow-hidden rounded-[3px]"
        style={{
          width,
          maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
        }}
      >
        <div className="absolute inset-x-0 top-[21px] h-px bg-white/14" />
        {CARDINALS.map(([label, a]) => {
          // a cardinal's bearing relative to the camera; the camera's own
          // bearing is -yaw, so the offset is a + yaw
          const x = place(a + yaw);
          if (x === null) return null;
          const major = label.length === 1;
          return (
            <div key={label} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: x }}>
              <div
                className="mx-auto w-px bg-white/35"
                style={{ height: major ? 9 : 5, marginTop: major ? 12 : 16 }}
              />
              <div
                className={`rl-display rl-etch ${major ? 'text-[11px] text-white/80' : 'text-[9px] text-white/40'}`}
                style={{ marginTop: 1 }}
              >
                {label}
              </div>
            </div>
          );
        })}
        {marks.map((m) => {
          const x = place(m.angle);
          if (x === null) return null;
          const st = MARK_STYLE[m.kind];
          return (
            <div key={m.id} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: x }}>
              <div
                className="text-[11px] leading-none"
                style={{ color: st.color, textShadow: `0 0 8px ${st.color}88`, opacity: m.discovered ? 1 : 0.55 }}
              >
                {st.glyph}
              </div>
              <div className="mt-[2px] text-[8px] font-medium tabular-nums text-white/45">
                {m.distance > 999 ? `${(m.distance / 1000).toFixed(1)}k` : Math.round(m.distance)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Minimap — top right
 * ------------------------------------------------------------------ */

function Minimap() {
  const blips = useRealms((s) => s.blips);
  const region = useRealms((s) => s.region);
  const size = 148;
  const range = 140;
  const r = size / 2;

  return (
    <div className="rl-hud-minimap pointer-events-none absolute right-5 top-5 select-none">
      <div
        className="rl-panel relative overflow-hidden rounded-full"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 50%, rgba(30,52,78,0.55), rgba(6,10,16,0.9) 72%)',
          }}
        />
        {[0.33, 0.66, 1].map((f) => (
          <div
            key={f}
            className="absolute rounded-full border border-white/8"
            style={{ inset: `${(1 - f) * r}px` }}
          />
        ))}
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/6" />
        <div className="absolute top-1/2 left-0 h-px w-full bg-white/6" />

        {blips.map((b: MinimapBlip) => {
          const d = Math.hypot(b.x, b.y);
          if (d > range) return null;
          const st = MARK_STYLE[b.kind];
          const x = r + (b.x / range) * (r - 9);
          const y = r + (b.y / range) * (r - 9);
          const big = b.kind === 'boss' || b.kind === 'quest' || b.kind === 'landmark';
          return (
            <div
              key={b.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: x, top: y, color: st.color, fontSize: big ? 11 : 8, textShadow: `0 0 6px ${st.color}` }}
            >
              {st.glyph}
            </div>
          );
        })}

        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.5))' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M7 0 L12 13 L7 10 L2 13 Z" fill="#f2ecdf" />
          </svg>
        </div>
        <div className="absolute left-1/2 top-1.5 -translate-x-1/2 rl-display text-[10px] text-white/60">N</div>
      </div>
      <div className="mt-1.5 text-center rl-display text-[11px] tracking-[0.22em] text-white/60 rl-etch">
        {region.toUpperCase()}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Quest tracker — top left
 * ------------------------------------------------------------------ */

function QuestTracker() {
  const quests = useRealms((s) => s.quests);
  const activeId = useRealms((s) => s.activeQuestId);
  const active = quests.find((q) => q.id === activeId) ?? quests.find((q) => !q.complete);
  if (!active) return null;
  return (
    <div className="rl-hud-quest pointer-events-none absolute left-5 top-5 w-[268px] select-none rl-anim-up">
      <div className="mb-1 flex items-center gap-2">
        <span className="h-px w-4 bg-[var(--gold)]/60" />
        <span className="rl-display text-[10px] tracking-[0.26em] text-[var(--gold)]/85">QUEST</span>
      </div>
      <div className="rl-display rl-etch mb-2 text-[15px] font-semibold leading-tight text-[#f4ecdb]">
        {active.title}
      </div>
      <ul className="space-y-[5px]">
        {active.objectives.map((o) => (
          <li key={o.id} className="flex items-start gap-2 text-[12px] leading-snug">
            <span
              className="mt-[5px] inline-block h-[6px] w-[6px] shrink-0 rotate-45"
              style={{
                background: o.done ? 'rgba(140,220,170,0.9)' : 'rgba(244,212,122,0.9)',
                boxShadow: o.done ? '0 0 6px rgba(140,220,170,0.6)' : '0 0 6px rgba(244,212,122,0.5)',
              }}
            />
            <span className={o.done ? 'text-white/35 line-through' : 'text-white/82 rl-etch'}>
              {o.text}
              {o.target !== undefined && !o.done && (
                <span className="ml-1.5 tabular-nums text-[var(--gold)]/90">
                  {o.count ?? 0}/{o.target}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Boss bar
 * ------------------------------------------------------------------ */

function BossBar() {
  const name = useRealms((s) => s.bossName);
  const hp = useRealms((s) => s.bossHp);
  const hpMax = useRealms((s) => s.bossHpMax);
  const phase = useRealms((s) => s.bossPhase);
  if (!name) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[56px] w-[560px] -translate-x-1/2 select-none rl-anim-up">
      <div className="mb-1 flex items-baseline justify-center gap-3">
        <span className="rl-display rl-etch text-[15px] tracking-[0.20em] text-[#ffd9c2]">
          {name.toUpperCase()}
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">Phase {phase}</span>
      </div>
      <div className="rl-bar h-[9px] rounded-[2px]" style={{ borderColor: 'rgba(255,140,110,0.30)' }}>
        <div className="rl-bar-ghost" style={{ width: `${(hp / hpMax) * 100}%`, background: 'rgba(255,220,200,0.55)' }} />
        <i
          style={{
            width: `${Math.max(0, (hp / hpMax) * 100)}%`,
            background: 'linear-gradient(90deg,#8f1c14,#e2492f 55%,#ff9a5c)',
            boxShadow: '0 0 16px rgba(226,73,47,0.55), inset 0 1px 0 rgba(255,255,255,0.25)',
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Prompts, toasts, numbers
 * ------------------------------------------------------------------ */

function InteractPrompt() {
  const prompt = useRealms((s) => s.prompt);
  const dialogue = useRealms((s) => s.dialogue);
  const touch = useTouch();
  if (!prompt || dialogue) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 bottom-[26%] -translate-x-1/2 select-none rl-anim-up">
      <div className="rl-panel flex items-center gap-2.5 rounded-[5px] px-3 py-2">
        {/* A keycap means nothing without a keyboard; on touch the button
            that does this is already pulsing in the corner. */}
        {!touch && (
          <span className="grid h-[22px] w-[22px] place-items-center rounded-[4px] border border-white/25 bg-white/8 text-[11px] font-bold text-white/90">
            {prompt.key}
          </span>
        )}
        <span className="text-[13px] text-white/88 rl-etch">{prompt.text}</span>
      </div>
    </div>
  );
}

const TOAST_STYLE: Record<string, { accent: string; kicker: string }> = {
  discovery: { accent: '#9fd0ff', kicker: 'LOCATION DISCOVERED' },
  quest: { accent: '#f4d47a', kicker: 'QUEST' },
  objective: { accent: '#8ce0b0', kicker: 'OBJECTIVE' },
  item: { accent: '#c8a0ff', kicker: 'ACQUIRED' },
  level: { accent: '#ffd28a', kicker: 'LEVEL UP' },
  info: { accent: '#a9bdd4', kicker: '' },
};

function Toasts() {
  const toasts = useRealms((s) => s.toasts);
  return (
    <div className="rl-hud-toasts pointer-events-none absolute right-5 top-[210px] flex w-[290px] flex-col gap-2 select-none">
      {toasts.map((t) => {
        const st = TOAST_STYLE[t.kind] ?? TOAST_STYLE.info;
        return (
          <div key={t.id} className="rl-panel rl-anim-slide rounded-[4px] px-3 py-2.5"
            style={{ borderLeft: `2px solid ${st.accent}` }}>
            {st.kicker && (
              <div className="mb-0.5 text-[9px] font-semibold tracking-[0.22em]" style={{ color: st.accent }}>
                {st.kicker}
              </div>
            )}
            <div className="rl-display rl-etch text-[14px] leading-tight text-[#f3ecdd]">{t.title}</div>
            {t.subtitle && <div className="mt-0.5 text-[11px] leading-snug text-white/55">{t.subtitle}</div>}
          </div>
        );
      })}
    </div>
  );
}

function DamageNumbers() {
  const numbers = useRealms((s) => s.numbers);
  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      {numbers.map((n) => (
        <span
          key={n.id}
          className="rl-anim-rise absolute font-semibold tabular-nums"
          style={{
            left: `${n.x * 100}%`,
            top: `${n.y * 100}%`,
            fontSize: n.toPlayer ? 20 : n.crit ? 26 : 18,
            color: n.toPlayer ? '#ff6a58' : n.crit ? '#ffe08a' : '#eaf3ff',
            textShadow: `0 2px 6px rgba(0,0,0,0.9), 0 0 14px ${n.toPlayer ? 'rgba(255,80,60,0.6)' : n.crit ? 'rgba(255,200,110,0.65)' : 'rgba(160,200,255,0.45)'}`,
          }}
        >
          {n.toPlayer ? '-' : ''}{n.amount}{n.crit ? '!' : ''}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Reticle
 * ------------------------------------------------------------------ */

function Reticle() {
  const lockOn = useRealms((s) => s.lockOn);
  const name = useRealms((s) => s.lockName);
  const hp = useRealms((s) => s.lockHp);
  const hpMax = useRealms((s) => s.lockHpMax);
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none">
      {lockOn && name && (
        <div className="absolute left-1/2 top-[-56px] w-[210px] -translate-x-1/2 text-center">
          <div className="rl-display mb-1 text-[10px] tracking-[0.2em] text-white/70 rl-etch">
            {name.toUpperCase()}
          </div>
          <div className="rl-bar h-[5px] rounded-[2px]" style={{ borderColor: 'rgba(255,140,110,0.28)' }}>
            <i style={{
              width: `${Math.max(0, (hp / hpMax) * 100)}%`,
              background: 'linear-gradient(90deg,#a32419,#e2492f)',
              boxShadow: '0 0 10px rgba(226,73,47,0.5)',
            }} />
          </div>
        </div>
      )}
      {lockOn ? (
        <svg width="34" height="34" viewBox="0 0 34 34" style={{ filter: 'drop-shadow(0 0 6px rgba(255,120,90,0.8))' }}>
          <circle cx="17" cy="17" r="11" fill="none" stroke="#ff8a68" strokeWidth="1.2" opacity="0.85" />
          {[0, 90, 180, 270].map((a) => (
            <line key={a} x1="17" y1="2" x2="17" y2="7" stroke="#ff8a68" strokeWidth="1.6"
              transform={`rotate(${a} 17 17)`} />
          ))}
        </svg>
      ) : (
        <div className="h-[3px] w-[3px] rounded-full bg-white/45" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Big text moments
 * ------------------------------------------------------------------ */

function ObjectiveBanner() {
  const text = useRealms((s) => s.objectiveBanner);
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 select-none text-center">
      <div className="rl-anim-banner">
        <div className="mb-2 text-[10px] tracking-[0.42em] text-[var(--gold)]/80">OBJECTIVE</div>
        <div
          className="rl-display text-[30px] font-bold text-[#f6efe0]"
          style={{ textShadow: '0 2px 24px rgba(0,0,0,0.9), 0 0 44px rgba(99,182,255,0.32)' }}
        >
          {text}
        </div>
        <div className="mx-auto mt-3 h-px w-[220px] bg-gradient-to-r from-transparent via-[var(--gold)]/60 to-transparent" />
      </div>
    </div>
  );
}

function CinematicTitle() {
  const t = useRealms((s) => s.cinematicTitle);
  if (!t) return null;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center select-none">
      <div className="rl-anim-in text-center">
        <div
          className="rl-display rl-fluid-xl font-bold leading-none text-[#f7f1e4]"
          style={{ textShadow: '0 6px 60px rgba(0,0,0,0.85), 0 0 90px rgba(99,182,255,0.28)' }}
        >
          {t.title}
        </div>
        <div className="mt-4 text-[12px] tracking-[0.34em] text-white/50 sm:tracking-[0.55em]">{t.subtitle}</div>
      </div>
    </div>
  );
}

/**
 * The discovery card. Set slightly above centre so it never covers the
 * character, and keyed on the landmark so re-entering the trigger replays the
 * animation rather than leaving a stale card on screen.
 */
function Discovery() {
  const d = useRealms((s) => s.discovery);
  if (!d) return null;
  return (
    <div key={d.key} className="pointer-events-none absolute inset-x-0 top-[30%] grid place-items-center select-none">
      <div className="rl-anim-reveal text-center">
        <div className="mb-3 text-[9.5px] font-semibold tracking-[0.42em] text-[#d9b978]/80">DISCOVERED</div>
        <div
          className="rl-display rl-fluid-md font-bold leading-none text-[#f7f1e4]"
          style={{ textShadow: '0 4px 40px rgba(0,0,0,0.9), 0 0 70px rgba(99,182,255,0.22)' }}
        >
          {d.title}
        </div>
        <div className="mx-auto mt-4 h-px w-[210px] bg-gradient-to-r from-transparent via-[#d9b978]/55 to-transparent" />
        <div className="mt-3 text-[11.5px] italic tracking-[0.10em] text-white/50">{d.subtitle}</div>
      </div>
    </div>
  );
}

function Hint() {
  const hint = useRealms((s) => s.hint);
  if (!hint) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 bottom-[92px] -translate-x-1/2 select-none rl-anim-in">
      <div className="text-[11px] tracking-[0.14em] text-white/40">{hint}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Dialogue
 * ------------------------------------------------------------------ */

function Dialogue({ onPress }: { onPress?: (n: string, down: boolean) => void }) {
  const d = useRealms((s) => s.dialogue);
  const touch = useTouch();
  if (!d) return null;
  const line = d.lines[Math.min(d.index, d.lines.length - 1)];
  // Without a keyboard or a mouse button, the panel has to be the button —
  // and the touch action cluster is hidden while anyone is talking, so if
  // this were not tappable a conversation would be a dead end.
  const advance = () => { onPress?.('interact', true); onPress?.('interact', false); };
  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 flex justify-center pb-10 select-none${touch ? ' pointer-events-auto' : ''}`}
      onPointerDown={touch ? (e) => { e.preventDefault(); advance(); } : undefined}
    >
      <div className="rl-panel rl-anim-up w-[720px] max-w-[92vw] rounded-[6px] px-7 py-6">
        <div className="rl-display mb-3 text-[13px] tracking-[0.28em] text-[var(--gold)]/90">
          {line.speaker.toUpperCase()}
        </div>
        <p className="text-[16px] leading-relaxed text-white/88 rl-etch">{line.text}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5">
            {d.lines.map((_, i) => (
              <span key={i} className="h-[3px] w-6 rounded-full"
                style={{ background: i <= d.index ? 'rgba(217,185,120,0.8)' : 'rgba(255,255,255,0.14)' }} />
            ))}
          </div>
          <span className="text-[11px] tracking-[0.16em] text-white/40">
            {touch
              ? (d.index < d.lines.length - 1 ? 'TAP TO CONTINUE' : 'TAP TO END')
              : (d.index < d.lines.length - 1 ? 'F / CLICK — CONTINUE' : 'F / CLICK — END')}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

const RARITY_TEXT: Record<string, string> = {
  common: '#b9c3cf', fine: '#78d59b', rare: '#63b0ff', relic: '#ffb454',
};

/**
 * Every full-screen panel is opened and closed with a key, which is a dead end
 * on a device with no keys. The same control reads as a hint on desktop and as
 * a button everywhere.
 */
function PanelClose({ label, onClose }: { label: string; onClose: () => void }) {
  const touch = useTouch();
  if (!touch) {
    return <span className="text-[11px] tracking-[0.16em] text-white/35">{label}</span>;
  }
  return (
    <button
      className="pointer-events-auto rounded-[4px] border border-white/20 px-7 py-2.5 text-[11px] tracking-[0.22em] text-white/70 active:bg-white/10"
      onPointerDown={(e) => { e.preventDefault(); onClose(); }}
    >
      CLOSE
    </button>
  );
}

function Journal() {
  const open = useRealms((s) => s.showJournal);
  const quests = useRealms((s) => s.quests);
  const inventory = useRealms((s) => s.inventory);
  const discovered = useRealms((s) => s.discovered);
  const level = useRealms((s) => s.level);
  const playTime = useRealms((s) => s.playTime);
  const [tab, setTab] = useState<'quests' | 'items' | 'places'>('quests');
  if (!open) return null;
  const mins = Math.floor(playTime / 60);
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 backdrop-blur-[2px]">
      <div className="rl-panel rl-anim-up flex h-[640px] max-h-[92vh] w-[880px] max-w-[94vw] flex-col rounded-[8px] p-4 sm:p-7">
        <div className="mb-4 shrink-0 flex items-end justify-between border-b border-white/10 pb-3">
          <div>
            <div className="rl-display text-[24px] tracking-[0.20em] text-[#f4ecdb]">JOURNAL</div>
            <div className="mt-1 text-[11px] text-white/40">
              Level {level} · {discovered.length} places found · {mins} min on the shelf
            </div>
          </div>
          <div className="flex gap-1">
            {(['quests', 'items', 'places'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="rounded-[4px] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] transition"
                style={{
                  background: tab === t ? 'rgba(99,182,255,0.16)' : 'transparent',
                  color: tab === t ? '#cfe6ff' : 'rgba(255,255,255,0.45)',
                  border: `1px solid ${tab === t ? 'rgba(99,182,255,0.35)' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 grow overflow-y-auto pr-2">
          {tab === 'quests' && (
            <div className="space-y-5">
              {quests.length === 0 && <p className="text-white/40">Nothing yet.</p>}
              {quests.map((q) => (
                <div key={q.id} className="border-l-2 pl-4"
                  style={{ borderColor: q.complete ? 'rgba(140,220,170,0.5)' : 'rgba(244,212,122,0.6)' }}>
                  <div className="flex items-baseline gap-3">
                    <span className="rl-display text-[16px] text-[#f2e9d6]">{q.title}</span>
                    {q.complete && <span className="text-[10px] uppercase tracking-[0.2em] text-[#8ce0b0]">Complete</span>}
                  </div>
                  <p className="mt-1.5 max-w-[640px] text-[12.5px] leading-relaxed text-white/50">{q.summary}</p>
                  <ul className="mt-2.5 space-y-1">
                    {q.objectives.map((o) => (
                      <li key={o.id} className="text-[12.5px]"
                        style={{ color: o.done ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.8)' }}>
                        <span className="mr-2 text-[var(--gold)]/70">{o.done ? '✓' : '○'}</span>
                        {o.text}
                        {o.target !== undefined && ` (${o.count ?? 0}/${o.target})`}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {tab === 'items' && (
            <div className="grid grid-cols-2 gap-3">
              {inventory.length === 0 && <p className="text-white/40">Your pack is empty.</p>}
              {inventory.map((it) => (
                <div key={it.id} className="rounded-[5px] border border-white/8 bg-white/[0.03] p-3.5">
                  <div className="flex items-baseline justify-between">
                    <span className="rl-display text-[14px]" style={{ color: RARITY_TEXT[it.rarity] }}>{it.name}</span>
                    {it.count > 1 && <span className="text-[11px] tabular-nums text-white/45">×{it.count}</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-white/30">{it.kind}</div>
                  <p className="mt-2 text-[12px] leading-relaxed text-white/55">{it.desc}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'places' && (
            <div className="grid grid-cols-2 gap-3">
              {discovered.length === 0 && <p className="text-white/40">You have not been anywhere yet.</p>}
              {discovered.map((d) => (
                <div key={d} className="rounded-[5px] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <span className="rl-display text-[13px] text-[#dfe9f5]">
                    {d.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 shrink-0 border-t border-white/10 pt-3 text-center">
          <PanelClose
            label="TAB — CLOSE"
            onClose={() => useRealms.getState().set({ showJournal: false })}
          />
        </div>
      </div>
    </div>
  );
}

function MapOverlay() {
  const open = useRealms((s) => s.showMap);
  const blips = useRealms((s) => s.blips);
  const coords = useRealms((s) => s.coords);
  // A fixed 620px disc is taller than a phone held sideways, which pushed the
  // one control that closes it off the bottom of the screen. Size it to
  // whichever of the two axes runs out first.
  const vw = useViewport();
  if (!open) return null;
  const size = Math.max(200, Math.min(620, vw.h - 150, vw.w - 60));
  const range = 1250;
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 backdrop-blur-[2px]">
      <div className="rl-panel rl-anim-up rounded-[8px] p-4 sm:p-6">
        <div className="mb-3 flex items-baseline justify-between gap-6">
          <span className="rl-display text-[16px] tracking-[0.22em] text-[#f4ecdb] sm:text-[20px]">THE SUNDERED SHELF</span>
          <span className="text-[11px] tabular-nums text-white/35">{coords[0]}, {coords[2]}</span>
        </div>
        <div className="relative overflow-hidden rounded-full border border-white/10"
          style={{
            width: size, height: size,
            background: 'radial-gradient(circle at 50% 46%, rgba(44,68,96,0.5), rgba(6,10,16,0.95) 74%)',
          }}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <div key={f} className="absolute rounded-full border border-white/7" style={{ inset: `${(1 - f) * (size / 2)}px` }} />
          ))}
          {blips.map((b) => {
            const d = Math.hypot(b.x, b.y);
            if (d > range) return null;
            const st = MARK_STYLE[b.kind];
            const x = size / 2 + (b.x / range) * (size / 2 - 20);
            const y = size / 2 + (b.y / range) * (size / 2 - 20);
            return (
              <div key={b.id} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-center"
                style={{ left: x, top: y, color: st.color }}>
                <div style={{ fontSize: b.kind === 'landmark' ? 13 : 9, textShadow: `0 0 8px ${st.color}` }}>{st.glyph}</div>
                {b.label && <div className="mt-0.5 text-[9px] tracking-[0.1em] text-white/50">{b.label}</div>}
              </div>
            );
          })}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <svg width="16" height="16" viewBox="0 0 14 14"><path d="M7 0 L12 13 L7 10 L2 13 Z" fill="#f2ecdf" /></svg>
          </div>
        </div>
        <div className="mt-3 text-center">
          <PanelClose
            label="M — CLOSE"
            onClose={() => useRealms.getState().set({ showMap: false })}
          />
        </div>
      </div>
    </div>
  );
}

function PauseMenu({ onResume }: { onResume: () => void }) {
  const paused = useRealms((s) => s.paused);
  const fps = useRealms((s) => s.fps);
  const quality = useRealms((s) => s.quality);
  const touch = useTouch();
  if (!paused) return null;
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/70 backdrop-blur-[3px]">
      <div className="rl-anim-up text-center">
        <div className="rl-display rl-fluid-lg text-[#f4ecdb]">PAUSED</div>
        <div className="mt-3 text-[11px] tracking-[0.24em] text-white/35">
          {fps} FPS · {quality.toUpperCase()} PRESET
        </div>
        <button
          onClick={onResume}
          className="mt-8 rounded-[4px] border border-white/20 px-8 py-2.5 text-[12px] uppercase tracking-[0.22em] text-white/80 transition hover:border-[var(--aether)]/60 hover:text-white"
        >
          Resume
        </button>
        <div className="mt-8 max-w-[420px] text-[11.5px] leading-relaxed text-white/35">
          {touch
            ? 'Left thumb steers — push to the rim to sprint. Right thumb drags to look, '
              + 'pinch to zoom. Attack, roll, jump and your three abilities sit under the '
              + 'right hand; the gold button appears when there is something to use.'
            : 'WASD move · Shift sprint · Space jump · C or Ctrl dodge · Left click attack · '
              + 'Right click heavy · F interact · Q lock on · 1/2/3 abilities · Tab journal · M map'}
        </div>
      </div>
    </div>
  );
}

function DeathScreen() {
  const phase = useRealms((s) => s.phase);
  if (phase !== 'dead') return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div className="rl-anim-in text-center">
        <div className="rl-display rl-fluid-lg text-[#e8bcae]"
          style={{ textShadow: '0 4px 40px rgba(0,0,0,0.9), 0 0 60px rgba(200,60,40,0.35)' }}>
          YOU FELL
        </div>
        <div className="mt-4 text-[12px] tracking-[0.3em] text-white/35">THE SHELF DOES NOT KEEP THE DEAD</div>
      </div>
    </div>
  );
}

function VictoryScreen() {
  const phase = useRealms((s) => s.phase);
  const playTime = useRealms((s) => s.playTime);
  const level = useRealms((s) => s.level);
  const discovered = useRealms((s) => s.discovered);
  if (phase !== 'victory') return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div className="rl-anim-in text-center">
        <div className="text-[11px] tracking-[0.5em] text-[var(--gold)]/70">THE WARDEN OF THE FALL</div>
        <div className="mt-3 rl-display rl-fluid-lg text-[#f7f1e4]"
          style={{ textShadow: '0 6px 60px rgba(0,0,0,0.85), 0 0 90px rgba(99,182,255,0.32)' }}>
          IS DOWN
        </div>
        <div className="mx-auto mt-6 h-px w-[300px] bg-gradient-to-r from-transparent via-[var(--gold)]/60 to-transparent" />
        <div className="mt-6 text-[12px] tracking-[0.2em] text-white/45">
          LEVEL {level} · {discovered.length} PLACES FOUND · {Math.floor(playTime / 60)}m {Math.floor(playTime % 60)}s
        </div>
        <div className="mt-8 text-[12px] tracking-[0.16em] text-white/30">
          The shelf is still floating. Keep walking.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Loading + title
 * ------------------------------------------------------------------ */

export function LoadingScreen() {
  const label = useRealms((s) => s.loadingLabel);
  const progress = useRealms((s) => s.loadingProgress);
  const phase = useRealms((s) => s.phase);
  if (phase !== 'loading' && phase !== 'boot') return null;
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-[#04060a]">
      <div className="w-[420px] max-w-[86vw] text-center">
        <div className="rl-display rl-fluid-md text-white/85"
          style={{ textShadow: '0 0 60px rgba(99,182,255,0.25)' }}>
          REALMS
        </div>
        <div className="mt-2 text-[10px] tracking-[0.52em] text-white/25">THE SUNDERED SHELF</div>
        <div className="mt-10 h-px w-full bg-white/8">
          <div className="h-px bg-gradient-to-r from-[var(--aether)]/40 via-[var(--aether)] to-[var(--aether)]/40"
            style={{ width: `${progress * 100}%`, transition: 'width 300ms ease', boxShadow: '0 0 12px rgba(99,182,255,0.6)' }} />
        </div>
        <div className="mt-3 h-4 text-[11px] tracking-[0.2em] text-white/35">{label}</div>
      </div>
    </div>
  );
}

export function TitleScreen({ onStart }: { onStart: () => void }) {
  const phase = useRealms((s) => s.phase);
  const touch = useTouch();
  const [fading, setFading] = useState(false);
  if (phase !== 'title') return null;
  return (
    <div
      className="absolute inset-0 z-40 grid cursor-pointer place-items-center"
      style={{
        background: 'radial-gradient(ellipse at 50% 60%, rgba(4,6,10,0.35), rgba(4,6,10,0.92) 75%)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 900ms ease',
      }}
      onClick={() => { if (fading) return; setFading(true); onStart(); }}
    >
      <div className="rl-anim-in text-center">
        <div className="rl-display rl-fluid-xl font-bold leading-none text-[#f7f1e4]"
          style={{ textShadow: '0 8px 80px rgba(0,0,0,0.9), 0 0 110px rgba(99,182,255,0.3)' }}>
          REALMS
        </div>
        <div className="mt-5 text-[12px] tracking-[0.34em] text-white/45 sm:tracking-[0.6em]">THE SUNDERED SHELF</div>
        <div className="mx-auto mt-10 h-px w-[260px] bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="mt-8 text-[12px] tracking-[0.26em] text-white/40" style={{ animation: 'rl-pulse 2.6s ease-in-out infinite' }}>
          {touch ? 'TAP TO BEGIN' : 'CLICK TO BEGIN'}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Touch controls
 * ------------------------------------------------------------------ */

/**
 * The virtual stick, drawn where the thumb actually landed.
 *
 * Its position changes every frame a thumb is down, so it is written straight
 * to the DOM from a rAF loop rather than through component state — pushing
 * that through React would re-render the entire HUD sixty times a second to
 * move one circle. The ring fades in under the thumb and follows it out to a
 * rim; reaching the rim is what sprints, so the rim lights up when it does.
 */
function TouchStick() {
  const ring = useRef<HTMLDivElement | null>(null);
  const knob = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let seen = -1;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (touchStick.version === seen) return;
      seen = touchStick.version;
      const r = ring.current, k = knob.current;
      if (!r || !k) return;
      if (!touchStick.active) { r.style.opacity = '0'; k.style.opacity = '0'; return; }
      r.style.opacity = '1';
      k.style.opacity = '1';
      r.style.transform = `translate3d(${touchStick.ox - STICK_R}px, ${touchStick.oy - STICK_R}px, 0)`;
      r.style.borderColor = touchStick.sprint ? 'rgba(167,220,255,0.75)' : 'rgba(190,220,255,0.28)';
      r.style.boxShadow = touchStick.sprint ? '0 0 26px rgba(99,182,255,0.35)' : 'none';
      k.style.transform =
        `translate3d(${touchStick.ox + touchStick.dx - 26}px, ${touchStick.oy + touchStick.dy - 26}px, 0)`;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <div
        ref={ring}
        className="pointer-events-none fixed top-0 left-0 rounded-full border-2"
        style={{
          width: STICK_R * 2, height: STICK_R * 2, opacity: 0,
          background: 'radial-gradient(circle, rgba(10,16,26,0.30), rgba(10,16,26,0.06) 70%)',
          borderColor: 'rgba(190,220,255,0.28)',
          transition: 'opacity 160ms ease, border-color 140ms ease, box-shadow 140ms ease',
        }}
      />
      <div
        ref={knob}
        className="pointer-events-none fixed top-0 left-0 rounded-full"
        style={{
          width: 52, height: 52, opacity: 0,
          background: 'radial-gradient(circle at 40% 35%, rgba(214,234,255,0.80), rgba(120,160,205,0.42))',
          boxShadow: '0 3px 14px rgba(0,0,0,0.5)',
          transition: 'opacity 160ms ease',
        }}
      />
    </>
  );
}

/**
 * Subscribe to a media query. useSyncExternalStore rather than an effect so
 * the first client render already has the right answer and the HUD never
 * flashes its desktop layout on a phone.
 */
function useMedia(query: string) {
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,           // server render: assume the desktop layout
  );
}

/** True on a touch device. */
export function useTouch() { return useMedia('(pointer: coarse)'); }

/** Live viewport size, for panels that have to be sized rather than clamped. */
function useViewport() {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener('resize', cb);
    window.addEventListener('orientationchange', cb);
    return () => {
      window.removeEventListener('resize', cb);
      window.removeEventListener('orientationchange', cb);
    };
  }, []);
  const snap = useSyncExternalStore(
    subscribe,
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => '1280x720',
  );
  const [w, h] = snap.split('x').map(Number);
  return { w, h };
}

/**
 * Landscape is not a preference here. A third-person camera in a portrait
 * window shows the character's shoulders and almost none of the world it is
 * standing in, and the two thumb zones end up stacked on top of each other.
 */
function RotatePrompt() {
  const touch = useTouch();
  const portrait = useMedia('(orientation: portrait)');
  const [dismissed, setDismissed] = useState(false);
  if (!touch || !portrait || dismissed) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-[#04060a]/95 px-8 text-center">
      <div>
        <div className="mx-auto mb-6 h-[54px] w-[86px] rounded-[8px] border-2 border-white/30" style={{ animation: 'rl-rotate-hint 2.4s ease-in-out infinite' }} />
        <div className="rl-display text-[22px] tracking-[0.22em] text-[#f3ecdd]">TURN YOUR DEVICE</div>
        <div className="mt-3 text-[12px] leading-relaxed text-white/45">REALMS is built for landscape.</div>
        <button
          className="pointer-events-auto mt-8 rounded-[4px] border border-white/15 px-5 py-2.5 text-[11px] tracking-[0.2em] text-white/50 active:bg-white/10"
          onClick={() => setDismissed(true)}
        >
          PLAY ANYWAY
        </button>
      </div>
    </div>
  );
}

export function TouchControls({ onPress }: { onPress: (name: string, down: boolean) => void }) {
  const touch = useTouch();
  const phase = useRealms((s) => s.phase);
  const prompt = useRealms((s) => s.prompt);
  const dialogue = useRealms((s) => s.dialogue);
  const abilities = useRealms((s) => s.abilities);
  const energy = useRealms((s) => s.energy);
  const paused = useRealms((s) => s.paused);
  const showMap = useRealms((s) => s.showMap);
  const showJournal = useRealms((s) => s.showJournal);
  if (!touch) return null;
  const live = (phase === 'playing' || phase === 'dead') && !paused && !showMap && !showJournal;
  return (
    <>
      <RotatePrompt />
      {live && !dialogue && (
        <div className="pointer-events-none absolute inset-0 z-20 select-none">
          <TouchStick />
          {/* Everything the right thumb needs, in one cluster it can reach
              without the hand moving: abilities on the upper row, the three
              things you do constantly on the lower one, attack the largest
              and closest to where the thumb rests. */}
          <div
            className="absolute"
            style={{
              right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
            }}
          >
            <div className="relative" style={{ width: 210, height: 124 }}>
              {abilities.slice(0, 3).map((a, i) => (
                <TouchAbility key={a.id} ability={a} energy={energy} x={i * 58} y={0} onPress={onPress} />
              ))}
              <TouchBtn name="lockOn" label="Lock" size={44} x={166} y={3} onPress={onPress} />
              <TouchBtn name="dodge" label="Roll" size={58} x={0} y={64} onPress={onPress} />
              <TouchBtn name="attack" label="Attack" size={82} x={64} y={40} onPress={onPress} primary />
              <TouchBtn name="jump" label="Jump" size={58} x={152} y={64} onPress={onPress} />
            </div>
          </div>
          {prompt && (
            <button
              className="rl-panel pointer-events-auto absolute grid place-items-center rounded-full border-[#d9b978]/50 text-[11px] uppercase tracking-[0.12em] text-[#f3ecdd] active:bg-white/15"
              style={{
                width: 66, height: 66,
                right: 'calc(env(safe-area-inset-right, 0px) + 236px)',
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 58px)',
                animation: 'rl-pulse 1.6s ease-in-out infinite',
              }}
              onPointerDown={(e) => { e.preventDefault(); onPress('interact', true); }}
              onPointerUp={(e) => { e.preventDefault(); onPress('interact', false); }}
            >
              Use
            </button>
          )}
          {/* Menu, map and journal are keys on a keyboard. Here they are a
              column tucked into the top-left corner, clear of both thumbs. */}
          <div
            className="absolute flex flex-col gap-1.5"
            style={{
              left: 'calc(env(safe-area-inset-left, 0px) + 12px)',
              top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
            }}
          >
            <TouchIcon name="pause" label="Menu" onPress={onPress}>
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </TouchIcon>
            <TouchIcon name="map" label="Map" onPress={onPress}>
              <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Zm0 0v13m6 2.5v-13" strokeLinejoin="round" />
            </TouchIcon>
            <TouchIcon name="journal" label="Journal" onPress={onPress}>
              <path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2v-13Zm0 0v13m4-9h6m-6 4h6" strokeLinejoin="round" />
            </TouchIcon>
          </div>
        </div>
      )}
    </>
  );
}

/** An ability button carrying its own cooldown sweep and readiness state. */
function TouchAbility({
  ability, energy, x, y, onPress,
}: {
  ability: { id: string; key: string; cooldown: number; cooldownMax: number; cost: number };
  energy: number; x: number; y: number;
  onPress: (n: string, down: boolean) => void;
}) {
  const cooling = ability.cooldown > 0.001;
  const ready = !cooling && energy >= ability.cost;
  const slot = ability.key;
  return (
    <button
      className="rl-panel pointer-events-auto absolute grid place-items-center overflow-hidden rounded-full active:bg-white/20"
      style={{
        width: 50, height: 50, left: x, top: y,
        borderColor: ready ? 'rgba(99,182,255,0.45)' : 'rgba(140,175,215,0.14)',
      }}
      aria-label={`Ability ${slot}`}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onPress(`ability${slot}`, true); }}
      onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); onPress(`ability${slot}`, false); }}
      onPointerCancel={() => onPress(`ability${slot}`, false)}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ opacity: ready ? 1 : 0.32 }}>
        <path d={ABILITY_GLYPH[ability.id]} fill="none" stroke={ready ? '#a7dcff' : '#7c93ad'} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {cooling && (
        <>
          <span
            className="absolute inset-0 bg-black/62"
            style={{ clipPath: `inset(0 0 ${(1 - ability.cooldown / ability.cooldownMax) * 100}% 0)` }}
          />
          <span className="absolute inset-0 grid place-items-center text-[13px] font-semibold tabular-nums text-white/85">
            {ability.cooldown.toFixed(0)}
          </span>
        </>
      )}
    </button>
  );
}

function TouchIcon({
  name, label, onPress, children,
}: {
  name: string; label: string;
  onPress: (n: string, down: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="rl-panel pointer-events-auto grid h-[34px] w-[38px] place-items-center rounded-[6px] text-white/55 active:bg-white/15"
      aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onPress(name, true); }}
      onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); onPress(name, false); }}
    >
      <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" stroke="currentColor" strokeWidth="1.6" fill="none">
        {children}
      </svg>
    </button>
  );
}

function TouchBtn({
  name, label, size, x, y, onPress, primary = false,
}: {
  name: string; label: string; size: number; x: number; y: number;
  onPress: (n: string, down: boolean) => void; primary?: boolean;
}) {
  return (
    <button
      className="rl-panel pointer-events-auto absolute grid place-items-center rounded-full uppercase tracking-[0.1em] text-white/75 active:bg-white/20"
      style={{
        width: size, height: size, left: x, top: y,
        fontSize: primary ? 12 : 10,
        borderColor: primary ? 'rgba(99,182,255,0.40)' : undefined,
      }}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onPress(name, true); }}
      onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); onPress(name, false); }}
      onPointerCancel={() => onPress(name, false)}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Root
 * ------------------------------------------------------------------ */

function DebugStats() {
  const show = useRealms((s) => s.showDebug);
  const fps = useRealms((s) => s.fps);
  const coords = useRealms((s) => s.coords);
  const quality = useRealms((s) => s.quality);
  const drawCalls = useRealms((s) => s.drawCalls);
  const tris = useRealms((s) => s.tris);
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] tabular-nums text-white/50">
      {fps} fps · {quality} · {drawCalls} draws · {(tris / 1000).toFixed(0)}k tris · {coords[0]},{coords[1]},{coords[2]}
    </div>
  );
}

export function Hud({ onResume, onPress }: { onResume: () => void; onPress: (n: string, down: boolean) => void }) {
  const phase = useRealms((s) => s.phase);
  const touch = useTouch();
  const visible = phase === 'playing' || phase === 'dead' || phase === 'victory';
  const dim = phase === 'dead' || phase === 'victory';
  return (
    <div className={`pointer-events-none absolute inset-0 z-10 font-sans${touch ? ' rl-touch' : ''}`}>
      <CinematicTitle />
      <ObjectiveBanner />
      {visible && (
        <div style={{ opacity: dim ? 0.25 : 1, transition: 'opacity 600ms ease' }}>
          <Compass />
          <Minimap />
          <Discovery />
          <QuestTracker />
          <Vitals />
          {/* On touch the abilities live in the right-thumb cluster, with
              their cooldowns on them; a second row would be the same three
              buttons twice. */}
          {!touch && <Abilities />}
          <BossBar />
          <InteractPrompt />
          <Reticle />
          <Hint />
        </div>
      )}
      <Toasts />
      <DamageNumbers />
      <div className="pointer-events-auto"><Dialogue onPress={onPress} /></div>
      <div className="pointer-events-auto"><Journal /></div>
      <div className="pointer-events-auto"><MapOverlay /></div>
      <div className="pointer-events-auto"><PauseMenu onResume={onResume} /></div>
      <DeathScreen />
      <VictoryScreen />
      <DebugStats />
    </div>
  );
}

export default Hud;
