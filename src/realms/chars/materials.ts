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
import { applyAtmosphere } from '../core/atmosphere';
import { Textures } from '../world/textures';

export const AETHER = new THREE.Color('#4ea8ff');
export const AETHER_HOT = new THREE.Color('#a9dcff');
export const EMBER = new THREE.Color('#ff8a3c');
export const WRAITH = new THREE.Color('#c060ff');

function std(params: THREE.MeshStandardMaterialParameters, key: string) {
  const m = new THREE.MeshStandardMaterial(params);
  applyAtmosphere(m, { key });
  return m;
}

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
    color: opts.skin ?? '#a97d5d',
    roughness: 0.74,
    metalness: 0.0,
  }, key + '-skin');
  const suit = std({
    color: opts.suit ?? '#3a4150',
    roughness: 0.88,
    metalness: 0.04,
  }, key + '-suit');
  const armor = std({
    color: opts.armor ?? '#5a6474',
    roughness: opts.roughness ?? 0.42,
    metalness: opts.metalness ?? 0.38,
    envMapIntensity: 1.5,
  }, key + '-armor');
  const cloth = std({
    color: opts.cloth ?? '#232a3c',
    roughness: 0.93,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }, key + '-cloth');
  const leather = std({
    color: opts.leather ?? '#3a2c22',
    roughness: 0.72,
    metalness: 0.05,
  }, key + '-leather');
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
