let ctx: AudioContext | null = null;
let started = false;
let gain: GainNode | null = null;
let drone: OscillatorNode | null = null;
let drone2: OscillatorNode | null = null;
let lfo: OscillatorNode | null = null;

export function unlockAudio() {
  if (started) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  gain = ctx.createGain();
  gain.gain.value = 0.04;
  gain.connect(ctx.destination);
  drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = 72;
  drone2 = ctx.createOscillator();
  drone2.type = "triangle";
  drone2.frequency.value = 108;
  lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 8;
  lfo.connect(lfoGain);
  lfoGain.connect(drone.frequency);
  const g1 = ctx.createGain();
  g1.gain.value = 0.5;
  const g2 = ctx.createGain();
  g2.gain.value = 0.18;
  drone.connect(g1);
  drone2.connect(g2);
  g1.connect(gain);
  g2.connect(gain);
  drone.start();
  drone2.start();
  lfo.start();
  started = true;
}

export function setDrone(biome: string, night: boolean) {
  if (!drone || !drone2) return;
  const map: Record<string, [number, number]> = {
    vale: [72, 108],
    hearthmere: [64, 96],
    ember: [58, 87],
    storm: [80, 160],
    mycelia: [54, 81],
    tide: [60, 90],
    crag: [48, 96],
    hollow: [40, 50],
    weft: [90, 135],
  };
  const [a, b] = map[biome] ?? map.vale;
  drone.frequency.setTargetAtTime(night ? a * 0.92 : a, ctx!.currentTime, 1.4);
  drone2.frequency.setTargetAtTime(night ? b * 0.9 : b, ctx!.currentTime, 1.4);
}

export function sting(kind: "absorb" | "hit" | "braid" | "ui") {
  if (!ctx || !gain) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g);
  g.connect(gain);
  const now = ctx.currentTime;
  if (kind === "absorb") {
    o.type = "sine";
    o.frequency.setValueAtTime(220, now);
    o.frequency.exponentialRampToValueAtTime(880, now + 0.4);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.9, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    o.start(now);
    o.stop(now + 0.72);
  } else if (kind === "braid") {
    o.type = "triangle";
    o.frequency.setValueAtTime(330, now);
    o.frequency.exponentialRampToValueAtTime(990, now + 0.55);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.8, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    o.start(now);
    o.stop(now + 0.82);
  } else if (kind === "hit") {
    o.type = "square";
    o.frequency.value = 90;
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.start(now);
    o.stop(now + 0.13);
  } else {
    o.type = "sine";
    o.frequency.value = 520;
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    o.start(now);
    o.stop(now + 0.1);
  }
}
