"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Sparkles } from "@react-three/drei";
import { runtime } from "@/game/runtime";
import { useGame } from "@/game/store";
import { heightAt, WORLD, slopeAt, biomeAt, SETTLEMENT, HIDDEN_CACHES } from "@/game/data/world";
import { CREATURES } from "@/game/data/creatures";
import { POWERS, type PowerId } from "@/game/data/powers";
import { consumeLook, input } from "@/game/input";
import { sting } from "@/game/audio";

const V = {
  up: new THREE.Vector3(0, 1, 0),
  fwd: new THREE.Vector3(),
  right: new THREE.Vector3(),
  wish: new THREE.Vector3(),
  next: new THREE.Vector3(),
  cam: new THREE.Vector3(),
  look: new THREE.Vector3(),
  tmp: new THREE.Vector3(),
};

function attuned() {
  return useGame.getState().attuned.filter((x): x is PowerId => !!x);
}

function hasP(id: PowerId) {
  return useGame.getState().has(id) || useGame.getState().isAttuned(id);
}

function isA(id: PowerId) {
  return useGame.getState().isAttuned(id);
}

export function Player() {
  const group = useRef<THREE.Group>(null);
  const { camera, gl: renderer } = useThree();
  const cloak = useRef<THREE.MeshStandardMaterial>(null);
  const chest = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((_, dt) => {
    const mode = useGame.getState().mode;
    dt = Math.min(dt, 0.05);
    runtime.dt = dt;
    runtime.time += dt;
    if (mode === "title") {
      const t = runtime.time * 0.12;
      camera.position.set(Math.sin(t) * 38 + 8, 18 + Math.sin(t * 0.6) * 3, 48 + Math.cos(t) * 12);
      camera.lookAt(0, 10, 8);
      return;
    }
    if (mode !== "playing") return;
    if (runtime.uiOpen) {
      consumeLook();
      return;
    }

    const look = consumeLook();
    const touch = runtime.touch;
    runtime.yaw -= (look.x + touch.lookX * 12) * 0.00215;
    runtime.pitch -= (look.y + touch.lookY * 12) * 0.00215;
    runtime.pitch = Math.max(-1.15, Math.min(0.45, runtime.pitch));
    touch.lookX = 0;
    touch.lookY = 0;

    const axis = input.axis();
    let mx = axis.x + touch.moveX;
    let mz = axis.y + touch.moveY;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }

    V.fwd.set(Math.sin(runtime.yaw), 0, Math.cos(runtime.yaw));
    V.right.set(V.fwd.z, 0, -V.fwd.x);
    V.wish.set(0, 0, 0);
    V.wish.addScaledVector(V.fwd, -mz);
    V.wish.addScaledVector(V.right, mx);

    const sprint = (input.pressed("ShiftLeft") || input.pressed("ShiftRight")) && runtime.stamina > 4;
    const aList = attuned();
    const gale = isA("gale_feather") || isA("gale_whisper") || isA("true_soar") || isA("thermal_column");
    const tide = isA("tide_step") || isA("stormwake");
    const root = isA("root_bind") || isA("living_bastion");
    const sky = isA("skybreaker_heart") || isA("true_soar");
    const steam = isA("steam_shroud") && runtime.steam > 0;
    const haste = aList.some((id) => useGame.getState().hasMutation(id, "haste") || useGame.getState().hasMutation(id, "lift"));

    let speed = sprint ? 10.4 : 6.5;
    if (haste) speed *= 1.18;
    if (isA("basalt_hide") || isA("lodestone_crash")) speed *= 0.86;
    if (steam) speed *= 1.08;

    runtime.stamina = Math.min(100, runtime.stamina + dt * (sprint ? -18 : 16));
    if (runtime.invuln > 0) runtime.invuln -= dt;
    runtime.attackCd = Math.max(0, runtime.attackCd - dt);
    runtime.surgeCd = runtime.surgeCd.map((c) => Math.max(0, c - dt)) as [number, number, number] | number[];
    if (runtime.steam > 0) runtime.steam -= dt;
    if (runtime.basalt > 0) runtime.basalt -= dt;
    if (runtime.decoyLife > 0) runtime.decoyLife -= dt;

    if (runtime.onGround) runtime.doubleJump = true;

    const jumpPressed = input.just("Space");
    if (jumpPressed && runtime.onGround) {
      runtime.vel.y = 9.3;
      runtime.onGround = false;
    } else if (jumpPressed && !runtime.onGround && runtime.doubleJump && sky) {
      runtime.vel.y = 8.6;
      runtime.doubleJump = false;
    }

    const space = input.pressed("Space");
    runtime.gliding = false;
    if (!runtime.onGround && space && gale) {
      runtime.gliding = true;
      const thermal = isA("thermal_column") && biomeAt(runtime.player.x, runtime.player.z) === "ember";
      const floor = isA("true_soar") ? 3.4 : thermal ? 1.6 : isA("gale_feather") ? -1.35 : -3.1;
      runtime.vel.y = Math.max(runtime.vel.y, floor);
      runtime.vel.addScaledVector(V.fwd, dt * (isA("true_soar") ? 10 : 6));
      runtime.stamina = Math.max(0, runtime.stamina - dt * 6);
    }

    if (isA("true_soar") && space && runtime.stamina > 8 && !runtime.onGround) {
      runtime.vel.y += dt * 10;
      runtime.stamina -= dt * 14;
    }

    if (!runtime.onGround) runtime.vel.y -= 26 * dt;
    runtime.vel.x *= runtime.onGround ? 0.78 : 0.94;
    runtime.vel.z *= runtime.onGround ? 0.78 : 0.94;
    const accel = runtime.onGround ? 38 : 12;
    runtime.vel.addScaledVector(V.wish, accel * dt * (speed / 6.5));
    const hvel = Math.hypot(runtime.vel.x, runtime.vel.z);
    const max = speed * (runtime.onGround ? 1 : 1.15);
    if (hvel > max) {
      runtime.vel.x *= max / hvel;
      runtime.vel.z *= max / hvel;
    }

    V.next.copy(runtime.player);
    V.next.x += runtime.vel.x * dt;
    V.next.z += runtime.vel.z * dt;

    const half = WORLD.half - 4;
    V.next.x = Math.max(-half, Math.min(half, V.next.x));
    V.next.z = Math.max(-half, Math.min(half, V.next.z));

    const ground = heightAt(V.next.x, V.next.z);
    const slope = slopeAt(V.next.x, V.next.z);
    if (slope > 1.35 && root && mag > 0.2) {
      runtime.vel.y = Math.max(runtime.vel.y, 3.8);
    } else if (slope > 2.4 && !root && runtime.onGround) {
      V.next.x = runtime.player.x;
      V.next.z = runtime.player.z;
    }

    let waterY = WORLD.water;
    const inTide = biomeAt(V.next.x, V.next.z) === "tide" || ground < waterY + 0.4;
    if (inTide && ground < waterY) {
      if (tide) {
        V.next.y = Math.max(ground + 1.05, waterY + 0.95);
        runtime.vel.y = 0;
        runtime.onGround = true;
      } else {
        V.next.y = runtime.player.y + runtime.vel.y * dt;
        if (V.next.y < waterY - 0.2) {
          runtime.vel.y += dt * 18;
          runtime.vel.x *= 0.9;
          runtime.vel.z *= 0.9;
        }
      }
    } else {
      V.next.y = runtime.player.y + runtime.vel.y * dt;
    }

    const stand = ground + 1.05;
    if (V.next.y <= stand) {
      V.next.y = stand;
      if (runtime.vel.y < -12 && (isA("lodestone_crash") || isA("basalt_hide"))) {
        smash(V.next, 18);
      }
      runtime.vel.y = 0;
      runtime.onGround = true;
    } else {
      runtime.onGround = false;
    }

    runtime.player.copy(V.next);

    if (input.consumeAttack() && runtime.attackCd <= 0) {
      swing();
      runtime.attackCd = 0.42;
    }

    if (input.just("KeyQ")) surge(0);
    if (input.just("KeyE")) surge(1);
    if (input.just("KeyR")) surge(2);

    interact(dt);

    // camera
    const dist = 6.6;
    const cy = Math.sin(runtime.pitch);
    const cz = Math.cos(runtime.pitch);
    V.cam.set(
      runtime.player.x + Math.sin(runtime.yaw) * dist * cz,
      runtime.player.y + 1.35 - cy * dist,
      runtime.player.z + Math.cos(runtime.yaw) * dist * cz,
    );
    const camGround = heightAt(V.cam.x, V.cam.z) + 0.6;
    if (V.cam.y < camGround) V.cam.y = camGround;
    runtime.cam.lerp(V.cam, 1 - Math.pow(0.0002, dt));
    V.look.set(runtime.player.x, runtime.player.y + 1.15, runtime.player.z);
    camera.position.copy(runtime.cam);
    camera.lookAt(V.look);

    if (group.current) {
      group.current.position.copy(runtime.player);
      group.current.rotation.y = runtime.yaw + Math.PI;
    }
    if (chest.current) {
      const p = aList[0] ? POWERS[aList[0]] : POWERS.hollow_pulse;
      chest.current.emissive.setRGB(p.rgb[0], p.rgb[1], p.rgb[2]);
    }
    if (cloak.current && gale) {
      cloak.current.emissiveIntensity = 0.35 + Math.sin(runtime.time * 4) * 0.1;
    }

    if (runtime.hp <= 0) {
      runtime.hp = 100;
      runtime.player.set(useGame.getState().lastCamp.x, useGame.getState().lastCamp.y, useGame.getState().lastCamp.z);
      runtime.vel.set(0, 0, 0);
      useGame.getState().whisper("The Vale puts you back where you last belonged.");
    }

    runtime.timeOfDay = (runtime.timeOfDay + dt * 0.0035) % 1;
  });

  useEffect(() => {
    const el = renderer.domElement;
    const onClick = () => {
      if (useGame.getState().mode === "playing" && !runtime.uiOpen) {
        el.requestPointerLock();
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [renderer]);

  return (
    <group ref={group}>
      <mesh position={[0, 0.15, 0]} rotation={[0.15, 0, 0]} castShadow>
        <capsuleGeometry args={[0.32, 0.95, 6, 10]} />
        <meshStandardMaterial color="#1c1917" roughness={0.7} ref={cloak} emissive="#312e81" emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0, 1.28, 0.02]} castShadow>
        <sphereGeometry args={[0.26, 10, 10]} />
        <meshStandardMaterial color="#e7d5c0" />
      </mesh>
      <mesh position={[0, 0.72, 0.18]}>
        <sphereGeometry args={[0.16, 8, 8]} />
        <meshStandardMaterial
          ref={chest}
          color="#111827"
          emissive="#a78bfa"
          emissiveIntensity={1.1}
        />
      </mesh>
      <Sparkles count={12} scale={[1.2, 1.8, 1.2]} size={1.4} color="#c4b5fd" speed={0.6} />
    </group>
  );
}

function swing() {
  const range = 2.15;
  const dmg =
    11 +
    (isA("ember_tongue") ? 5 : 0) +
    (isA("basalt_hide") ? 4 : 0) +
    (isA("lodestone_blood") ? 6 : 0);
  const fwd = V.fwd.set(Math.sin(runtime.yaw), 0, Math.cos(runtime.yaw));
  for (const c of runtime.creatures.values()) {
    if (c.dead) continue;
    const to = V.tmp.copy(c.pos).sub(runtime.player);
    const dist = to.length();
    if (dist > range + c.radius) continue;
    to.y = 0;
    to.normalize();
    if (to.dot(fwd) < 0.25) continue;
    hurtCreature(c, dmg);
    if (isA("ember_tongue")) c.usingPower = c.usingPower;
  }
  sting("hit");
}

function hurtCreature(c: (typeof runtime.creatures extends Map<string, infer T> ? T : never), dmg: number) {
  const def = CREATURES[c.type];
  c.hp -= dmg;
  if (isA("ember_tongue")) {
    c.hp -= 3;
  }
  if (c.hp <= 0 && !c.dead) {
    c.dead = true;
    c.residue = 22;
    runtime.residues.push({
      power: def.power as PowerId,
      pos: c.pos.clone().add(new THREE.Vector3(0, 1.2, 0)),
      life: c.type === "skybreaker" ? 90 : 22,
    });
    useGame.setState({ seed: useGame.getState().seed + 1 });
    useGame.getState().markKilled(c.id);
    useGame.getState().whisper(`${def.name} unspools. The song hangs in the air.`);
  }
}

function smash(at: THREE.Vector3, dmg: number) {
  for (const c of runtime.creatures.values()) {
    if (c.dead) continue;
    if (c.pos.distanceTo(at) < 5.5) hurtCreature(c, dmg);
  }
}

function surge(slot: number) {
  if (runtime.surgeCd[slot] > 0) return;
  const id = useGame.getState().attuned[slot];
  if (!id) {
    useGame.getState().whisper("Nothing is attuned to that limb.");
    return;
  }
  const linger = useGame.getState().hasMutation(id, "linger");
  runtime.surgeCd[slot] = linger ? 3.2 : 5.5;
  const fwd = new THREE.Vector3(Math.sin(runtime.yaw), 0, Math.cos(runtime.yaw));
  const haste = useGame.getState().hasMutation(id, "haste");
  const boost = haste ? 1.25 : 1;

  switch (id) {
    case "gale_feather":
    case "gale_whisper":
      runtime.vel.addScaledVector(fwd, 10 * boost);
      runtime.vel.y += 3.2;
      break;
    case "true_soar":
    case "thermal_column":
    case "skybreaker_heart":
      runtime.vel.y += 9 * boost;
      runtime.vel.addScaledVector(fwd, 6);
      break;
    case "storm_vein":
    case "blink_step":
      runtime.player.addScaledVector(fwd, (id === "blink_step" ? 9 : 7) * boost);
      runtime.invuln = 0.28;
      smash(runtime.player, 10);
      break;
    case "ember_tongue":
    case "cinder_trail":
    case "ashen_lung":
      firebolt(fwd, 16);
      break;
    case "basalt_hide":
    case "lodestone_crash":
      runtime.basalt = 3.5;
      runtime.invuln = 0.4;
      if (!runtime.onGround) runtime.vel.y = -22;
      break;
    case "tide_step":
    case "stormwake":
      smash(runtime.player, 12);
      runtime.vel.addScaledVector(fwd, 5);
      break;
    case "spore_sight":
    case "pollen_veil":
    case "underdream":
      useGame.getState().whisper("The underground writes itself in light.");
      break;
    case "root_bind":
    case "living_bastion":
      runtime.walls.push({ pos: runtime.player.clone().add(fwd.clone().multiplyScalar(2.4)), life: 18 });
      runtime.buildings.push({
        id: `w${Date.now()}`,
        kind: "wall",
        pos: runtime.player.clone().add(fwd.clone().multiplyScalar(2.4)),
        rot: runtime.yaw,
      });
      useGame.setState({ seed: useGame.getState().seed + 1 });
      break;
    case "glass_echo":
      runtime.decoy = runtime.player.clone();
      runtime.decoyLife = 4;
      runtime.player.addScaledVector(fwd, 3.2);
      break;
    case "night_veil":
      useGame.getState().whisper("For a breath the second vale is painted on the first.");
      break;
    case "lodestone_blood":
      for (const c of runtime.creatures.values()) {
        if (c.pos.distanceTo(runtime.player) < 10) {
          c.pos.lerp(runtime.player, 0.35);
          hurtCreature(c, 8);
        }
      }
      break;
    case "world_vein":
      teleportVein();
      break;
    case "steam_shroud":
      runtime.steam = 5.5;
      runtime.invuln = 1.2;
      break;
    case "unstable":
      runtime.vel.y += 6;
      runtime.vel.addScaledVector(fwd, 8);
      smash(runtime.player, 8);
      useGame.getState().whisper("Even you are surprised.");
      break;
    default:
      runtime.vel.addScaledVector(fwd, 4);
  }
  sting("ui");
}

function firebolt(fwd: THREE.Vector3, dmg: number) {
  const end = runtime.player.clone().add(fwd.clone().multiplyScalar(14));
  let best: { dist: number; c: Live } | null = null;
  type Live = (typeof runtime.creatures extends Map<string, infer T> ? T : never);
  for (const c of runtime.creatures.values()) {
    if (c.dead) continue;
    const d = distToSeg(c.pos, runtime.player, end);
    if (d < 1.6 + c.radius && (!best || d < best.dist)) best = { dist: d, c };
  }
  if (best) hurtCreature(best.c, dmg);
}

function distToSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().add(ab.multiplyScalar(t)).distanceTo(p);
}

function teleportVein() {
  const nodes = [
    [12, 88],
    [-20, 102],
    [36, 96],
    [28, 118],
    [0, 70],
    [-16, 108],
  ];
  let nearest = 0;
  let nd = 1e9;
  nodes.forEach(([x, z], i) => {
    const d = Math.hypot(runtime.player.x - x, runtime.player.z - z);
    if (d < nd) {
      nd = d;
      nearest = i;
    }
  });
  if (nd > 14) {
    useGame.getState().whisper("No vein answers. The south is a city of doors, and you are not in it.");
    return;
  }
  const next = nodes[(nearest + 1) % nodes.length];
  runtime.player.set(next[0], heightAt(next[0], next[1]) + 1.2, next[1]);
  useGame.getState().whisper("Address unknown. Arriving anyway.");
}

function interact(dt: number) {
  const hold = input.pressed("KeyF");
  const tap = input.just("KeyF");
  const p = runtime.player;
  const g = useGame.getState();

  // placing
  if (g.placing && tap) {
    place(g.placing);
    useGame.setState({ placing: null });
    return;
  }

  // pickups
  for (const pk of runtime.pickups) {
    if (pk.taken) continue;
    if (pk.pos.distanceTo(p) < 1.8) {
      runtime.prompt = `Take ${pk.item.replace("_", " ")}`;
      if (tap) {
        pk.taken = true;
        g.addItem(pk.item);
        g.whisper(`You pocket ${pk.item.replaceAll("_", " ")}.`);
      }
      if (hold || tap) return;
    }
  }

  // residues
  for (const r of runtime.residues) {
    if (r.life <= 0) continue;
    r.life -= dt;
    if (r.pos.distanceTo(p) < 2.2) {
      runtime.prompt = `Absorb ${POWERS[r.power]?.name ?? "a lingering song"}`;
      if (hold) {
        runtime.absorbHold += dt;
        if (runtime.absorbHold > 1.35) {
          runtime.absorbHold = 0;
          if (g.absorb(r.power, "a lingering residue")) {
            r.life = 0;
            sting("absorb");
          }
        }
      }
      return;
    }
  }

  // creatures
  let nearestC: (typeof runtime.creatures extends Map<string, infer T> ? T : never) | null = null;
  let nd = 3.2;
  for (const c of runtime.creatures.values()) {
    const d = c.pos.distanceTo(p);
    if (d < nd) {
      nd = d;
      nearestC = c;
    }
  }
  if (nearestC) {
    const def = CREATURES[nearestC.type];
    const k = g.knowledge[def.power as PowerId];
    if (nearestC.dead) {
      runtime.prompt = "The body is quiet. The song already left.";
    } else if (def.peacefulAbsorb && (k === "witnessed" || k === "grasped")) {
      runtime.prompt = `Offer your hollow to the ${def.name}`;
      if (hold) {
        runtime.absorbHold += dt;
        if (runtime.absorbHold > 1.6) {
          runtime.absorbHold = 0;
          if (g.absorb(def.power as PowerId, def.name)) {
            nearestC.dead = true;
            nearestC.residue = 0;
            sting("absorb");
          }
        }
      }
    } else if ((k === "witnessed" || k === "grasped") && nearestC.hp <= def.hp * 0.34) {
      runtime.prompt = `Absorb ${def.name}`;
      if (hold) {
        runtime.absorbHold += dt;
        if (runtime.absorbHold > 1.6) {
          runtime.absorbHold = 0;
          if (g.absorb(def.power as PowerId, def.name)) {
            nearestC.dead = true;
            sting("absorb");
          }
        }
      }
    } else {
      runtime.prompt = `${def.name} — ${k === "witnessed" ? "the song is understood, but not yet weak" : "it shimmers"}`;
    }
    if (hold) return;
  }

  // npcs
  for (const n of SETTLEMENT.npcs) {
    const d = Math.hypot(p.x - n.x, p.z - n.z);
    if (d < 2.2) {
      runtime.prompt = `Speak with ${n.name}`;
      if (tap) {
        const line = n.lines[Math.min(n.lines.length - 1, (g.npcsTalked.filter((x) => x === n.id).length) % n.lines.length)];
        g.whisper(line);
        useGame.setState({ npcsTalked: [...g.npcsTalked, n.id] });
        g.addJournal(n.name, line);
      }
      return;
    }
  }

  // camp / hearth
  const camp = Math.hypot(p.x + 3.2, p.z - 21.4);
  if (camp < 2.4) {
    runtime.prompt = "Rest into the Weft";
    if (tap) {
      runtime.hp = Math.min(100, runtime.hp + 40);
      useGame.setState({ lastCamp: { x: p.x, y: p.y, z: p.z } });
      g.enterWeft();
      document.exitPointerLock?.();
    }
    return;
  }
  const hearth = Math.hypot(p.x - 2.5, p.z - 16.5);
  if (hearth < 2.2) {
    runtime.prompt = "Open the Hearth (C)";
    return;
  }

  for (const b of runtime.buildings) {
    if (b.kind === "camp" && b.pos.distanceTo(p) < 2.2) {
      runtime.prompt = "Rest into the Weft";
      if (tap) {
        runtime.hp = Math.min(100, runtime.hp + 40);
        useGame.setState({ lastCamp: { x: p.x, y: p.y, z: p.z } });
        g.enterWeft();
        document.exitPointerLock?.();
      }
      return;
    }
  }

  for (const c of HIDDEN_CACHES) {
    if (g.caches.includes(c.id)) continue;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d < 3.2) {
      if (c.need === "spore_sight" && !g.anyAttuned("spore_sight", "pollen_veil", "world_vein", "underdream") && !g.has("spore_sight")) {
        continue;
      }
      if (c.need === "gale_feather" && p.y < heightAt(c.x, c.z) + 8) continue;
      if (c.need === "hollow_debt" && g.hollowDebt < 4) continue;
      runtime.prompt = "A hidden thing waits";
      if (tap) {
        g.markCache(c.id);
        if (c.id === "cave") {
          g.addItem("nightiron");
          g.whisper("Behind the falling river: nightiron, colder than the hour.");
        } else if (c.id === "grove") {
          g.addItem("weftseed", 2);
          g.whisper("The hats part. Seeds of dream, still deciding.");
        } else if (c.id === "cellar") {
          g.addItem("hollowash");
          g.addJournal("Cellar", "Hearthmere keeps a second mouth. It tastes like endings.");
          g.whisper("A cellar that remembers every power taken and not returned.");
        } else if (c.id === "skyshard") {
          g.addItem("kiteplume");
          g.whisper("A mountain fragment that forgot gravity. It still tries to leave.");
        } else if (c.id === "hollow") {
          g.addItem("hollowash", 2);
          if (!g.has("unstable")) g.absorb("unstable", "the tear");
          g.whisper("You look into the debt. It looks back with your eyes.");
        }
      }
      return;
    }
  }

  if (!hold) runtime.absorbHold = 0;
  runtime.prompt = "";
}

function place(kind: "camp" | "totem" | "wall" | "bell") {
  const g = useGame.getState();
  const costs: Record<typeof kind, [string, number][]> = {
    camp: [["splinterwood", 3]],
    totem: [
      ["shardstone", 2],
      ["weftseed", 1],
    ],
    wall: [["shardstone", 4]],
    bell: [
      ["stormglass", 1],
      ["kiteplume", 1],
    ],
  };
  for (const [item, n] of costs[kind]) {
    if ((g.inventory[item] ?? 0) < n) {
      g.whisper(`Need ${n} ${item}.`);
      return;
    }
  }
  for (const [item, n] of costs[kind]) g.spend(item, n);
  const fwd = new THREE.Vector3(Math.sin(runtime.yaw), 0, Math.cos(runtime.yaw));
  const pos = runtime.player.clone().add(fwd.multiplyScalar(2.2));
  pos.y = heightAt(pos.x, pos.z);
  const powerId = kind === "totem" ? (g.attuned[0] ?? undefined) : undefined;
  runtime.buildings.push({
    id: `${kind}-${Date.now()}`,
    kind,
    pos,
    rot: runtime.yaw,
    powerId,
  });
  if (kind === "camp") {
    useGame.setState({ lastCamp: { x: pos.x, y: pos.y + 1.1, z: pos.z }, seed: g.seed + 1 });
    g.whisper("A small belonging. The Weft can find you here.");
  } else if (kind === "totem") {
    if (powerId) {
      useGame.setState({ hollowDebt: Math.max(0, g.hollowDebt - 1), seed: g.seed + 1 });
      g.whisper("You put a little back. The land notices.");
    } else {
      useGame.setState({ seed: g.seed + 1 });
      g.whisper("A totem with nothing to say.");
    }
  } else {
    useGame.setState({ seed: g.seed + 1 });
    g.whisper(kind === "bell" ? "A lure. Matching songs may come looking." : "Stone, convinced to stand.");
  }
}
