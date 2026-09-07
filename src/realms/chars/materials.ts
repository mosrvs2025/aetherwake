/**
 * REALMS — character materials.
 *
 * The palette: dark cold steel, oiled leather, weathered skin, and the
 * aether-blue energy that runs through the Warden's gear and his wolf. The
 * energy material is deliberately over-driven (emissive intensity well above 1)
 * because the pipeline stays HDR until the grade pass — that is what makes it
 * bloom like light rather than glow like a decal.
 */

import * as THREE from 'three';
import { applyAtmosphere, type SurfaceDetail } from '../core/atmosphere';
import { Textures } from '../world/textures';

export const AETHER = new THREE.Color('#4ea8ff');
export const AETHER_HOT = new THREE.Color('#a9dcff');
export const EMBER = new THREE.Color('#ff8a3c');
export const WRAITH = new THREE.Color('#c060ff');

/**
 * A stylised rim light. Characters spend most of their time backlit against a
 * bright sky, and a physically correct result there is a black silhouette. A
 * fresnel rim tinted between sky and sun colour keeps them readable from any
 * angle without lying about the lighting direction — it reads as scattered
 * light catching the edge of the armour.
 */
const RIM_FRAG = /* glsl */ `
{
  vec3 rimView = normalize(cameraPosition - vWorldPos_atmo);
  vec3 rimN = normalize(vWorldNormal_rim);
  float rim = pow(1.0 - clamp(dot(rimView, rimN), 0.0, 1.0), 5.0);
  float toSun = clamp(dot(-rimView, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 rimCol = mix(uSkyHorizon * 0.85, uSunColor * 1.25, pow(toSun, 2.0));
  gl_FragColor.rgb += rimCol * clamp(rim, 0.0, 1.0) * uRimStrength;
}
`;

/** Patch any standard material into the world atmosphere, with optional rim. */
export function worldMaterial(
  params: THREE.MeshStandardMaterialParameters,
  key: string,
  rim = 0.0,
  surface?: SurfaceDetail,
) {
  const m = new THREE.MeshStandardMaterial(params);
  applyAtmosphere(m, {
    key: key + (rim > 0 ? '-rim' : ''),
    uniforms: { uRimStrength: { value: rim } },
    vertexPars: 'varying vec3 vWorldNormal_rim;',
    vertexBody: 'vWorldNormal_rim = normalize(mat3(modelMatrix) * objectNormal);',
    fragmentPars: 'uniform float uRimStrength;\nvarying vec3 vWorldNormal_rim;',
    fragmentBody: rim > 0 ? RIM_FRAG : '',
    surface,
  });
  return m;
}

/**
 * The micro-detail each substance wears. Scale is in world units, so a value
 * of 1.4 means the grain repeats every ~70cm — chosen per material so plate
 * looks hammered at arm's length and masonry looks quarried from across a
 * courtyard.
 */
export const SURFACES = {
  get stone(): SurfaceDetail {
    return { map: Textures.surfStone, scale: 0.55, normal: 0.55, rough: 0.30, cavity: 0.26 };
  },
  get rock(): SurfaceDetail {
    return { map: Textures.surfStone, scale: 0.30, normal: 0.70, rough: 0.26, cavity: 0.30 };
  },
  get wood(): SurfaceDetail {
    return { map: Textures.surfWood, scale: 1.30, normal: 0.48, rough: 0.28, cavity: 0.24 };
  },
  get cloth(): SurfaceDetail {
    return { map: Textures.surfCloth, scale: 3.20, normal: 0.30, rough: 0.22, cavity: 0.16 };
  },
  get metal(): SurfaceDetail {
    return { map: Textures.surfMetal, scale: 2.60, normal: 0.34, rough: 0.34, cavity: 0.12 };
  },
  get leather(): SurfaceDetail {
    return { map: Textures.surfStone, scale: 3.60, normal: 0.40, rough: 0.26, cavity: 0.20 };
  },
  get skin(): SurfaceDetail {
    return { map: Textures.surfCloth, scale: 6.00, normal: 0.14, rough: 0.16, cavity: 0.10 };
  },
} as const;

const std = worldMaterial;

export interface CharacterMaterials {
  skin: THREE.MeshStandardMaterial;
  /** The dark under-layer worn beneath the plate. */
  suit: THREE.MeshStandardMaterial;
  armor: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  energy: THREE.MeshStandardMaterial;
  all: THREE.MeshStandardMaterial[];
}

export function makeCharacterMaterials(opts: {
  skin?: THREE.ColorRepresentation;
  suit?: THREE.ColorRepresentation;
  armor?: THREE.ColorRepresentation;
  cloth?: THREE.ColorRepresentation;
  leather?: THREE.ColorRepresentation;
  energy?: THREE.Color;
  energyPower?: number;
  metalness?: number;
  roughness?: number;
  key?: string;
} = {}): CharacterMaterials {
  const key = opts.key ?? 'char';
  const skin = std({
    // Weathered and cool rather than tanned: a warm sun on a saturated skin
    // tone is what makes a bare head read as orange plastic.
    color: opts.skin ?? '#84695a',
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.55,
  }, key + '-skin', 0.10, SURFACES.skin);
  const suit = std({
    color: opts.suit ?? '#2a2f3a',
    roughness: 0.90,
    metalness: 0.04,
  }, key + '-suit', 0.15, SURFACES.cloth);
  // Blackened iron, not chrome. High metalness with a low roughness and a
  // strong environment made the plate mirror the sky, which on a blue-grey
  // base is what turned the pauldrons into glossy plastic. Dark fantasy plate
  // reads as *forged*: nearly black, matte across the faces, with the sheen
  // living on the edges where a hammer would have polished it.
  const armor = std({
    color: opts.armor ?? '#3c424c',
    roughness: opts.roughness ?? 0.58,
    metalness: opts.metalness ?? 0.72,
    envMapIntensity: 0.65,
  }, key + '-armor', 0.30, SURFACES.metal);
  const cloth = std({
    color: opts.cloth ?? '#1c2130',
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }, key + '-cloth', 0.18, SURFACES.cloth);
  const leather = std({
    color: opts.leather ?? '#3a2c22',
    roughness: 0.72,
    metalness: 0.05,
  }, key + '-leather', 0.12, SURFACES.leather);
  const energy = std({
    color: '#04070c',
    emissive: (opts.energy ?? AETHER).clone(),
    emissiveIntensity: opts.energyPower ?? 2.3,
    roughness: 0.3,
    metalness: 0.2,
    toneMapped: true,
  }, key + '-energy');
  return { skin, suit, armor, cloth, leather, energy, all: [skin, suit, armor, cloth, leather, energy] };
}

/** Emissive rune-band material used on banners, gates and the boss. */
export function makeRuneMaterial(color: THREE.Color, power = 3.2) {
  const m = new THREE.MeshStandardMaterial({
    color: '#05070b',
    emissive: color.clone(),
    emissiveIntensity: power,
    emissiveMap: Textures.rune,
    alphaMap: Textures.rune,
    transparent: true,
    roughness: 0.5,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  applyAtmosphere(m, { key: 'rune' });
  return m;
}
