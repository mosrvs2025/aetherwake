"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { biomeAt, BIOME_FOG } from "@/game/data/world";
import { runtime } from "@/game/runtime";

export function Fog() {
  const fog = useRef<THREE.Fog>(null);
  useFrame(() => {
    const b = biomeAt(runtime.player.x, runtime.player.z);
    const hex = BIOME_FOG[b];
    if (fog.current) {
      fog.current.color.set(hex);
      const night = runtime.timeOfDay < 0.22 || runtime.timeOfDay > 0.78;
      fog.current.near = night ? 18 : 28;
      fog.current.far = night ? 110 : 160;
    }
  });
  return <fog ref={fog} attach="fog" args={["#1c1730", 28, 150]} />;
}
