"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { WORLD, biomeAt, biomeColor, fbm, heightAt } from "@/game/data/world";

export function TerrainMesh() {
  const { geo, glow } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      WORLD.size,
      WORLD.size,
      WORLD.segments,
      WORLD.segments,
    );
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const emissive = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = heightAt(x, z);
      pos.setY(i, y);
      const [r, g, b] = biomeColor(x, z);
      const n = fbm(x * 0.2, z * 0.2);
      colors[i * 3] = r + n * 0.04;
      colors[i * 3 + 1] = g + n * 0.03;
      colors[i * 3 + 2] = b;
      const biome = biomeAt(x, z);
      emissive[i] =
        biome === "ember"
          ? Math.max(0, n - 0.62) * 4
          : biome === "mycelia"
            ? Math.max(0, n - 0.55) * 3
            : biome === "hollow"
              ? 0.4
              : 0;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const glow = new THREE.BufferGeometry();
    const gpos: number[] = [];
    const gcol: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (emissive[i] <= 0.05) continue;
      gpos.push(pos.getX(i), pos.getY(i) + 0.04, pos.getZ(i));
      const biome = biomeAt(pos.getX(i), pos.getZ(i));
      if (biome === "ember") gcol.push(1, 0.35, 0.08);
      else if (biome === "hollow") gcol.push(0.45, 0.2, 0.8);
      else gcol.push(0.7, 0.3, 1);
    }
    glow.setAttribute("position", new THREE.Float32BufferAttribute(gpos, 3));
    glow.setAttribute("color", new THREE.Float32BufferAttribute(gcol, 3));
    return { geo, glow };
  }, []);

  return (
    <group>
      <mesh geometry={geo} receiveShadow castShadow>
        <meshStandardMaterial
          vertexColors
          roughness={0.92}
          metalness={0.04}
          flatShading={false}
        />
      </mesh>
      <points geometry={glow}>
        <pointsMaterial
          vertexColors
          size={1.35}
          transparent
          opacity={0.7}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}
