"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Float, Sparkles, Stars, Text } from "@react-three/drei";
import { useGame } from "@/game/store";
import { POWERS, type PowerId } from "@/game/data/powers";
import { runtime } from "@/game/runtime";
import { consumeLook, input } from "@/game/input";
import { sting } from "@/game/audio";

const auroraVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const auroraFrag = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    float bands = sin(uv.y * 8.0 + uTime * 0.4 + sin(uv.x * 4.0 + uTime * 0.2));
    vec3 col = mix(vec3(0.05, 0.02, 0.12), vec3(0.45, 0.2, 0.75), 0.5 + 0.5 * bands);
    col += vec3(0.2, 0.55, 0.7) * (0.3 + 0.3 * sin(a * 3.0 + uTime));
    float fade = smoothstep(1.2, 0.2, r);
    gl_FragColor = vec4(col * fade, 1.0);
  }
`;

export function WeftScene() {
  const held = useRef<PowerId | null>(null);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const { camera } = useThree();
  const pos = useRef(new THREE.Vector3(0, 2, 8));
  const yaw = useRef(0);
  const orb = useRef<THREE.Mesh>(null);
  const absorbed = useGame((s) => s.absorbed);

  const motes = useMemo(() => {
    const unique = absorbed.filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
    return unique.map((p, i) => {
      const ang = (i / Math.max(1, unique.length)) * Math.PI * 2;
      const r = 5.5 + (i % 3) * 1.4;
      return {
        id: p.id,
        x: Math.cos(ang) * r,
        z: Math.sin(ang) * r,
        y: 1.4 + (i % 4) * 0.55,
      };
    });
  }, [absorbed]);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    if (mat.current) mat.current.uniforms.uTime.value += dt;
    const look = consumeLook();
    yaw.current -= look.x * 0.0022;
    const axis = input.axis();
    const fwd = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    pos.current.addScaledVector(fwd, -axis.y * dt * 6);
    pos.current.addScaledVector(right, axis.x * dt * 6);
    if (input.pressed("Space")) pos.current.y += dt * 4;
    if (input.pressed("ControlLeft")) pos.current.y -= dt * 4;
    pos.current.y = Math.max(0.6, Math.min(8, pos.current.y));
    camera.position.copy(pos.current).add(new THREE.Vector3(Math.sin(yaw.current) * 5, 1.2, Math.cos(yaw.current) * 5));
    camera.lookAt(pos.current);
    if (orb.current) orb.current.position.copy(pos.current);

    runtime.prompt = "";
    if (pos.current.length() < 1.6) {
      runtime.prompt = "Wake (F)";
      if (input.just("KeyF")) {
        useGame.getState().leaveWeft();
        held.current = null;
        runtime.weftHeld = null;
      }
    } else {
      let near: (typeof motes)[number] | null = null;
      let nd = 1.6;
      for (const m of motes) {
        const d = pos.current.distanceTo(new THREE.Vector3(m.x, m.y, m.z));
        if (d < nd) {
          nd = d;
          near = m;
        }
      }
      if (near) {
        const name = POWERS[near.id].name;
        if (!held.current) {
          runtime.prompt = `Lift ${name} (F)`;
          if (input.just("KeyF")) {
            held.current = near.id;
            runtime.weftHeld = near.id;
            useGame.getState().whisper(`${name} rests in your hands like a live coal.`);
          }
        } else if (held.current !== near.id) {
          runtime.prompt = `Braid with ${name} (F)`;
          if (input.just("KeyF")) {
            const res = useGame.getState().braid(held.current, near.id);
            sting("braid");
            held.current = res.result ?? null;
            runtime.weftHeld = held.current;
          }
        }
      } else if (held.current) {
        runtime.prompt = `${POWERS[held.current].name} — walk it into another song`;
        if (input.just("KeyG")) {
          held.current = null;
          runtime.weftHeld = null;
        }
      }
    }
  });

  return (
    <group>
      <Stars radius={80} depth={40} count={800} factor={4} fade />
      <mesh scale={[80, 80, 80]}>
        <sphereGeometry args={[1, 32, 24]} />
        <shaderMaterial
          ref={mat}
          vertexShader={auroraVert}
          fragmentShader={auroraFrag}
          side={THREE.BackSide}
          uniforms={{ uTime: { value: 0 } }}
        />
      </mesh>
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 4, 0]} intensity={8} color="#a78bfa" />
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.2, 32]} />
        <meshStandardMaterial
          color="#1e1b4b"
          emissive="#4c1d95"
          emissiveIntensity={0.8}
        />
      </mesh>
      <Text position={[0, 3.4, 0]} fontSize={0.35} color="#ddd6fe" anchorX="center">
        THE WEFT
      </Text>
      <Text position={[0, 2.9, 0]} fontSize={0.16} color="#a78bfa" anchorX="center">
        Walk two songs together. Do not expect a recipe.
      </Text>
      {motes.map((m) => (
        <Mote key={m.id} {...m} held={runtime.weftHeld === m.id} />
      ))}
      <Sparkles count={60} scale={18} size={3} color="#c4b5fd" speed={0.3} />
      <mesh ref={orb}>
        <sphereGeometry args={[0.18, 10, 10]} />
        <meshStandardMaterial color="#fde68a" emissive="#fbbf24" emissiveIntensity={1} />
      </mesh>
    </group>
  );
}

function Mote({
  id,
  x,
  y,
  z,
  held,
}: {
  id: PowerId;
  x: number;
  y: number;
  z: number;
  held: boolean;
}) {
  const def = POWERS[id];
  return (
    <Float speed={1.4} floatIntensity={0.6}>
      <group position={[x, y, z]}>
        <mesh scale={held ? 1.35 : 1}>
          <icosahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial
            color={def.color}
            emissive={def.color}
            emissiveIntensity={held ? 2 : 1.1}
            roughness={0.25}
          />
        </mesh>
        <Text position={[0, 1.05, 0]} fontSize={0.18} color={def.color} anchorX="center">
          {def.name}
        </Text>
        <Sparkles count={12} scale={2} size={2} color={def.color} />
      </group>
    </Float>
  );
}
