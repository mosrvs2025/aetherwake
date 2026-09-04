"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Sparkles, Trail } from "@react-three/drei";
import { CREATURES, SPAWNS } from "@/game/data/creatures";
import { heightAt } from "@/game/data/world";
import { POWERS, type PowerId } from "@/game/data/powers";
import { runtime } from "@/game/runtime";
import { useGame } from "@/game/store";
import { PICKUPS } from "@/game/data/world";

const _to = new THREE.Vector3();

export function populateWorld() {
  runtime.creatures.clear();
  for (const s of SPAWNS) {
    const def = CREATURES[s.type];
    const y = heightAt(s.x, s.z) + (def.fly ? 8 : 1);
    runtime.creatures.set(s.id, {
      id: s.id,
      type: s.type,
      pos: new THREE.Vector3(s.x, y, s.z),
      hp: def.hp,
      maxHp: def.hp,
      radius: def.radius,
      yaw: Math.random() * Math.PI * 2,
      usingPower: false,
      residue: 0,
      dead: false,
      home: new THREE.Vector3(s.x, y, s.z),
    });
  }
  runtime.pickups = PICKUPS.map((p) => ({
    id: p.id,
    item: p.item,
    pos: new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.45, p.z),
    taken: false,
  }));
}

export function CreatureField() {
  useEffect(() => {
    if (runtime.creatures.size === 0) populateWorld();
  }, []);

  useFrame((_, dt) => {
    if (useGame.getState().mode !== "playing") return;
    dt = Math.min(dt, 0.05);
      const night = runtime.timeOfDay < 0.22 || runtime.timeOfDay > 0.78;
    const player = runtime.player;
    const g = useGame.getState();

    for (const c of runtime.creatures.values()) {
      const def = CREATURES[c.type];
      if (c.dead) {
        c.residue -= dt;
        if (c.residue < -90 && c.type !== "skybreaker") {
          c.dead = false;
          c.hp = def.hp;
          c.pos.copy(c.home);
        }
        continue;
      }

      if ((c.type === "glassmoth" || c.type === "nightbloom") && !night) {
        if (c.type === "glassmoth") c.pos.y = heightAt(c.pos.x, c.pos.z) + 0.4;
      }

      const dist = c.pos.distanceTo(player);
      if (dist < 48) g.see(def.power as PowerId);

      c.usingPower = false;
      const t = runtime.time + c.pos.x * 0.1;

      if (def.fly) {
        const r = c.type === "skybreaker" ? 12 : 6;
        const h = c.type === "skybreaker" ? 14 : 8;
        c.pos.x = c.home.x + Math.cos(t * (c.type === "skybreaker" ? 0.25 : 0.55)) * r;
        c.pos.z = c.home.z + Math.sin(t * (c.type === "skybreaker" ? 0.25 : 0.55)) * r;
        c.pos.y = heightAt(c.home.x, c.home.z) + h + Math.sin(t * 1.3) * 1.6;
        c.yaw = t;
        if (dist < 32 && Math.sin(t * 2) > 0.92) {
          c.usingPower = true;
          g.witness(def.power as PowerId);
        }
        if (def.aggressive && dist < 28 && c.type === "skybreaker") {
          if (Math.sin(t * 1.7) > 0.7) {
            _to.copy(player).sub(c.pos).normalize();
            c.pos.addScaledVector(_to, def.speed * dt * 1.4);
            if (dist < 5.5 && runtime.invuln <= 0) {
              hitPlayer(def.damage);
              g.witness(def.power as PowerId);
              c.usingPower = true;
            }
          }
        }
      } else if (def.speed > 0) {
        const aggro = def.aggressive && dist < 16 && !runtime.steam;
        const target = runtime.decoy && runtime.decoyLife > 0 ? runtime.decoy : player;
        if (aggro || (dist < 10 && def.aggressive)) {
          _to.copy(target).sub(c.pos);
          _to.y = 0;
          const len = _to.length() || 1;
          _to.multiplyScalar(def.speed / len);
          c.pos.x += _to.x * dt;
          c.pos.z += _to.z * dt;
          c.yaw = Math.atan2(_to.x, _to.z);
          if (dist < def.radius + 1.3 && runtime.invuln <= 0) {
            hitPlayer(def.damage);
            c.usingPower = true;
            g.witness(def.power as PowerId);
          }
        } else {
          c.pos.x = c.home.x + Math.cos(t * 0.25 + c.home.z) * 3.4;
          c.pos.z = c.home.z + Math.sin(t * 0.22 + c.home.x) * 3.4;
        }
        c.pos.y = heightAt(c.pos.x, c.pos.z) + 1;
        if (c.type === "tidewight") {
          c.pos.y = Math.max(c.pos.y, 2.45 + 1);
          if (dist < 22 && Math.sin(t * 1.4) > 0.85) {
            c.usingPower = true;
            g.witness(def.power as PowerId);
          }
        }
        if (dist < 18 && Math.sin(t * 0.9 + c.home.x) > 0.93) {
          c.usingPower = true;
          g.witness(def.power as PowerId);
        }
      } else {
        // nightbloom
        c.pos.y = heightAt(c.pos.x, c.pos.z);
        if (night && dist < 10) {
          c.usingPower = true;
          g.witness(def.power as PowerId);
        }
      }

      // bells lure matching
      for (const b of runtime.buildings) {
        if (b.kind !== "bell") continue;
        if (b.pos.distanceTo(c.pos) < 28 && !def.aggressive) {
          _to.copy(b.pos).sub(c.pos).multiplyScalar(dt * 0.8);
          c.pos.add(_to);
        }
      }
    }
  });

  const tick = useGame((s) => s.seed);
  void tick;

  return (
    <group>
      {SPAWNS.map((s) => (
        <Body key={s.id} id={s.id} />
      ))}
      {runtime.pickups
        .filter((p) => !p.taken)
        .map((p) => (
          <mesh key={p.id} position={p.pos.toArray()}>
            <octahedronGeometry args={[0.22, 0]} />
            <meshStandardMaterial
              color="#fde68a"
              emissive="#fbbf24"
              emissiveIntensity={0.9}
            />
          </mesh>
        ))}
      {runtime.residues
        .filter((r) => r.life > 0)
        .map((r, i) => (
          <mesh key={`res-${i}`} position={r.pos.toArray()}>
            <icosahedronGeometry args={[0.38, 0]} />
            <meshStandardMaterial
              color={POWERS[r.power]?.color ?? "#fff"}
              emissive={POWERS[r.power]?.color ?? "#fff"}
              emissiveIntensity={1.4}
              transparent
              opacity={0.85}
            />
          </mesh>
        ))}
    </group>
  );
}

function hitPlayer(dmg: number) {
  if (runtime.invuln > 0) return;
  const steam = runtime.steam > 0;
  const hide = runtime.basalt > 0 || useGame.getState().isAttuned("basalt_hide");
  const taken = dmg * (steam ? 0.35 : 1) * (hide ? 0.55 : 1);
  runtime.hp -= taken;
  runtime.invuln = 0.75;
}

function Body({ id }: { id: string }) {
  const ref = useRef<THREE.Group>(null);
  const c0 = runtime.creatures.get(id);
  const type = c0?.type ?? "stormkite";
  const def = CREATURES[type];
  const color = def.color;
  const power = POWERS[def.power as PowerId];
  const seen = useGame((s) => s.knowledge[def.power as PowerId]);

  useFrame(() => {
    const c = runtime.creatures.get(id);
    if (!ref.current || !c) return;
    const night = runtime.timeOfDay < 0.22 || runtime.timeOfDay > 0.78;
    const hide = c.dead || (c.type === "glassmoth" && !night);
    ref.current.visible = !hide;
    if (hide) return;
    ref.current.position.copy(c.pos);
    ref.current.rotation.y = c.yaw;
  });

  return (
    <group ref={ref}>
      {type === "stormkite" && <Kite color={color} active={false} />}
      {type === "basalt" && <Golem color={color} />}
      {type === "embermaw" && <Maw color={color} active={false} />}
      {type === "sporestag" && <Stag color={color} active={false} />}
      {type === "tidewight" && <Wight color={color} active={false} />}
      {type === "rootwraith" && <Wraith color={color} />}
      {type === "glassmoth" && <Moth color={color} />}
      {type === "nightbloom" && <Bloom active />}
      {type === "lodestone" && <Titan color={color} active={false} />}
      {type === "skybreaker" && <Boss color={color} active={false} />}
      {seen && (
        <Sparkles
          count={type === "skybreaker" ? 28 : 10}
          scale={def.radius * 3}
          size={2.4}
          color={power?.color ?? "#fff"}
          speed={0.6}
        />
      )}
    </group>
  );
}

function Kite({ color, active }: { color: [number, number, number]; active: boolean }) {
  return (
    <group>
      <mesh rotation={[0.2, 0, 0]}>
        <coneGeometry args={[0.22, 1.6, 5]} />
        <meshStandardMaterial color={rgb(color)} emissive="#7dd3fc" emissiveIntensity={active ? 1.2 : 0.3} />
      </mesh>
      <mesh position={[0.7, 0, 0.1]} rotation={[0, 0, 0.4]}>
        <boxGeometry args={[1.5, 0.06, 0.5]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.8} />
      </mesh>
      <mesh position={[-0.7, 0, 0.1]} rotation={[0, 0, -0.4]}>
        <boxGeometry args={[1.5, 0.06, 0.5]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function Golem({ color }: { color: [number, number, number] }) {
  return (
    <group>
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[1.4, 1.4, 1.1]} />
        <meshStandardMaterial color={rgb(color)} roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <boxGeometry args={[0.9, 0.8, 0.8]} />
        <meshStandardMaterial color="#57534e" />
      </mesh>
    </group>
  );
}

function Maw({ color, active }: { color: [number, number, number]; active: boolean }) {
  return (
    <group>
      <mesh rotation={[0, 0, 0.1]} castShadow>
        <capsuleGeometry args={[0.35, 1.1, 4, 8]} />
        <meshStandardMaterial
          color={rgb(color)}
          emissive="#ea580c"
          emissiveIntensity={active ? 1.6 : 0.4}
        />
      </mesh>
      <mesh position={[0.45, 0.15, 0.4]}>
        <sphereGeometry args={[0.18, 6, 6]} />
        <meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={1} />
      </mesh>
    </group>
  );
}

function Stag({ color, active }: { color: [number, number, number]; active: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} castShadow>
        <capsuleGeometry args={[0.28, 1.1, 4, 8]} />
        <meshStandardMaterial color={rgb(color)} />
      </mesh>
      <mesh position={[0.15, 0.85, 0.35]}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshStandardMaterial color="#4c1d95" />
      </mesh>
      <mesh position={[0.05, 1.35, 0.2]}>
        <sphereGeometry args={[0.32, 8, 8]} />
        <meshStandardMaterial
          color="#7e22ce"
          emissive="#c026d3"
          emissiveIntensity={active ? 1.4 : 0.5}
        />
      </mesh>
      <mesh position={[-0.2, 1.45, 0.05]}>
        <sphereGeometry args={[0.24, 8, 8]} />
        <meshStandardMaterial color="#a855f7" emissive="#d946ef" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function Wight({ color, active }: { color: [number, number, number]; active: boolean }) {
  return (
    <mesh>
      <capsuleGeometry args={[0.28, 1.1, 4, 8]} />
      <meshStandardMaterial
        color={rgb(color)}
        transparent
        opacity={0.55}
        emissive="#2dd4bf"
        emissiveIntensity={active ? 1.3 : 0.4}
      />
    </mesh>
  );
}

function Wraith({ color }: { color: [number, number, number] }) {
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.sin(i) * 0.3, i * 0.45, Math.cos(i) * 0.2]} rotation={[0.2, i, 0.3]}>
          <cylinderGeometry args={[0.05, 0.12, 1.4, 5]} />
          <meshStandardMaterial color={rgb(color)} />
        </mesh>
      ))}
      <mesh position={[0, 0.8, 0]}>
        <sphereGeometry args={[0.28, 6, 6]} />
        <meshStandardMaterial color="#14532d" emissive="#22c55e" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

function Moth({ color }: { color: [number, number, number] }) {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.12, 6, 6]} />
        <meshStandardMaterial color={rgb(color)} />
      </mesh>
      <mesh position={[0.25, 0, 0]} rotation={[0.2, 0, 0.4]}>
        <planeGeometry args={[0.7, 0.45]} />
        <meshStandardMaterial
          color="#f5d0fe"
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          emissive="#e879f9"
          emissiveIntensity={0.6}
        />
      </mesh>
      <mesh position={[-0.25, 0, 0]} rotation={[0.2, 0, -0.4]}>
        <planeGeometry args={[0.7, 0.45]} />
        <meshStandardMaterial
          color="#f5d0fe"
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function Bloom({ active }: { active: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 0.7, 6]} />
        <meshStandardMaterial color="#365314" />
      </mesh>
      <mesh position={[0, 0.8, 0]}>
        <sphereGeometry args={[active ? 0.42 : 0.18, 10, 10]} />
        <meshStandardMaterial
          color="#312e81"
          emissive="#818cf8"
          emissiveIntensity={active ? 1.6 : 0.1}
        />
      </mesh>
    </group>
  );
}

function Titan({ color, active }: { color: [number, number, number]; active: boolean }) {
  return (
    <group>
      <mesh position={[0, 1.2, 0]} castShadow>
        <boxGeometry args={[2.4, 2.6, 1.8]} />
        <meshStandardMaterial
          color={rgb(color)}
          metalness={0.55}
          roughness={0.4}
          emissive="#93c5fd"
          emissiveIntensity={active ? 0.8 : 0.2}
        />
      </mesh>
      <mesh position={[0, 2.8, 0]}>
        <boxGeometry args={[1.4, 1.2, 1.3]} />
        <meshStandardMaterial color="#334155" metalness={0.6} />
      </mesh>
    </group>
  );
}

function Boss({ color, active }: { color: [number, number, number]; active: boolean }) {
  return (
    <group>
      <Trail width={1.4} length={6} color="#fde68a" attenuation={(t) => t * t}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.7, 5.4, 6, 10]} />
          <meshStandardMaterial
            color={rgb(color)}
            emissive="#fbbf24"
            emissiveIntensity={active ? 1.5 : 0.45}
          />
        </mesh>
      </Trail>
      <mesh position={[0, 0.2, 2.4]}>
        <coneGeometry args={[0.7, 1.6, 6]} />
        <meshStandardMaterial color="#fef3c7" emissive="#f59e0b" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[2.4, 0.4, 0]} rotation={[0, 0, 0.5]}>
        <boxGeometry args={[4.5, 0.12, 1.4]} />
        <meshStandardMaterial color="#fde68a" transparent opacity={0.7} />
      </mesh>
      <mesh position={[-2.4, 0.4, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[4.5, 0.12, 1.4]} />
        <meshStandardMaterial color="#fde68a" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function rgb(c: [number, number, number]) {
  return new THREE.Color(c[0], c[1], c[2]);
}
