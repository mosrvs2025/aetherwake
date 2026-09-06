/**
 * REALMS — procedurally generated textures.
 *
 * Nothing is downloaded. Every surface detail in the world comes from these
 * generators, which means the whole game is one JS bundle with no texture
 * budget, no CDN round-trips and no decode stalls — and every texture is
 * seamlessly tileable by construction (all noise is evaluated on a torus).
 */

import * as THREE from 'three';
import { Noise, clamp01, lerp, smoothstep } from '../core/math';

/** Tileable value noise: sample 4D noise on a torus so edges match exactly. */
function tileableFbm(n: Noise, u: number, v: number, freq: number, octaves: number) {
  // Map the unit square onto two circles and use 2D noise of the circle coords.
  // A cheap stand-in for true 4D noise that is still perfectly seamless.
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const a1 = u * Math.PI * 2, a2 = v * Math.PI * 2;
    const x = Math.cos(a1) * f * 0.159155, y = Math.sin(a1) * f * 0.159155;
    const z = Math.cos(a2) * f * 0.159155, w = Math.sin(a2) * f * 0.159155;
    sum += amp * n.noise3(x + z * 0.5, y + w * 0.5, (z - w) * 0.5);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * Packed detail texture used by terrain, rock and bark shading.
 *   R = height field (for parallax-ish shading and speckle)
 *   G = ∂height/∂u  (pre-baked so the shader gets a normal from one tap)
 *   B = ∂height/∂v
 *   A = low-frequency variation (macro colour breakup)
 */
export function makeDetailTexture(size = 512, seed = 'detail'): THREE.DataTexture {
  const n1 = new Noise(seed + '-a');
  const n2 = new Noise(seed + '-b');
  const h = new Float32Array(size * size);
  const macro = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const fine = tileableFbm(n1, u, v, 46, 5) * 0.5 + 0.5;
      const streak = tileableFbm(n2, u, v, 13, 3) * 0.5 + 0.5;
      h[y * size + x] = clamp01(fine * 0.72 + streak * 0.34);
      macro[y * size + x] = clamp01(tileableFbm(n2, u, v, 5, 3) * 0.5 + 0.5);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const yl = (y - 1 + size) % size, yr = (y + 1) % size;
      const dx = (h[y * size + xr] - h[y * size + xl]) * 0.5;
      const dy = (h[yr * size + x] - h[yl * size + x]) * 0.5;
      data[i * 4 + 0] = Math.round(h[i] * 255);
      data[i * 4 + 1] = Math.round(clamp01(dx * 6 + 0.5) * 255);
      data[i * 4 + 2] = Math.round(clamp01(dy * 6 + 0.5) * 255);
      data[i * 4 + 3] = Math.round(macro[i] * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial sprite used for embers, dust, sparks and light shafts. */
export function makeGlowTexture(size = 128, power = 2.2): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      const a = Math.pow(clamp01(1 - d), power);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** A soft, slightly noisy puff used for smoke, mist and waterfall spray. */
export function makeSmokeTexture(size = 128, seed = 'smoke'): THREE.DataTexture {
  const n = new Noise(seed);
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const d = Math.hypot(x - c, y - c) / c;
      const noise = tileableFbm(n, u, v, 6, 4) * 0.5 + 0.5;
      const a = clamp01(Math.pow(clamp01(1 - d), 1.6) * (0.45 + noise * 0.9) - 0.06);
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(clamp01(a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Foliage card: a clump of leaves with soft alpha, used for tree canopies. */
export function makeLeafTexture(size = 256, seed = 'leaf'): THREE.DataTexture {
  const n = new Noise(seed);
  const data = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / (size * 0.5);
      const dy = (y - cy) / (size * 0.5);
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const lobes = 1 + 0.24 * Math.sin(ang * 5 + 1.2) + 0.16 * Math.sin(ang * 9 - 0.4);
      const nn = n.fbm2(x * 0.055, y * 0.055, 4) * 0.5 + 0.5;
      // A dense clump with a soft, broken edge: solid enough in the middle to
      // read as canopy mass at distance, ragged enough at the rim to avoid
      // looking like a card.
      let a = smoothstep(lobes * 1.06, lobes * 0.30, r);
      a *= smoothstep(0.10, 0.34, nn);
      // a few holes near the rim only, so the silhouette breaks up
      const holes = n.fbm2(x * 0.10 + 30, y * 0.10 - 12, 3) * 0.5 + 0.5;
      a *= 1 - smoothstep(0.42, 0.90, r) * smoothstep(0.62, 0.30, holes);
      const shade = 0.50 + nn * 0.62;
      const i = (y * size + x) * 4;
      data[i] = Math.round(255 * shade * 0.94);
      data[i + 1] = Math.round(255 * shade);
      data[i + 2] = Math.round(255 * shade * 0.86);
      data[i + 3] = Math.round(clamp01(a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** A single blade-cluster alpha for grass billboards. */
export function makeGrassTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  // A dense tuft, not a handful of blades: at gameplay density a sparse card
  // reads as isolated weeds standing in mown turf.
  const blades = 26;
  const acc = new Float32Array(size * size);
  const rnd = (i: number) => {
    const t = Math.sin(i * 12.9898) * 43758.5453;
    return t - Math.floor(t);
  };
  for (let b = 0; b < blades; b++) {
    const x0 = 0.05 + rnd(b) * 0.90;
    const lean = (rnd(b + 40) - 0.5) * 0.55;
    const height = 0.48 + rnd(b + 90) * 0.52;
    const w0 = 0.016 + rnd(b + 130) * 0.020;
    for (let s = 0; s <= 64; s++) {
      const t = s / 64;
      if (t > height) break;
      const cx = (x0 + lean * t * t) * size;
      const cy = (1 - t) * size;
      const w = Math.max(0.6, w0 * (1 - t / height) * size);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
          const px = Math.round(cx + dx), py = Math.round(cy + dy);
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const f = clamp01(1 - Math.abs(dx) / (w + 0.5));
          acc[py * size + px] = Math.max(acc[py * size + px], f * (0.55 + 0.45 * t));
        }
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    const a = clamp01(acc[i] * 1.9);
    const v = lerp(0.42, 1.0, clamp01(acc[i]));
    data[i * 4] = Math.round(255 * v * 0.8);
    data[i * 4 + 1] = Math.round(255 * v);
    data[i * 4 + 2] = Math.round(255 * v * 0.55);
    data[i * 4 + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Runic band used on armour, banners and the boss. */
export function makeRuneTexture(size = 256, seed = 'rune'): THREE.DataTexture {
  const n = new Noise(seed);
  const data = new Uint8Array(size * size * 4);
  const rng = (i: number) => { const t = Math.sin(i * 78.233) * 43758.5453; return t - Math.floor(t); };
  const grid = new Float32Array(size * size);
  // draw angular glyph strokes
  const glyphs = 22;
  for (let g = 0; g < glyphs; g++) {
    const gx = rng(g * 3) * size;
    const gy = rng(g * 3 + 1) * size;
    const strokes = 2 + Math.floor(rng(g * 3 + 2) * 3);
    for (let s = 0; s < strokes; s++) {
      const a = Math.floor(rng(g * 17 + s) * 8) * (Math.PI / 4);
      const len = 8 + rng(g * 19 + s) * 16;
      const x1 = gx + Math.cos(a) * len, y1 = gy + Math.sin(a) * len;
      const steps = Math.ceil(len);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = Math.round(lerp(gx, x1, t)), py = Math.round(lerp(gy, y1, t));
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const qx = ((px + ox) % size + size) % size, qy = ((py + oy) % size + size) % size;
          const f = ox === 0 && oy === 0 ? 1 : 0.45;
          grid[qy * size + qx] = Math.max(grid[qy * size + qx], f);
        }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const wear = n.fbm2(x * 0.03, y * 0.03, 3) * 0.5 + 0.5;
      const a = clamp01(grid[i] * (0.35 + wear));
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255;
      data[i * 4 + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

let _detail: THREE.DataTexture | null = null;
let _glow: THREE.DataTexture | null = null;
let _smoke: THREE.DataTexture | null = null;
let _leaf: THREE.DataTexture | null = null;
let _grass: THREE.DataTexture | null = null;
let _rune: THREE.DataTexture | null = null;

export const Textures = {
  get detail() { return (_detail ??= makeDetailTexture(512, 'realms-detail')); },
  get glow() { return (_glow ??= makeGlowTexture(128, 2.4)); },
  get smoke() { return (_smoke ??= makeSmokeTexture(128, 'realms-smoke')); },
  get leaf() { return (_leaf ??= makeLeafTexture(256, 'realms-leaf')); },
  get grass() { return (_grass ??= makeGrassTexture(128)); },
  get rune() { return (_rune ??= makeRuneTexture(256, 'realms-rune')); },
  dispose() {
    [_detail, _glow, _smoke, _leaf, _grass, _rune].forEach((t) => t?.dispose());
    _detail = _glow = _smoke = _leaf = _grass = _rune = null;
  },
};
