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

const host = document.getElementById('realms-root');
if (host) createRoot(host).render(<Realms />);
