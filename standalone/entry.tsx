/**
 * REALMS — standalone entry.
 *
 * Mounts the game without Next.js, so `npm run bundle` can emit the whole
 * thing as one self-contained HTML file: no server, no build step for the
 * player, nothing fetched at runtime.
 */

import { createRoot } from 'react-dom/client';
import Realms from '../src/realms/Realms';

// there is no /models/manifest.json to look for in a single-file build
(window as unknown as Record<string, unknown>).__realmsNoManifest = true;

/**
 * When this bundle is embedded in a page whose <head> we do not control — an
 * artifact host, an iframe — the viewport tag it ships with allows pinch-zoom
 * and stops short of the notch. A game that pans the camera with a drag turns
 * every camera move into an accidental page zoom, so fix the tag in place.
 */
const meta = document.querySelector('meta[name="viewport"]')
  ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'viewport' }));
meta.setAttribute(
  'content',
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
);

const host = document.getElementById('realms-root');
if (host) createRoot(host).render(<Realms />);
