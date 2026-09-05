/**
 * REALMS — procedural audio.
 *
 * No audio files ship with the game: wind, water, combat and the score are all
 * synthesised through Web Audio. That keeps first-load instant (the opening
 * wind starts before the world has finished building) and lets the music
 * respond continuously to combat state instead of cross-fading stems.
 *
 * Buses:  master -> [music, ambient, sfx]
 */

import { clamp01, lerp } from './math';

type Bus = 'music' | 'ambient' | 'sfx';

const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Aeolian scale degree -> semitone offset, wrapping octaves. */
function degree(d: number) {
  const oct = Math.floor(d / 7);
  return MINOR[((d % 7) + 7) % 7] + oct * 12;
}
const hz = (semitoneFromA4: number) => 440 * Math.pow(2, semitoneFromA4 / 12);

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private convolver: ConvolverNode | null = null;
  private reverbSend!: GainNode;
  private noiseBuffer!: AudioBuffer;

  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private waterFilter!: BiquadFilterNode;

  private started = false;
  private musicTimer = 0;
  private bar = 0;
  private nextNoteTime = 0;
  private schedulerId: number | null = null;

  /** 0 = calm exploration, 1 = full combat. Smoothed internally. */
  intensity = 0;
  private intensitySm = 0;
  /** Set true during the opening cinematic for the sparse theme statement. */
  cinematic = true;
  muted = false;
  private volume = 0.85;

  async start() {
    if (this.started) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    this.buses = {
      music: ctx.createGain(),
      ambient: ctx.createGain(),
      sfx: ctx.createGain(),
    };
    this.buses.music.gain.value = 0.0;   // faded in by the intro
    this.buses.ambient.gain.value = 0.9;
    this.buses.sfx.gain.value = 0.85;
    for (const b of Object.values(this.buses)) b.connect(this.master);

    // Simple algorithmic reverb impulse — a big stone hall in the sky.
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.makeImpulse(3.4, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.master);

    this.noiseBuffer = this.makeNoise(4);

    // ---- wind ----
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 480;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.buses.ambient);
    wind.start();

    // gusts
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(this.windFilter.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.041;
    const lfo2g = ctx.createGain();
    lfo2g.gain.value = 0.06;
    lfo2.connect(lfo2g).connect(this.windGain.gain);
    lfo2.start();

    // ---- water (distance-driven) ----
    const water = ctx.createBufferSource();
    water.buffer = this.noiseBuffer;
    water.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'lowpass';
    this.waterFilter.frequency.value = 2100;
    this.waterFilter.Q.value = 0.4;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(this.waterFilter).connect(this.waterGain).connect(this.buses.ambient);
    water.start();

    this.nextNoteTime = ctx.currentTime + 0.2;
    this.schedulerId = window.setInterval(() => this.schedule(), 60);

    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  }

  resume() { this.ctx?.resume().catch(() => {}); }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }
  setVolume(v: number) {
    this.volume = clamp01(v);
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  private makeNoise(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // light pinking so it sounds like air, not static
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    // taper the loop point
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) {
      const t = i / f;
      d[i] *= t;
      d[len - 1 - i] *= t;
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - Math.exp(-i / 400));
      }
    }
    return buf;
  }

  /* ------------------------------------------------------------ *
   * Ambience drivers, called every frame from the game loop.
   * ------------------------------------------------------------ */
  updateAmbience(dt: number, opts: { altitude: number; exposure: number; waterProximity: number; indoors: number }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const windTarget = lerp(0.055, 0.30, clamp01(opts.exposure)) * (1 - 0.75 * clamp01(opts.indoors));
    this.windGain.gain.setTargetAtTime(windTarget, t, 0.9);
    this.windFilter.frequency.setTargetAtTime(360 + clamp01(opts.altitude) * 620, t, 1.4);
    this.waterGain.gain.setTargetAtTime(clamp01(opts.waterProximity) * 0.34, t, 0.5);
    this.waterFilter.frequency.setTargetAtTime(900 + clamp01(opts.waterProximity) * 2600, t, 0.6);

    this.intensitySm = lerp(this.intensitySm, clamp01(this.intensity), 1 - Math.exp(-dt * 1.2));
    this.musicTimer += dt;
  }

  /** Ramp the score in over `seconds` — used by the opening fade. */
  fadeInMusic(seconds = 6, level = 0.5) {
    if (!this.ctx) return;
    const g = this.buses.music.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(level, this.ctx.currentTime + seconds);
  }
  setMusicLevel(level: number, seconds = 2) {
    if (!this.ctx) return;
    const g = this.buses.music.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(level, this.ctx.currentTime + seconds);
  }

  /* ------------------------------------------------------------ *
   * The score. Four-bar loop over a slow i - VI - III - VII in D minor,
   * with a horn motif that only states itself when the world is calm.
   * ------------------------------------------------------------ */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const spb = 60 / 52;                 // 52 bpm, unhurried
    const barLen = spb * 4;
    while (this.nextNoteTime < ctx.currentTime + 1.2) {
      this.playBar(this.nextNoteTime, this.bar);
      this.nextNoteTime += barLen;
      this.bar++;
    }
  }

  private playBar(t0: number, bar: number) {
    const spb = 60 / 52;
    const intensity = this.intensitySm;
    // D minor: root offsets from A4 for D3 = -19
    const roots = [-19, -24, -15, -17];       // Dm, Bb, F, C  (transposed low)
    const root = roots[bar % 4];
    const chordDegrees = [0, 2, 4, 6];

    // --- pad ---
    for (const d of chordDegrees.slice(0, 3)) {
      const f = hz(root + degree(d));
      this.pad(t0, spb * 4.1, f, 0.055 * (1 - 0.35 * intensity));
      this.pad(t0 + 0.02, spb * 4.1, f * 2.0025, 0.022);
    }

    // --- low drone / taiko when the world turns hostile ---
    if (intensity > 0.12) {
      this.drum(t0, 0.55 * intensity);
      this.drum(t0 + spb * 2, 0.4 * intensity);
      if (intensity > 0.6) {
        this.drum(t0 + spb * 3, 0.3 * intensity);
        this.drum(t0 + spb * 3.5, 0.25 * intensity);
      }
      const f = hz(root - 12);
      this.pad(t0, spb * 4, f, 0.08 * intensity, 'sawtooth', 220);
    }

    // --- harp arpeggio, thins out in combat ---
    const arpCount = intensity > 0.5 ? 0 : 6;
    for (let i = 0; i < arpCount; i++) {
      const d = [0, 2, 4, 7, 4, 2][i];
      const when = t0 + i * spb * (2 / 3);
      this.pluck(when, hz(root + 24 + degree(d)), 0.10 * (1 - intensity));
    }

    // --- the REALMS motif: a four-note falling horn call ---
    const motifBar = bar % 8;
    if ((this.cinematic || intensity < 0.25) && (motifBar === 0 || motifBar === 4)) {
      const oct = 12;
      const seq: Array<[number, number, number]> = motifBar === 0
        ? [[0, 0, 1.6], [1.6, 4, 0.9], [2.6, 2, 0.9], [3.4, 0, 2.2]]
        : [[0, 4, 1.4], [1.4, 6, 0.9], [2.3, 4, 0.9], [3.2, 1, 2.4]];
      for (const [beat, deg, dur] of seq) {
        this.horn(t0 + beat * spb, hz(root + oct + degree(deg)), dur * spb, 0.085);
      }
    }
  }

  private pad(t: number, dur: number, freq: number, gain: number, type: OscillatorType = 'sawtooth', cutoff = 700) {
    const ctx = this.ctx!;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = type; o2.type = type;
    o1.frequency.value = freq;
    o2.frequency.value = freq * 1.006;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 0.5, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.32);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o1.connect(f); o2.connect(f);
    f.connect(g);
    g.connect(this.buses.music);
    g.connect(this.reverbSend);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  private pluck(t: number, freq: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g);
    g.connect(this.buses.music);
    g.connect(this.reverbSend);
    o.start(t); o.stop(t + 1.6);
  }

  private horn(t: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq * 0.995, t);
    o.frequency.linearRampToValueAtTime(freq, t + 0.09);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1500, t + 0.2);
    f.frequency.linearRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.14);
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(f); o2.connect(g2); g2.connect(f);
    f.connect(g);
    g.connect(this.buses.music);
    g.connect(this.reverbSend);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.6); o2.stop(t + dur + 0.6);
  }

  private drum(t: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.buses.music);
    o.start(t); o.stop(t + 0.55);

    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.playbackRate.value = 0.6;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass'; nf.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(nf).connect(ng).connect(this.buses.music);
    n.start(t); n.stop(t + 0.2);
  }

  /* ------------------------------------------------------------ *
   * SFX
   * ------------------------------------------------------------ */
  private noiseBurst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 1, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.015, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.buses.sfx);
    n.start(t); n.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', bend = 1, delay = 0, reverb = 0.2) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.buses.sfx);
    if (reverb > 0) {
      const rg = ctx.createGain(); rg.gain.value = reverb;
      g.connect(rg).connect(this.reverbSend);
    }
    o.start(t); o.stop(t + dur + 0.05);
  }

  sfx(name: string, vol = 1) {
    if (!this.ctx) return;
    switch (name) {
      case 'swing':
        this.noiseBurst(0.26, 'bandpass', 2600, 420, 0.20 * vol, 1.4);
        break;
      case 'swingHeavy':
        this.noiseBurst(0.42, 'bandpass', 1500, 190, 0.28 * vol, 1.1);
        this.tone(160, 0.35, 0.07 * vol, 'sine', 0.4);
        break;
      case 'hit':
        this.noiseBurst(0.16, 'lowpass', 3000, 400, 0.30 * vol, 0.8);
        this.tone(110, 0.20, 0.16 * vol, 'triangle', 0.45);
        break;
      case 'hitCrit':
        this.noiseBurst(0.22, 'bandpass', 4200, 800, 0.32 * vol, 1.2);
        this.tone(180, 0.3, 0.18 * vol, 'square', 0.35);
        this.tone(720, 0.4, 0.07 * vol, 'sine', 1.6, 0.02);
        break;
      case 'block':
        this.noiseBurst(0.13, 'bandpass', 5200, 2600, 0.26 * vol, 4);
        this.tone(1400, 0.22, 0.06 * vol, 'square', 0.8);
        break;
      case 'hurt':
        this.tone(190, 0.28, 0.16 * vol, 'sawtooth', 0.5);
        this.noiseBurst(0.2, 'lowpass', 1200, 300, 0.2 * vol);
        break;
      case 'dodge':
        this.noiseBurst(0.28, 'bandpass', 900, 3000, 0.13 * vol, 2);
        break;
      case 'jump':
        this.noiseBurst(0.14, 'bandpass', 700, 1600, 0.10 * vol, 2);
        break;
      case 'land':
        this.noiseBurst(0.18, 'lowpass', 900, 180, 0.17 * vol);
        this.tone(80, 0.18, 0.10 * vol, 'sine', 0.6);
        break;
      case 'step':
        this.noiseBurst(0.09, 'bandpass', 900 + Math.random() * 500, 300, 0.055 * vol, 1.2);
        break;
      case 'stepGrass':
        this.noiseBurst(0.11, 'highpass', 1800, 2600, 0.035 * vol, 0.7);
        break;
      case 'pickup':
        this.tone(880, 0.14, 0.10 * vol, 'sine', 1.5);
        this.tone(1320, 0.22, 0.07 * vol, 'sine', 1.4, 0.06);
        break;
      case 'discover':
        this.tone(523.25, 0.9, 0.10 * vol, 'sine', 1.0, 0, 0.7);
        this.tone(659.25, 0.9, 0.08 * vol, 'sine', 1.0, 0.12, 0.7);
        this.tone(987.77, 1.4, 0.07 * vol, 'sine', 1.0, 0.26, 0.9);
        break;
      case 'quest':
        this.tone(392, 0.5, 0.09 * vol, 'triangle', 1, 0, 0.6);
        this.tone(587.33, 0.7, 0.08 * vol, 'triangle', 1, 0.14, 0.6);
        break;
      case 'levelup':
        [0, 4, 7, 12, 16].forEach((s, i) =>
          this.tone(hz(-5 + s), 0.8, 0.10 * vol, 'triangle', 1, i * 0.09, 0.8));
        break;
      case 'castSurge':
        this.tone(220, 0.5, 0.10 * vol, 'sawtooth', 3.2, 0, 0.5);
        this.noiseBurst(0.5, 'highpass', 600, 5200, 0.11 * vol, 0.8);
        break;
      case 'castHeal':
        this.tone(660, 1.1, 0.07 * vol, 'sine', 1.5, 0, 0.9);
        this.tone(990, 1.3, 0.05 * vol, 'sine', 1.5, 0.1, 0.9);
        break;
      case 'castDash':
        this.noiseBurst(0.4, 'bandpass', 400, 4000, 0.16 * vol, 1.5);
        this.tone(140, 0.3, 0.1 * vol, 'square', 2.4);
        break;
      case 'wolfHowl':
        this.tone(320, 1.6, 0.09 * vol, 'sawtooth', 1.25, 0, 1.0);
        this.tone(480, 1.4, 0.045 * vol, 'sine', 1.3, 0.1, 1.0);
        break;
      case 'wolfBark':
        this.tone(300, 0.14, 0.10 * vol, 'sawtooth', 0.55);
        this.noiseBurst(0.12, 'bandpass', 1200, 500, 0.09 * vol, 1.5);
        break;
      case 'enemyDeath':
        this.noiseBurst(0.6, 'lowpass', 2200, 120, 0.22 * vol);
        this.tone(140, 0.7, 0.11 * vol, 'sawtooth', 0.35, 0, 0.5);
        break;
      case 'bossRoar':
        this.tone(78, 2.2, 0.26 * vol, 'sawtooth', 0.75, 0, 0.8);
        this.tone(117, 2.0, 0.14 * vol, 'square', 0.8, 0.05, 0.8);
        this.noiseBurst(2.0, 'lowpass', 1400, 200, 0.20 * vol);
        break;
      case 'bossSlam':
        this.tone(60, 1.1, 0.30 * vol, 'sine', 0.5, 0, 0.6);
        this.noiseBurst(0.9, 'lowpass', 2600, 100, 0.28 * vol);
        break;
      case 'shardBreak':
        this.noiseBurst(0.5, 'highpass', 3000, 8000, 0.16 * vol, 0.9);
        [1200, 1600, 2400].forEach((f, i) => this.tone(f, 0.5, 0.05 * vol, 'sine', 0.6, i * 0.03, 0.8));
        break;
      case 'ui':
        this.tone(1200, 0.06, 0.05 * vol, 'square', 1, 0, 0);
        break;
      case 'gateOpen':
        this.tone(55, 2.6, 0.20 * vol, 'sawtooth', 1.1, 0, 0.9);
        this.noiseBurst(2.4, 'lowpass', 700, 160, 0.16 * vol);
        break;
    }
  }

  dispose() {
    if (this.schedulerId !== null) window.clearInterval(this.schedulerId);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.started = false;
  }
}

export const audio = new AudioEngine();
