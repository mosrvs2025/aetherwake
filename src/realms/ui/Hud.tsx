'use client';

/**
 * REALMS — the interface.
 *
 * Everything reads from the store with narrow selectors so a health tick does
 * not re-render the minimap. The HUD is pure DOM/CSS on top of the canvas:
 * cheaper than drawing it in WebGL, crisper at any DPI, and it keeps the
 * renderer free for the world.
 */

import { useEffect, useState } from 'react';
import { useRealms, type CompassMark, type MinimapBlip } from '../game/state';

/* ------------------------------------------------------------------ *
 * Bits
 * ------------------------------------------------------------------ */

function Bar({
  value, max, color, glow, height = 10, label, showText = false, ghost = true,
}: {
  value: number; max: number; color: string; glow?: string; height?: number;
  label?: string; showText?: boolean; ghost?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100;
  return (
    <div className="relative">
      <div className="rl-bar rounded-[3px]" style={{ height }}>
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
    <div className="pointer-events-none absolute bottom-5 left-5 flex items-end gap-3 select-none">
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
          value={hp} max={hpMax} height={16} label="Vitality" showText
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
  return (
    <div className="pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-[26px] select-none">
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
    <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 select-none">
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
          const x = place(a - yaw - Math.PI);
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
    <div className="pointer-events-none absolute right-5 top-5 select-none">
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
    <div className="pointer-events-none absolute left-5 top-5 w-[268px] select-none rl-anim-up">
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
  if (!prompt || dialogue) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 bottom-[26%] -translate-x-1/2 select-none rl-anim-up">
      <div className="rl-panel flex items-center gap-2.5 rounded-[5px] px-3 py-2">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-[4px] border border-white/25 bg-white/8 text-[11px] font-bold text-white/90">
          {prompt.key}
        </span>
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
    <div className="pointer-events-none absolute right-5 top-[210px] flex w-[290px] flex-col gap-2 select-none">
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
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none">
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
          className="rl-display text-[76px] font-bold leading-none tracking-[0.30em] text-[#f7f1e4]"
          style={{ textShadow: '0 6px 60px rgba(0,0,0,0.85), 0 0 90px rgba(99,182,255,0.28)' }}
        >
          REALMS
        </div>
        <div className="mt-4 text-[12px] tracking-[0.55em] text-white/50">{t.subtitle}</div>
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

function Dialogue() {
  const d = useRealms((s) => s.dialogue);
  if (!d) return null;
  const line = d.lines[Math.min(d.index, d.lines.length - 1)];
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center pb-10 select-none">
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
            {d.index < d.lines.length - 1 ? 'F / CLICK — CONTINUE' : 'F / CLICK — END'}
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
      <div className="rl-panel rl-anim-up h-[640px] max-h-[86vh] w-[880px] max-w-[94vw] rounded-[8px] p-7">
        <div className="mb-5 flex items-end justify-between border-b border-white/10 pb-4">
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

        <div className="h-[478px] overflow-y-auto pr-2">
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

        <div className="mt-4 border-t border-white/10 pt-3 text-center text-[11px] tracking-[0.16em] text-white/35">
          TAB — CLOSE
        </div>
      </div>
    </div>
  );
}

function MapOverlay() {
  const open = useRealms((s) => s.showMap);
  const blips = useRealms((s) => s.blips);
  const coords = useRealms((s) => s.coords);
  if (!open) return null;
  const size = 620;
  const range = 1250;
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 backdrop-blur-[2px]">
      <div className="rl-panel rl-anim-up rounded-[8px] p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <span className="rl-display text-[20px] tracking-[0.22em] text-[#f4ecdb]">THE SUNDERED SHELF</span>
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
        <div className="mt-4 text-center text-[11px] tracking-[0.16em] text-white/35">M — CLOSE</div>
      </div>
    </div>
  );
}

function PauseMenu({ onResume }: { onResume: () => void }) {
  const paused = useRealms((s) => s.paused);
  const fps = useRealms((s) => s.fps);
  const quality = useRealms((s) => s.quality);
  if (!paused) return null;
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/70 backdrop-blur-[3px]">
      <div className="rl-anim-up text-center">
        <div className="rl-display text-[48px] tracking-[0.34em] text-[#f4ecdb]">PAUSED</div>
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
          WASD move · Shift sprint · Space jump · C or Ctrl dodge · Left click attack ·
          Right click heavy · F interact · Q lock on · 1/2/3 abilities · Tab journal · M map
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
        <div className="rl-display text-[56px] tracking-[0.32em] text-[#e8bcae]"
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
        <div className="mt-3 rl-display text-[62px] tracking-[0.26em] text-[#f7f1e4]"
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
        <div className="rl-display text-[44px] tracking-[0.42em] text-white/85"
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
        <div className="rl-display text-[86px] font-bold leading-none tracking-[0.30em] text-[#f7f1e4]"
          style={{ textShadow: '0 8px 80px rgba(0,0,0,0.9), 0 0 110px rgba(99,182,255,0.3)' }}>
          REALMS
        </div>
        <div className="mt-5 text-[12px] tracking-[0.6em] text-white/45">THE SUNDERED SHELF</div>
        <div className="mx-auto mt-10 h-px w-[260px] bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="mt-8 text-[12px] tracking-[0.26em] text-white/40" style={{ animation: 'rl-pulse 2.6s ease-in-out infinite' }}>
          CLICK TO BEGIN
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Touch controls
 * ------------------------------------------------------------------ */

export function TouchControls({ onPress }: { onPress: (name: string, down: boolean) => void }) {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const check = () => setTouch(window.matchMedia('(pointer: coarse)').matches);
    check();
  }, []);
  const phase = useRealms((s) => s.phase);
  if (!touch || (phase !== 'playing' && phase !== 'dead')) return null;
  const btn = (name: string, label: string, cls: string) => (
    <button
      key={name}
      className={`rl-panel pointer-events-auto grid place-items-center rounded-full text-[11px] uppercase tracking-[0.1em] text-white/75 active:bg-white/15 ${cls}`}
      onPointerDown={(e) => { e.preventDefault(); onPress(name, true); }}
      onPointerUp={(e) => { e.preventDefault(); onPress(name, false); }}
    >
      {label}
    </button>
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute bottom-6 right-6 grid grid-cols-3 gap-2" style={{ width: 230 }}>
        {btn('attack', 'Hit', 'h-[70px] w-[70px] col-start-2')}
        {btn('dodge', 'Roll', 'h-[58px] w-[58px] col-start-1 row-start-2')}
        {btn('jump', 'Jump', 'h-[58px] w-[58px] col-start-3 row-start-2')}
        {btn('interact', 'F', 'h-[52px] w-[52px] col-start-2 row-start-3')}
      </div>
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-2">
        {btn('ability1', '1', 'h-[46px] w-[46px]')}
        {btn('ability2', '2', 'h-[46px] w-[46px]')}
        {btn('ability3', '3', 'h-[46px] w-[46px]')}
        {btn('sprint', 'Run', 'h-[46px] w-[46px]')}
      </div>
    </div>
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
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[10px] tabular-nums text-white/50">
      {fps} fps · {quality} · {coords[0]},{coords[1]},{coords[2]}
    </div>
  );
}

export function Hud({ onResume }: { onResume: () => void }) {
  const phase = useRealms((s) => s.phase);
  const visible = phase === 'playing' || phase === 'dead' || phase === 'victory';
  const dim = phase === 'dead' || phase === 'victory';
  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-sans">
      <CinematicTitle />
      <ObjectiveBanner />
      {visible && (
        <div style={{ opacity: dim ? 0.25 : 1, transition: 'opacity 600ms ease' }}>
          <Compass />
          <Minimap />
          <QuestTracker />
          <Vitals />
          <Abilities />
          <BossBar />
          <InteractPrompt />
          <Reticle />
          <Hint />
        </div>
      )}
      <Toasts />
      <DamageNumbers />
      <div className="pointer-events-auto"><Dialogue /></div>
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
