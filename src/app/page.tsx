"use client";

import dynamic from "next/dynamic";

const Game = dynamic(() => import("@/game/Game"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-[#07060c] text-amber-100/70">
      <div className="text-center">
        <p className="font-[family-name:var(--font-display)] text-3xl">Aetherwake</p>
        <p className="mt-2 text-xs uppercase tracking-[0.35em]">the vale is assembling</p>
      </div>
    </div>
  ),
});

export default function Page() {
  return <Game />;
}
