"use client";

import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import { WorldScene } from "@/game/world/WorldScene";
import { Player } from "@/game/player/Player";
import { CreatureField, populateWorld } from "@/game/creatures/Field";
import { WeftScene } from "@/game/weft/WeftScene";
import { HUD, TitleScreen } from "@/game/ui/HUD";
import { useGame } from "@/game/store";
import { bindInput } from "@/game/input";
import { runtime } from "@/game/runtime";
import { setDrone } from "@/game/audio";
import { biomeAt } from "@/game/data/world";

export default function Game() {
  const mode = useGame((s) => s.mode);

  useEffect(() => {
    useGame.getState().load();
    populateWorld();
    const unbind = bindInput();
    const save = setInterval(() => {
      if (useGame.getState().started) useGame.getState().save();
    }, 12000);
    const drone = setInterval(() => {
      const m = useGame.getState().mode;
      const b = m === "weft" ? "weft" : biomeAt(runtime.player.x, runtime.player.z);
      const t = runtime.timeOfDay;
      setDrone(b, t < 0.22 || t > 0.78);
    }, 1500);
    return () => {
      unbind();
      clearInterval(save);
      clearInterval(drone);
    };
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#07060c]">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 58, near: 0.12, far: 480, position: [0, 14, 32] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor("#07060c");
        }}
      >
        {mode === "weft" ? (
          <WeftScene />
        ) : (
          <>
            <WorldScene />
            <Player />
            <CreatureField />
          </>
        )}
        <EffectComposer enableNormalPass={false}>
          <Bloom
            intensity={mode === "weft" ? 1.4 : 0.65}
            luminanceThreshold={0.28}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.25} darkness={0.7} />
          <ChromaticAberration offset={[0.0006, 0.0008]} />
        </EffectComposer>
      </Canvas>
      <TitleScreen />
      <HUD />
    </div>
  );
}
