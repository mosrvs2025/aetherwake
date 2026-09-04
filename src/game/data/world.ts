export const WORLD = {
  size: 360,
  half: 180,
  water: 2.45,
  segments: 128,
} as const;

export type Biome =
  | "vale"
  | "hearthmere"
  | "ember"
  | "storm"
  | "mycelia"
  | "tide"
  | "crag"
  | "hollow";

function hash(ix: number, iz: number) {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number) {
  return (
    noise(x, z) +
    0.5 * noise(x * 2.03, z * 2.03) +
    0.25 * noise(x * 4.07, z * 4.07) +
    0.125 * noise(x * 8.1, z * 8.13)
  );
}

function ridged(x: number, z: number) {
  const n = 1 - Math.abs(fbm(x, z) * 2 - 1);
  return n * n;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function heightAt(x: number, z: number): number {
  const n = fbm(x * 0.011, z * 0.011);
  const n2 = fbm(x * 0.037 + 17, z * 0.037);
  let h = 6.2 + n * 9.5 + n2 * 2.2;

  const dist = Math.hypot(x, z);
  h += Math.max(0, dist - 95) * 0.07;

  if (x > 42) {
    h -= (x - 42) * 0.035;
    h += Math.abs(ridged(x * 0.028, z * 0.07)) * 3.4;
  }

  if (z < -38) {
    h += (-38 - z) * 0.085 + ridged(x * 0.018, z * 0.02) * 7.5;
  }

  if (z > 52) {
    h += Math.max(0, Math.sin(x * 0.07) * Math.sin(z * 0.065)) * 5.5;
    h += ridged(x * 0.05 + 4, z * 0.05) * 2;
  }

  if (x < -58) {
    h = Math.min(h, 1.55 + n2 * 0.55 + Math.sin(z * 0.04) * 0.3);
  }

  const md = Math.hypot(x - 108, z + 122);
  if (md < 42) {
    h += (1 - md / 42) ** 2 * 46;
  }

  const sd = Math.hypot(x, z - 18);
  if (sd < 24) {
    h = lerp(h, 7.15, (1 - sd / 24) ** 0.7);
  }

  const river = riverDepth(x, z);
  h -= river * 3.4;

  const cave = Math.hypot(x + 38, z - 8);
  if (cave < 7) h -= (1 - cave / 7) * 8.5;

  const grove = Math.hypot(x - 28, z - 118);
  if (grove < 10) h += (1 - grove / 10) * 2.2;

  const hollow = Math.hypot(x - 16, z - 74);
  if (hollow < 9) h -= (1 - hollow / 9) * 5.5;

  return h;
}

export function riverDepth(x: number, z: number) {
  // Storm highlands down into the western tide.
  const t = clamp((-z + 40) / 160, 0, 1);
  const cx = lerp(18, -92, t);
  const cz = lerp(-88, 12, t);
  const d = Math.hypot(x - cx, z - cz);
  const width = 7 + t * 5;
  return clamp(1 - d / width, 0, 1) ** 1.4;
}

export function biomeAt(x: number, z: number): Biome {
  const md = Math.hypot(x - 108, z + 122);
  if (md < 36) return "crag";
  const sd = Math.hypot(x, z - 18);
  if (sd < 22) return "hearthmere";
  const hd = Math.hypot(x - 16, z - 74);
  if (hd < 11) return "hollow";
  if (x < -58) return "tide";
  if (z > 58) return "mycelia";
  if (z < -48 && x < 70) return "storm";
  if (x > 52) return "ember";
  return "vale";
}

export const BIOME_FOG: Record<Biome, string> = {
  vale: "#1c1730",
  hearthmere: "#241c28",
  ember: "#2a120c",
  storm: "#121824",
  mycelia: "#160c22",
  tide: "#0c1c24",
  crag: "#141018",
  hollow: "#0a0612",
};

export const BIOME_NAME: Record<Biome, string> = {
  vale: "The Shattered Vale",
  hearthmere: "Hearthmere",
  ember: "Emberwaste",
  storm: "Stormspine",
  mycelia: "Mycelial Dark",
  tide: "Tideglass Shore",
  crag: "Skybreaker Crag",
  hollow: "A Hollow Tear",
};

export function biomeColor(x: number, z: number): [number, number, number] {
  const b = biomeAt(x, z);
  const n = fbm(x * 0.08, z * 0.08);
  const h = heightAt(x, z);
  switch (b) {
    case "ember":
      return [0.18 + n * 0.08, 0.05 + n * 0.03, 0.04];
    case "storm":
      return [0.22, 0.26 + n * 0.05, 0.3];
    case "mycelia":
      return [0.12 + n * 0.05, 0.08, 0.18 + n * 0.08];
    case "tide":
      return [0.28, 0.32 + n * 0.08, 0.26];
    case "crag":
      return [0.32, 0.28, 0.3];
    case "hollow":
      return [0.06, 0.04, 0.09];
    case "hearthmere":
      return [0.22, 0.28, 0.14];
    default:
      return h > 14
        ? [0.35, 0.34, 0.3]
        : [0.18 + n * 0.05, 0.28 + n * 0.06, 0.14];
  }
}

export function slopeAt(x: number, z: number) {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

export const WATERFALL = { x: -38, z: 8 };

export const SETTLEMENT = {
  hearths: [{ x: 2.5, z: 16.5 }],
  camps: [{ x: -3.2, z: 21.4 }],
  npcs: [
    {
      id: "sera",
      name: "Sera of the Nest",
      x: 6.4,
      z: 12.2,
      lines: [
        "The stormkites write letters in the air. I have never caught one.",
        "If a bird trusts the wind enough to stop beating its wings, the wind is a teacher.",
        "Something huge sleeps on the northeast tooth. It was flying before we had a word for sky.",
      ],
    },
    {
      id: "bram",
      name: "Bram Cinderpocket",
      x: -6.1,
      z: 14.8,
      lines: [
        "Emberwaste lizards cough sparks when they are angry. Do not stand in the cough.",
        "Heat and wind are cousins. I have seen grass learn to fly.",
        "If you take fire from the land, put a little back or the land will take from you.",
      ],
    },
    {
      id: "yll",
      name: "Yll of the Cap",
      x: 1.2,
      z: 26.5,
      lines: [
        "The south is not a forest. It is a single thought with many hats.",
        "Walk softly. The mycelium already knows your name; it is waiting to see if you deserve the rest.",
        "Some paths only exist if you already learned how to see them.",
      ],
    },
    {
      id: "mir",
      name: "Mir Tideglass",
      x: -11.4,
      z: 19.6,
      lines: [
        "West, the shore remembers being a lung. It still tries to breathe.",
        "Glass moths come when the light is unsure of itself. Dusk. Dawn. Doorways.",
        "Water hates to be hurried. Unless lightning asks politely.",
      ],
    },
  ],
};

export const PICKUPS: {
  id: string;
  item: string;
  x: number;
  z: number;
  rare?: boolean;
}[] = [
  { id: "p1", item: "splinterwood", x: 10, z: 8 },
  { id: "p2", item: "splinterwood", x: -14, z: 28 },
  { id: "p3", item: "splinterwood", x: 22, z: 32 },
  { id: "p4", item: "shardstone", x: -8, z: -22 },
  { id: "p5", item: "shardstone", x: 16, z: -36 },
  { id: "p6", item: "shardstone", x: 4, z: -70 },
  { id: "p7", item: "embercoal", x: 82, z: 6 },
  { id: "p8", item: "embercoal", x: 94, z: -18 },
  { id: "p9", item: "stormglass", x: 12, z: -92 },
  { id: "p10", item: "stormglass", x: -6, z: -78 },
  { id: "p11", item: "sporegel", x: 18, z: 96 },
  { id: "p12", item: "sporegel", x: -16, z: 108 },
  { id: "p13", item: "tidepearl", x: -96, z: 4 },
  { id: "p14", item: "tidepearl", x: -108, z: -20 },
  { id: "p15", item: "kiteplume", x: 20, z: -68, rare: true },
  { id: "p16", item: "nightiron", x: -38, z: 8, rare: true },
  { id: "p17", item: "weftseed", x: 28, z: 118, rare: true },
  { id: "p18", item: "hollowash", x: 16, z: 74, rare: true },
  { id: "p19", item: "basaltheart", x: 8, z: -108, rare: true },
  { id: "p20", item: "quickglass", x: -88, z: -8, rare: true },
  { id: "p21", item: "fallen_plume", x: 3.5, z: 4.2, rare: true },
  { id: "p22", item: "splinterwood", x: 32, z: 14 },
  { id: "p23", item: "shardstone", x: 48, z: -52 },
];

export const HIDDEN_CACHES = [
  { id: "cave", x: -38, z: 8, need: null as string | null, hint: "behind the falling river" },
  { id: "grove", x: 28, z: 118, need: "spore_sight", hint: "a thought under hats" },
  { id: "cellar", x: -1.4, z: 17.2, need: null, hint: "hearthmere keeps a second mouth" },
  { id: "skyshard", x: 42, z: -44, need: "gale_feather", hint: "a piece of mountain that forgot gravity" },
  { id: "hollow", x: 16, z: 74, need: "hollow_debt", hint: "where you took too much" },
];
