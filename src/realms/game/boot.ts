/**
 * REALMS — entry point.
 *
 * Also hosts the two developer views used while building the game:
 *   ?inspect=warrior|wolf   — a turntable studio for the character models
 *   ?q=low|medium|high      — pin the quality preset (disables the governor)
 */

import * as THREE from 'three';
import { Game } from './game';
import { audio } from '../core/audio';
import { realms } from './state';

export interface GameHandle {
  begin: () => Promise<void>;
  dispose: () => void;
  press: (name: string, down: boolean) => void;
  resume: () => void;
}

async function inspect(container: HTMLElement, which: string): Promise<GameHandle> {
  const [{ Engine }, { Sky }, { atmo }, { Wolf }, { Physics }, { Player }] = await Promise.all([
    import('./engine'), import('../world/sky'), import('../core/atmosphere'),
    import('../chars/wolf'), import('./physics'), import('./player'),
  ]);
  const engine = new Engine(container);
  const q = new URLSearchParams(location.search);
  engine.scene.background = new THREE.Color('#20242c');
  const el = THREE.MathUtils.degToRad(38);
  const az = THREE.MathUtils.degToRad(140);
  atmo.uSunDir.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
  atmo.uFogDensity.value = 0;

  const sky = new Sky();
  sky.mesh.scale.setScalar(400);
  engine.scene.add(sky.mesh);
  engine.bakeEnvironment(sky.mesh);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#3a4148', roughness: 0.95 }),
  );
  ground.receiveShadow = true;
  engine.scene.add(ground);
  if (q.has('flat')) {
    engine.scene.overrideMaterial = new THREE.MeshStandardMaterial({ color: '#a8b0ba', roughness: 0.85, metalness: 0 });
  }
  const grid = new THREE.GridHelper(12, 12, 0x7788aa, 0x445566);
  grid.position.y = 0.002;
  engine.scene.add(grid);

  let update: (dt: number) => void = () => {};
  if (which === 'tree') {
    const { buildVegetation } = await import('../world/vegetation');
    const veg = buildVegetation({ roadAt: () => 0, aoAt: () => 1, blocked: () => 0 });
    // re-place a handful of prototypes in a neat row at the origin
    veg.group.position.set(0, 0, 0);
    const picked: THREE.Object3D[] = [];
    veg.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) picked.push(o); });
    const shown = new THREE.Group();
    const m = new THREE.Matrix4();
    let col = 0;
    for (const o of picked) {
      const im = o as THREE.InstancedMesh;
      if (im.count === 0) continue;
      const one = new THREE.InstancedMesh(im.geometry, im.material, 1);
      im.getMatrixAt(0, m);
      const p2 = new THREE.Vector3(); const q2 = new THREE.Quaternion(); const s2 = new THREE.Vector3();
      m.decompose(p2, q2, s2);
      m.compose(new THREE.Vector3((col - 4) * 9, 0, 0), q2, s2);
      one.setMatrixAt(0, m);
      one.instanceMatrix.needsUpdate = true;
      one.castShadow = true;
      one.frustumCulled = false;
      shown.add(one);
      col++;
    }
    engine.scene.add(shown);
    update = () => {};
  } else if (which === 'husk' || which === 'stalker' || which === 'warden') {
    const { buildEnemy } = await import('../chars/enemies');
    const built = buildEnemy(which)!;
    engine.scene.add(built.character.group);
    built.character.anim.setState(q.get('clip') ?? 'idle');
    update = (dt) => {
      const sp = q.get('clip') === 'walk' ? 2.5 : q.get('clip') === 'run' ? 5 : 0;
      built.character.advanceGait(dt, sp);
      built.character.update(dt, { speed01: 0.4 });
    };
  } else if (which === 'wolf') {
    const wolf = new Wolf();
    engine.scene.add(wolf.group);
    wolf.anim.setState(q.get('clip') ?? 'trot');
    update = (dt) => { wolf.advanceGait(dt, 4.2); wolf.update(dt); };
  } else {
    const physics = new Physics();
    physics.build();
    const player = new Player(physics);
    player.char.setGroundSampler(() => 0);
    engine.scene.add(player.group);
    const clip = q.get('clip') ?? '';
    if (clip) player.char.anim.setState(clip);
    update = (dt) => {
      const s = clip === 'walk' ? 3 : clip === 'run' ? 5 : clip === 'sprint' ? 8.4 : 0;
      player.char.advanceGait(dt, s);
      player.char.update(dt, { speed01: 0.5 });
    };
  }

  const r = parseFloat(q.get('r') ?? '3.1');
  const h = parseFloat(q.get('h') ?? '1.05');
  const ang = parseFloat(q.get('ang') ?? '0.55');
  engine.camera.fov = 40;
  engine.camera.updateProjectionMatrix();
  engine.add(({ dt, elapsed, camera }) => {
    update(dt);
    const spin = q.has('spin') ? elapsed * 0.5 : ang;
    camera.position.set(Math.sin(spin) * r, h + 0.28, Math.cos(spin) * r);
    camera.lookAt(0, h, 0);
    sky.mesh.position.copy(camera.position);
    engine.updateSunShadow(new THREE.Vector3(0, 1, 0));
  });
  engine.start();
  realms.set({ phase: 'playing' });
  return {
    begin: async () => {},
    dispose: () => engine.dispose(),
    press: () => {},
    resume: () => {},
  };
}

export async function boot(container: HTMLElement): Promise<GameHandle> {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const which = params.get('inspect');
  if (which) return inspect(container, which);

  const game = new Game(container);
  const q = params.get('q');
  if (q) {
    game.engine.setAdaptive(false);
    game.engine.setQuality(q as 'low' | 'medium' | 'high' | 'ultra');
  }
  if (params.has('debug')) realms.set({ showDebug: true });
  if (params.has('noshadow')) { game.engine.sun.castShadow = false; game.engine.renderer.shadowMap.enabled = false; }
  if (params.has('at')) {
    const [x, z] = (params.get('at') ?? '0,0').split(',').map(Number);
    const yaw = parseFloat(params.get('yaw') ?? '3.2');
    const wait = () => {
      if (realms.state.phase === 'loading' || realms.state.phase === 'boot') { window.setTimeout(wait, 120); return; }
      game.teleport(x, z, yaw);
    };
    window.setTimeout(wait, 250);
  }
  void game.beginLoad();

  // developer shortcuts: skip the opening, or start it partway through
  if (params.has('skipintro') || params.has('intro')) {
    const at = params.has('skipintro') ? 13.7 : parseFloat(params.get('intro') ?? '0');
    const waitForTitle = () => {
      if (realms.state.phase !== 'title') { window.setTimeout(waitForTitle, 120); return; }
      void game.begin().then(() => game.seekIntro(at));
    };
    window.setTimeout(waitForTitle, 200);
  }

  const onVisibility = () => {
    if (document.hidden) audio.setMuted(true);
    else audio.setMuted(false);
  };
  document.addEventListener('visibilitychange', onVisibility);

  // exposed for the headless smoke test and for poking at a live session
  (window as unknown as Record<string, unknown>).__realmsGame = game;

  const held = new Set<string>();
  return {
    begin: () => game.begin(),
    dispose: () => {
      document.removeEventListener('visibilitychange', onVisibility);
      game.dispose();
    },
    press: (name, down) => {
      if (name === 'sprint') { game.engine.input.setVirtualSprint(down); return; }
      if (down && !held.has(name)) {
        held.add(name);
        game.engine.input.press(name as 'jump');
      }
      if (!down) held.delete(name);
    },
    resume: () => {
      realms.set({ paused: false });
      game.engine.input.requestPointerLock();
    },
  };
}
