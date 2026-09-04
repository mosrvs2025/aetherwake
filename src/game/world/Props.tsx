"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Float, Sparkles, Text } from "@react-three/drei";
import { biomeAt, heightAt, SETTLEMENT } from "@/game/data/world";
import { useGame } from "@/game/store";
import { runtime } from "@/game/runtime";

function scatter(
  count: number,
  seed: number,
  ok: (x: number, z: number) => boolean,
) {
  const pts: [number, number, number][] = [];
  let i = 0;
  let g = seed;
  while (pts.length < count && i < count * 18) {
    i++;
    g = (g * 16807 + 3) % 2147483647;
    const x = ((g % 3600) / 3600) * 340 - 170;
    g = (g * 16807 + 3) % 2147483647;
    const z = ((g % 3600) / 3600) * 340 - 170;
    if (!ok(x, z)) continue;
    pts.push([x, heightAt(x, z), z]);
  }
  return pts;
}

export function Vegetation() {
  const trees = useMemo(
    () =>
      scatter(70, 11, (x, z) => {
        const b = biomeAt(x, z);
        return (b === "vale" || b === "hearthmere") && heightAt(x, z) > 4 && Math.hypot(x, z - 18) > 12;
      }),
    [],
  );
  const ash = useMemo(
    () => scatter(40, 29, (x, z) => biomeAt(x, z) === "ember"),
    [],
  );
  const shrooms = useMemo(
    () => scatter(55, 47, (x, z) => biomeAt(x, z) === "mycelia"),
    [],
  );
  const spines = useMemo(
    () => scatter(22, 61, (x, z) => biomeAt(x, z) === "storm" && heightAt(x, z) > 10),
    [],
  );
  const reeds = useMemo(
    () => scatter(36, 83, (x, z) => biomeAt(x, z) === "tide"),
    [],
  );

  return (
    <group>
      {trees.map((p, i) => (
        <group key={`t${i}`} position={p}>
          <mesh position={[0, 1.1, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.28, 2.2, 5]} />
            <meshStandardMaterial color="#3f2a1a" roughness={1} />
          </mesh>
          <mesh position={[0, 2.8, 0]} castShadow>
            <coneGeometry args={[1.3 + (i % 5) * 0.08, 2.6, 6]} />
            <meshStandardMaterial color={i % 3 === 0 ? "#245c38" : "#1d4a32"} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {ash.map((p, i) => (
        <group key={`a${i}`} position={p}>
          <mesh position={[0, 1.4, 0]}>
            <cylinderGeometry args={[0.08, 0.2, 2.8, 4]} />
            <meshStandardMaterial color="#1a0c08" />
          </mesh>
          <mesh position={[0, 2.6, 0]}>
            <sphereGeometry args={[0.35, 6, 6]} />
            <meshStandardMaterial
              color="#4a1a0a"
              emissive="#ff6b2d"
              emissiveIntensity={0.25 + (i % 4) * 0.1}
            />
          </mesh>
        </group>
      ))}
      {shrooms.map((p, i) => (
        <group key={`s${i}`} position={p}>
          <mesh position={[0, 0.7 + (i % 3) * 0.25, 0]}>
            <cylinderGeometry args={[0.12, 0.18, 1.4, 6]} />
            <meshStandardMaterial color="#d8c4f0" />
          </mesh>
          <mesh position={[0, 1.5 + (i % 3) * 0.25, 0]}>
            <sphereGeometry args={[0.7 + (i % 4) * 0.12, 8, 8]} />
            <meshStandardMaterial
              color="#6b21a8"
              emissive="#c026d3"
              emissiveIntensity={0.45}
            />
          </mesh>
        </group>
      ))}
      {spines.map((p, i) => (
        <mesh key={`p${i}`} position={[p[0], p[1] + 4 + (i % 3), p[2]]} castShadow>
          <cylinderGeometry args={[0.45, 1.1, 8 + (i % 4), 6]} />
          <meshStandardMaterial color="#4b5563" metalness={0.25} roughness={0.55} />
        </mesh>
      ))}
      {reeds.map((p, i) => (
        <mesh key={`r${i}`} position={[p[0], p[1] + 0.7, p[2]]} rotation={[0, i, 0.1]}>
          <coneGeometry args={[0.08, 1.6, 4]} />
          <meshStandardMaterial color="#5eead4" emissive="#2dd4bf" emissiveIntensity={0.2} />
        </mesh>
      ))}
    </group>
  );
}

export function Settlement() {
  const houses: [number, number, number, number][] = [
    [4.5, 0, 18.2, 0.3],
    [-7.2, 0, 17.4, -0.4],
    [8.8, 0, 22.6, 0.8],
    [-9.4, 0, 23.8, -0.2],
    [0.2, 0, 28.4, 0.1],
  ];
  return (
    <group>
      {houses.map(([x, , z, rot], i) => {
        const y = heightAt(x, z);
        return (
          <group key={i} position={[x, y, z]} rotation={[0, rot, 0]}>
            <mesh position={[0, 1.2, 0]} castShadow>
              <boxGeometry args={[3.2, 2.4, 2.6]} />
              <meshStandardMaterial color="#4a3424" roughness={0.9} />
            </mesh>
            <mesh position={[0, 2.7, 0]} rotation={[0, Math.PI / 4, 0]}>
              <coneGeometry args={[2.4, 1.6, 4]} />
              <meshStandardMaterial color="#2a1810" />
            </mesh>
            <mesh position={[1.05, 1.15, 1.32]}>
              <planeGeometry args={[0.5, 0.6]} />
              <meshStandardMaterial
                color="#fbbf24"
                emissive="#f59e0b"
                emissiveIntensity={0.8}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
      <group position={[2.5, heightAt(2.5, 16.5), 16.5]}>
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[1.1, 1.3, 0.4, 10]} />
          <meshStandardMaterial color="#1c1917" />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <sphereGeometry args={[0.35, 8, 8]} />
          <meshStandardMaterial color="#fb923c" emissive="#ea580c" emissiveIntensity={1.4} />
        </mesh>
        <Sparkles count={18} scale={2.2} size={2.5} color="#fdba74" speed={0.4} />
        <Text
          position={[0, 2.2, 0]}
          fontSize={0.28}
          color="#fde68a"
          anchorX="center"
        >
          Hearth
        </Text>
      </group>
      <group position={[-3.2, heightAt(-3.2, 21.4), 21.4]}>
        <mesh position={[0, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.3, 0.08, 8, 18]} />
          <meshStandardMaterial color="#c4b5fd" emissive="#8b5cf6" emissiveIntensity={0.6} />
        </mesh>
        <Float speed={1.4} floatIntensity={0.4}>
          <mesh position={[0, 0.9, 0]}>
            <octahedronGeometry args={[0.28, 0]} />
            <meshStandardMaterial color="#ddd6fe" emissive="#a78bfa" emissiveIntensity={1.2} />
          </mesh>
        </Float>
        <Text position={[0, 2.1, 0]} fontSize={0.26} color="#ddd6fe" anchorX="center">
          Weft Camp
        </Text>
      </group>
      {SETTLEMENT.npcs.map((n) => (
        <Npc key={n.id} {...n} />
      ))}
      <Lantern x={1.2} z={13.4} />
      <Lantern x={-4.4} z={18.8} />
      <Lantern x={7.2} z={20.5} />
      <mesh position={[0, heightAt(0, 18) + 6.5, 18]}>
        <cylinderGeometry args={[0.08, 0.14, 8, 6]} />
        <meshStandardMaterial color="#a8a29e" />
      </mesh>
      <Text
        position={[0, heightAt(0, 18) + 11.2, 18]}
        fontSize={0.55}
        color="#fde68a"
        anchorX="center"
      >
        HEARTHMERE
      </Text>
    </group>
  );
}

function Lantern({ x, z }: { x: number; z: number }) {
  const y = heightAt(x, z);
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 1.4, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 2.8, 5]} />
        <meshStandardMaterial color="#292524" />
      </mesh>
      <mesh position={[0, 2.85, 0]}>
        <sphereGeometry args={[0.16, 8, 8]} />
        <meshStandardMaterial color="#fde68a" emissive="#fbbf24" emissiveIntensity={1.6} />
      </mesh>
    </group>
  );
}

function Npc({
  id,
  name,
  x,
  z,
}: {
  id: string;
  name: string;
  x: number;
  z: number;
  lines: string[];
}) {
  const y = heightAt(x, z);
  const talked = useGame((s) => s.npcsTalked.includes(id));
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.95, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.85, 4, 8]} />
        <meshStandardMaterial color={talked ? "#78716c" : "#d6d3d1"} />
      </mesh>
      <mesh position={[0, 1.62, 0.05]}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshStandardMaterial color="#f5e6d3" />
      </mesh>
      <Text position={[0, 2.25, 0]} fontSize={0.2} color="#fde68a" anchorX="center">
        {name}
      </Text>
    </group>
  );
}

export function Landmarks() {
  const crag = heightAt(108, -122);
  const islandY = heightAt(42, -44) + 16;
  const spore = useGame((s) => s.anyAttuned("spore_sight", "pollen_veil", "underdream", "world_vein"));
  const underdream = useGame((s) => s.anyAttuned("underdream") || s.has("underdream"));
  const debt = useGame((s) => s.hollowDebt);

  const veins = useMemo(() => {
    const pts = [
      [12, 88],
      [-20, 102],
      [36, 96],
      [28, 118],
      [0, 70],
      [-16, 108],
      [18, 96],
    ] as const;
    const positions: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      for (let t = 0; t < 8; t++) {
        const u = t / 8;
        const x = a[0] + (b[0] - a[0]) * u;
        const z = a[1] + (b[1] - a[1]) * u;
        positions.push(x, heightAt(x, z) + 0.3, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, []);

  return (
    <group>
      <group position={[108, crag, -122]}>
        <mesh position={[0, 6, 0]}>
          <coneGeometry args={[10, 16, 7]} />
          <meshStandardMaterial color="#57534e" roughness={0.8} />
        </mesh>
        <Sparkles count={40} scale={[14, 10, 14]} size={4} color="#fde68a" speed={0.6} />
      </group>

      <group position={[42, islandY, -44]}>
        <mesh>
          <dodecahedronGeometry args={[4.2, 0]} />
          <meshStandardMaterial color="#78716c" />
        </mesh>
        <mesh position={[0, 2.2, 0]}>
          <sphereGeometry args={[0.5, 8, 8]} />
          <meshStandardMaterial color="#f5d0fe" emissive="#e879f9" emissiveIntensity={1.2} />
        </mesh>
        <Sparkles count={20} scale={6} size={3} color="#f5d0fe" />
      </group>

      <mesh position={[-38, heightAt(-38, 8) + 4, 8]}>
        <boxGeometry args={[0.6, 9, 3.5]} />
        <meshStandardMaterial
          color="#7dd3fc"
          transparent
          opacity={0.28}
          emissive="#38bdf8"
          emissiveIntensity={0.3}
        />
      </mesh>

      <group position={[-1.4, heightAt(-1.4, 17.2) + 0.05, 17.2]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.7, 12]} />
          <meshStandardMaterial color="#1c1917" />
        </mesh>
      </group>

      {spore && (
        <points geometry={veins}>
          <pointsMaterial color="#c084fc" size={1.1} transparent opacity={0.85} />
        </points>
      )}

      {underdream && (
        <Sparkles
          count={80}
          scale={[160, 20, 160]}
          size={2}
          color="#a78bfa"
          speed={0.15}
          position={[0, 10, 0]}
        />
      )}

      {debt >= 4 && (
        <group position={[16, heightAt(16, 74) + 1, 74]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.2, 3.6, 20]} />
            <meshStandardMaterial
              color="#2e1065"
              emissive="#6d28d9"
              emissiveIntensity={1.4}
              side={THREE.DoubleSide}
            />
          </mesh>
          <Sparkles count={30} scale={6} color="#c4b5fd" />
        </group>
      )}

      <Float floatIntensity={0.6} speed={0.7}>
        <mesh position={[3.5, heightAt(3.5, 4.2) + 0.4, 4.2]}>
          <coneGeometry args={[0.12, 0.7, 5]} />
          <meshStandardMaterial color="#e0f2fe" emissive="#7dd3fc" emissiveIntensity={0.8} />
        </mesh>
      </Float>
    </group>
  );
}

export function PlayerBuildings() {
  const tick = useGame((s) => s.seed);
  void tick;
  return (
    <group>
      {runtime.buildings.map((b) => (
        <group key={b.id} position={b.pos.toArray()} rotation={[0, b.rot, 0]}>
          {b.kind === "camp" && (
            <>
              <mesh>
                <cylinderGeometry args={[0.9, 1, 0.3, 10]} />
                <meshStandardMaterial color="#1c1917" />
              </mesh>
              <mesh position={[0, 0.4, 0]}>
                <sphereGeometry args={[0.28, 8, 8]} />
                <meshStandardMaterial color="#fb923c" emissive="#ea580c" emissiveIntensity={1.3} />
              </mesh>
            </>
          )}
          {b.kind === "totem" && (
            <mesh position={[0, 1.4, 0]}>
              <cylinderGeometry args={[0.18, 0.28, 2.8, 6]} />
              <meshStandardMaterial
                color="#a8a29e"
                emissive={b.powerId ? POW_COLOR[b.powerId] ?? "#a78bfa" : "#444"}
                emissiveIntensity={0.8}
              />
            </mesh>
          )}
          {b.kind === "wall" && (
            <mesh position={[0, 1.1, 0]}>
              <boxGeometry args={[3.2, 2.2, 0.45]} />
              <meshStandardMaterial color="#57534e" />
            </mesh>
          )}
          {b.kind === "bell" && (
            <mesh position={[0, 1.5, 0]}>
              <sphereGeometry args={[0.4, 10, 10]} />
              <meshStandardMaterial color="#fde68a" metalness={0.7} roughness={0.25} emissive="#fbbf24" emissiveIntensity={0.5} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

const POW_COLOR: Record<string, string> = {
  gale_feather: "#7dd3fc",
  ember_tongue: "#fb923c",
  storm_vein: "#93c5fd",
  spore_sight: "#c084fc",
  tide_step: "#2dd4bf",
  root_bind: "#86efac",
  night_veil: "#818cf8",
  glass_echo: "#f5d0fe",
};
