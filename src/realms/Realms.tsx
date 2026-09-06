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

  const onStart = useCallback(() => {
    // On a phone the browser chrome costs a third of the height of a landscape
    // window, and this tap is the one user gesture that can buy it back. Both
    // calls are best-effort: desktop ignores the orientation lock, and an
    // embedded frame may refuse fullscreen outright. Neither is worth an error.
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      try {
        const r = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
        void Promise.resolve(r)
          .then(() => (screen.orientation as { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
          .catch(() => {});
      } catch { /* not permitted here; the game plays fine windowed */ }
    }
    void gameRef.current?.begin();
  }, []);
  const onPress = useCallback((name: string, down: boolean) => { gameRef.current?.press(name, down); }, []);
  const onResume = useCallback(() => { gameRef.current?.resume(); }, []);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', inset: 0, background: '#04060a', overflow: 'hidden' }}
    >
      <Hud onResume={onResume} onPress={onPress} />
      <TitleScreen onStart={onStart} />
      <LoadingScreen />
      <TouchControls onPress={onPress} />
    </div>
  );
}
