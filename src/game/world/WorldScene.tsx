"use client";

import { TerrainMesh } from "./Terrain";
import { SkyWater, SunMoonLight } from "./SkyWater";
import { Vegetation, Settlement, Landmarks, PlayerBuildings } from "./Props";
import { Fog } from "./Fog";

export function WorldScene() {
  return (
    <group>
      <SunMoonLight />
      <SkyWater />
      <Fog />
      <TerrainMesh />
      <Vegetation />
      <Settlement />
      <Landmarks />
      <PlayerBuildings />
    </group>
  );
}
