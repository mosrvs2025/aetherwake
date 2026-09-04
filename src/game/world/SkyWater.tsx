"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Stars } from "@react-three/drei";
import { WORLD } from "@/game/data/world";
import { runtime } from "@/game/runtime";

const skyVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const skyFrag = /* glsl */ `
  varying vec3 vWorld;
  uniform float uDay;
  uniform vec3 uSun;
  void main() {
    vec3 dir = normalize(vWorld);
    float h = dir.y * 0.5 + 0.5;
    vec3 night = mix(vec3(0.01, 0.02, 0.06), vec3(0.05, 0.04, 0.12), h);
    vec3 day = mix(vec3(0.35, 0.22, 0.28), vec3(0.45, 0.72, 0.95), h);
    vec3 dusk = mix(vec3(0.25, 0.08, 0.06), vec3(0.7, 0.35, 0.2), h);
    float dayness = smoothstep(0.18, 0.38, uDay) * (1.0 - smoothstep(0.62, 0.82, uDay));
    float duskness = smoothstep(0.08, 0.2, uDay) * (1.0 - smoothstep(0.28, 0.4, uDay))
                   + smoothstep(0.62, 0.74, uDay) * (1.0 - smoothstep(0.82, 0.95, uDay));
    vec3 col = mix(night, day, dayness);
    col = mix(col, dusk, duskness);
    float sun = pow(max(0.0, dot(dir, normalize(uSun))), 80.0);
    col += vec3(1.0, 0.85, 0.55) * sun * (0.4 + dayness);
    float moon = pow(max(0.0, dot(dir, normalize(-uSun))), 140.0);
    col += vec3(0.6, 0.7, 1.0) * moon * (1.0 - dayness);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const waterVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  uniform float uTime;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += sin(p.x * 0.12 + uTime * 0.8) * 0.12 + sin(p.y * 0.17 - uTime * 0.6) * 0.08;
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const waterFrag = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  uniform float uTime;
  uniform float uDay;
  void main() {
    float w = sin(vUv.x * 40.0 + uTime) * 0.5 + sin(vUv.y * 32.0 - uTime * 0.7) * 0.5;
    vec3 deep = vec3(0.03, 0.12, 0.2);
    vec3 lite = vec3(0.18, 0.55, 0.58);
    vec3 col = mix(deep, lite, 0.45 + w * 0.2);
    col *= 0.45 + uDay * 0.7;
    float foam = smoothstep(0.75, 1.0, w);
    col += foam * 0.15;
    gl_FragColor = vec4(col, 0.78);
  }
`;

export function SkyWater() {
  const skyMat = useRef<THREE.ShaderMaterial>(null);
  const sun = useMemo(() => new THREE.Vector3(), []);
  const waterUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDay: { value: 0.3 },
    }),
    [],
  );

  useFrame(({ clock }) => {
    const day = runtime.timeOfDay;
    const ang = (day - 0.25) * Math.PI * 2;
    sun.set(Math.cos(ang) * 180, Math.sin(ang) * 140, 40);
    if (skyMat.current) {
      skyMat.current.uniforms.uDay.value = day;
      skyMat.current.uniforms.uSun.value.copy(sun).normalize();
    }
    waterUniforms.uTime.value = clock.elapsedTime;
    waterUniforms.uDay.value = day;
  });

  return (
    <group>
      <mesh>
        <sphereGeometry args={[420, 32, 24]} />
        <shaderMaterial
          ref={skyMat}
          vertexShader={skyVert}
          fragmentShader={skyFrag}
          glslVersion={THREE.GLSL1}
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{
            uDay: { value: 0.3 },
            uSun: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
          }}
        />
      </mesh>
      <Stars radius={200} depth={60} count={900} factor={3} fade speed={0.4} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-90, WORLD.water, -5]}
      >
        <planeGeometry args={[140, 160, 48, 48]} />
        <shaderMaterial
          vertexShader={waterVert}
          fragmentShader={waterFrag}
          glslVersion={THREE.GLSL1}
          transparent
          uniforms={waterUniforms}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[8, WORLD.water - 0.3, -20]}>
        <planeGeometry args={[18, 90, 12, 24]} />
        <shaderMaterial
          vertexShader={waterVert}
          fragmentShader={waterFrag}
          glslVersion={THREE.GLSL1}
          transparent
          uniforms={waterUniforms}
        />
      </mesh>
    </group>
  );
}

export function SunMoonLight() {
  const dir = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const day = runtime.timeOfDay;
    const ang = (day - 0.25) * Math.PI * 2;
    const y = Math.sin(ang);
    if (dir.current) {
      dir.current.position.set(Math.cos(ang) * 80, Math.max(8, y * 70), 30);
      dir.current.intensity = Math.max(0.15, y * 1.35);
      dir.current.color.set(y > 0.05 ? "#fff1d6" : "#8b9cff");
    }
  });
  return (
    <>
      <hemisphereLight args={["#b8c4ff", "#2a1c16", 0.45]} />
      <ambientLight intensity={0.18} />
      <directionalLight
        ref={dir}
        castShadow
        intensity={1.1}
        position={[40, 70, 20]}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={2}
        shadow-camera-far={220}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />
    </>
  );
}
