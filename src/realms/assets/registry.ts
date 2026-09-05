/**
 * REALMS — the asset pipeline.
 *
 * The game ships with zero binary assets: every model, texture and sound is
 * generated in code. That is a deliberate default, not a limitation — this
 * registry is the seam where authored content takes over.
 *
 * Drop a manifest at `public/models/manifest.json` and the game will prefer
 * your art wherever an id matches, falling back to the procedural version for
 * anything you have not replaced yet. Nothing else has to change: a GLB
 * character adopted through `Rig.fromSkinnedMesh` inherits the entire
 * procedural animation set, the combat timings, the foot IK and the weapon
 * sockets, because those are driven by canonical bone names rather than by
 * imported clips.
 *
 * See `public/models/README.md` for the manifest schema and the bone contract.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { applyAtmosphere } from '../core/atmosphere';

export interface ModelEntry {
  /** URL relative to the site root, e.g. "/models/warden.glb". */
  url: string;
  /** Uniform scale applied on import. */
  scale?: number;
  /** Y rotation applied on import, in degrees. Use it if your model faces +Z. */
  yaw?: number;
  /** Vertical offset applied on import. */
  offsetY?: number;
  /** Map REALMS canonical bone names -> the bone names in your rig. */
  boneMap?: Record<string, string>;
  /** Prefer clips baked in the GLB over the procedural ones, by state name. */
  clips?: Record<string, string>;
  /** Cast/receive shadows (default true). */
  shadows?: boolean;
}

export interface PropEntry extends ModelEntry {
  /** Where to place it, in world units. Omit for prefabs placed by code. */
  at?: [number, number, number];
}

export interface AssetManifest {
  /** Characters and creatures, keyed by REALMS id: player, wolf, husk, ... */
  characters?: Record<string, ModelEntry>;
  /** Static props and environment pieces, keyed by id. */
  props?: Record<string, PropEntry>;
  /** Optional decoder locations if your GLBs are Draco/KTX2 compressed. */
  dracoPath?: string;
  ktx2Path?: string;
}

interface LoadedModel {
  entry: ModelEntry;
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  skinned: THREE.SkinnedMesh | null;
}

class Registry {
  manifest: AssetManifest | null = null;
  private models = new Map<string, LoadedModel>();
  private loader: GLTFLoader | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  loaded = false;
  /** Ids that failed to load, so we only warn once. */
  private failed = new Set<string>();

  attachRenderer(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  private makeLoader() {
    if (this.loader) return this.loader;
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(this.manifest?.dracoPath ?? 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco);
    if (this.renderer) {
      const ktx2 = new KTX2Loader();
      ktx2.setTranscoderPath(this.manifest?.ktx2Path ?? 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/');
      ktx2.detectSupport(this.renderer);
      loader.setKTX2Loader(ktx2);
    }
    this.loader = loader;
    return loader;
  }

  /**
   * Fetch the manifest and every model it lists. Safe to call unconditionally:
   * a missing manifest simply means "stay procedural".
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const res = await fetch('/models/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const text = await res.text();
      if (!text.trim().startsWith('{')) return;
      this.manifest = JSON.parse(text) as AssetManifest;
    } catch {
      return;   // no manifest, or it is not valid JSON — procedural it is
    }
    const entries: Array<[string, ModelEntry]> = [
      ...Object.entries(this.manifest.characters ?? {}),
      ...Object.entries(this.manifest.props ?? {}),
    ];
    await Promise.all(entries.map(([id, entry]) => this.loadOne(id, entry)));
  }

  private async loadOne(id: string, entry: ModelEntry) {
    try {
      const gltf: GLTF = await this.makeLoader().loadAsync(entry.url);
      const scene = gltf.scene;
      scene.scale.setScalar(entry.scale ?? 1);
      if (entry.yaw) scene.rotation.y = THREE.MathUtils.degToRad(entry.yaw);
      if (entry.offsetY) scene.position.y = entry.offsetY;
      let skinned: THREE.SkinnedMesh | null = null;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
        if (m.isMesh) {
          m.castShadow = entry.shadows !== false;
          m.receiveShadow = entry.shadows !== false;
          m.frustumCulled = !(o as THREE.SkinnedMesh).isSkinnedMesh;
          // imported materials still have to breathe the same air as the world
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) applyAtmosphere(mat, { key: 'imported-' + id });
        }
      });
      this.models.set(id, { entry, scene, clips: gltf.animations ?? [], skinned });
    } catch (err) {
      if (!this.failed.has(id)) {
        this.failed.add(id);
        console.warn(`[realms] asset "${id}" failed to load from ${entry.url}; using the procedural version.`, err);
      }
    }
  }

  has(id: string) { return this.models.has(id); }

  /** A fresh instance of an imported model, safe to add to the scene. */
  instance(id: string): { root: THREE.Group; skinned: THREE.SkinnedMesh | null; clips: THREE.AnimationClip[]; entry: ModelEntry } | null {
    const m = this.models.get(id);
    if (!m) return null;
    const root = m.scene.clone(true);
    let skinned: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
    });
    return { root, skinned, clips: m.clips, entry: m.entry };
  }

  /** The bone-name mapping for an imported character, if one was supplied. */
  boneMap(id: string) { return this.models.get(id)?.entry.boneMap ?? null; }

  dispose() {
    for (const m of this.models.values()) {
      m.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
      });
    }
    this.models.clear();
  }
}

export const Assets = new Registry();

/** Canonical bone names REALMS drives. An imported rig maps onto these. */
export const CANONICAL_BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'headTop',
  'clavL', 'upperArmL', 'lowerArmL', 'handL', 'fingersL',
  'clavR', 'upperArmR', 'lowerArmR', 'handR', 'fingersR', 'gripR',
  'upperLegL', 'lowerLegL', 'footL', 'toeL',
  'upperLegR', 'lowerLegR', 'footR', 'toeR',
  'cloak1', 'cloak2', 'cloak3', 'cloak4',
] as const;
