/**
 * REALMS — the engine shell.
 *
 * Owns the renderer, the scene graph, the frame loop and the fixed-timestep
 * simulation clock. Gameplay systems register themselves as updaters; the world
 * is built in stages so the first frame can be shown while the rest streams in.
 */

import * as THREE from 'three';
import { PostFX, type Quality } from '../core/postfx';
import { atmo } from '../core/atmosphere';
import { Input } from '../core/input';

export interface FrameCtx {
  dt: number;
  elapsed: number;
  camera: THREE.PerspectiveCamera;
}

export type Updater = (ctx: FrameCtx) => void;

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  post: PostFX;
  input: Input;
  clock = new THREE.Clock();
  elapsed = 0;

  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;

  private updaters: Updater[] = [];
  private raf = 0;
  private running = false;
  private container: HTMLElement;
  private resizeObs: ResizeObserver | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;

  /** Rolling FPS estimate used by the adaptive quality governor. */
  fps = 60;
  private frameTimes: number[] = [];
  private adaptive = true;
  quality: Quality = 'high';
  private renderScale = 1;

  constructor(container: HTMLElement) {
    this.container = container;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
    container.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;   // done in the grade pass, in HDR
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // Accumulate render stats across every post pass so the debug read-out is
    // the real per-frame cost rather than whatever the last pass did.
    this.renderer.info.autoReset = false;

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.6, 22000);
    this.camera.position.set(0, 200, 0);

    // ---- lights ----
    this.sun = new THREE.DirectionalLight(0xffe9c8, 2.85);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 720;
    this.sun.shadow.bias = -0.0007;
    this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110;
    sc.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xa6c6ea, 0x8b7c5f, 2.95);
    this.scene.add(this.hemi);

    // A cool bounce from the opposite side of the sun. Without it, slopes that
    // face away from the sun read as flat black holes in the silhouette.
    this.fill = new THREE.DirectionalLight(0xa8c6f0, 0.95);
    this.fill.position.set(-0.5, 0.4, 0.7);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.post.setQuality(this.quality);
    this.input = new Input(canvas);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();

    this.handleResize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.handleResize());
      this.resizeObs.observe(container);
    }
    window.addEventListener('resize', this.handleResize);
  }

  get canvas() { return this.renderer.domElement; }

  private handleResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, pr);
  };

  /** Bake an environment map from the sky so metal and water read correctly. */
  bakeEnvironment(skyMesh: THREE.Mesh) {
    const scene = new THREE.Scene();
    const clone = skyMesh.clone();
    clone.scale.setScalar(1);
    (clone.material as THREE.Material).depthTest = false;
    scene.add(clone);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(scene, 0.04, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 1.15;
    clone.geometry.dispose();
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.post.setQuality(q);
    // Shadows stay ENABLED at every preset — toggling `shadowMap.enabled` after
    // materials have compiled leaves them sampling a disposed map, which reads
    // as "fully shadowed" and turns everything inside the light frustum black.
    // Only the resolution changes.
    this.renderer.shadowMap.enabled = true;
    switch (q) {
      case 'low':
        this.renderScale = 0.7;
        this.sun.shadow.mapSize.set(768, 768);
        break;
      case 'medium':
        this.renderScale = 0.88;
        this.sun.shadow.mapSize.set(1280, 1280);
        break;
      case 'high':
        this.renderScale = 1;
        this.sun.shadow.mapSize.set(2048, 2048);
        break;
      case 'ultra':
        this.renderScale = 1;
        this.sun.shadow.mapSize.set(3072, 3072);
        break;
    }
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.handleResize();
  }

  setAdaptive(v: boolean) { this.adaptive = v; }

  add(updater: Updater) { this.updaters.push(updater); }

  /** Keep the shadow frustum tight around wherever the player is. */
  updateSunShadow(focus: THREE.Vector3) {
    const d = atmo.uSunDir.value;
    this.fill.position.set(focus.x - d.x * 200, focus.y + 140, focus.z - d.z * 200);
    this.fill.target.position.copy(focus);
    this.fill.target.updateMatrixWorld();
    this.sun.position.set(focus.x + d.x * 320, focus.y + d.y * 320, focus.z + d.z * 320);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick() {
    this.renderer.info.reset();
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.elapsed += dt;
    atmo.uTime.value = this.elapsed;

    // FPS estimate + adaptive quality
    this.frameTimes.push(raw);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (this.frameTimes.length === 60) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / 60;
      this.fps = 1 / Math.max(avg, 1e-4);
      if (this.adaptive) this.governQuality();
    }

    const ctx: FrameCtx = { dt, elapsed: this.elapsed, camera: this.camera };
    for (let i = 0; i < this.updaters.length; i++) this.updaters[i](ctx);

    this.post.updateSun(this.camera, atmo.uSunDir.value);
    this.post.render(dt);
  }

  private lastQualityChange = 0;
  private governQuality() {
    if (this.elapsed - this.lastQualityChange < 4) return;
    const order: Quality[] = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(this.quality);
    if (this.fps < 34 && i > 0) {
      this.lastQualityChange = this.elapsed;
      this.setQuality(order[i - 1]);
    } else if (this.fps > 58 && i < 2) {
      this.lastQualityChange = this.elapsed;
      this.setQuality(order[i + 1]);
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.resizeObs?.disconnect();
    this.input.dispose();
    this.post.dispose();
    this.pmrem.dispose();
    this.envRT?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
