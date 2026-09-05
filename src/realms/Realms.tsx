'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Hud, LoadingScreen, TitleScreen, TouchControls } from './ui/Hud';
import { useRealms } from './game/state';

type GameHandle = {
  begin: () => Promise<void>;
  dispose: () => void;
  press: (name: string, down: boolean) => void;
  resume: () => void;
};

export default function Realms() {
  const ref = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameHandle | null>(null);

  useEffect(() => {
    const host = ref.current as (HTMLDivElement & { __realmsBooted?: boolean }) | null;
    if (!host || host.__realmsBooted) return;
    host.__realmsBooted = true;

    let disposed = false;
    let dispose: (() => void) | null = null;

    (async () => {
      try {
        const { boot } = await import('./game/boot');
        if (disposed) return;
        const handle = await boot(host);
        gameRef.current = handle;
        dispose = handle.dispose;
      } catch (err) {
        console.error('[realms] boot failed', err);
        useRealms.getState().set({ loadingLabel: 'Something broke while building the world.' });
      }
    })();

    return () => {
      disposed = true;
      dispose?.();
      host.__realmsBooted = false;
      gameRef.current = null;
    };
  }, []);

  const onStart = useCallback(() => { void gameRef.current?.begin(); }, []);
  const onPress = useCallback((name: string, down: boolean) => { gameRef.current?.press(name, down); }, []);
  const onResume = useCallback(() => { gameRef.current?.resume(); }, []);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', inset: 0, background: '#04060a', overflow: 'hidden' }}
    >
      <Hud onResume={onResume} />
      <TitleScreen onStart={onStart} />
      <LoadingScreen />
      <TouchControls onPress={onPress} />
    </div>
  );
}
