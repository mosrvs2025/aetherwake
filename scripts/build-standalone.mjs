/**
 * Build REALMS as one self-contained HTML file.
 *
 *   node scripts/build-standalone.mjs           -> dist/realms.html   (full page)
 *   node scripts/build-standalone.mjs --fragment -> dist/realms.fragment.html
 *
 * Everything is inlined: the game, three.js, React, the stylesheet. The only
 * external reference is the Google Fonts link, and the page falls back to a
 * real stack without it. There is nothing to serve and nothing to fetch, which
 * is the whole point — the world is generated in code, so a single file is a
 * complete game.
 */

import * as esbuild from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fragmentOnly = process.argv.includes('--fragment');

async function buildCss() {
  const src = await readFile(path.join(root, 'src/app/globals.css'), 'utf8');
  const result = await postcss([tailwind()]).process(src, {
    from: path.join(root, 'src/app/globals.css'),
    to: undefined,
  });
  return result.css;
}

async function buildJs() {
  const out = await esbuild.build({
    entryPoints: [path.join(root, 'standalone/entry.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    write: false,
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });
  return out.outputFiles[0].text;
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap';

function page({ css, js, fragment }) {
  const body = `<title>REALMS — The Sundered Shelf</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}
:root { --font-display: 'Cinzel'; --font-sans: 'Outfit'; }
html, body { margin: 0; height: 100%; background: #04060a; overflow: hidden; }
#realms-root { position: fixed; inset: 0; }
.realms-boot {
  position: fixed; inset: 0; display: grid; place-items: center;
  background: #04060a; color: #f2ecdf;
  font-family: 'Cinzel', Georgia, serif; letter-spacing: 0.42em;
  font-size: 30px; text-indent: 0.42em;
}
</style>
<div id="realms-root"><div class="realms-boot">REALMS</div></div>
<script>${js}</script>`;
  if (fragment) return body;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="A third-person fantasy action RPG that runs in a browser tab. Nothing is downloaded: the world is generated in code.">
${body}
</head>
<body></body>
</html>`;
}

const [css, js] = await Promise.all([buildCss(), buildJs()]);
await mkdir(path.join(root, 'dist'), { recursive: true });

const target = fragmentOnly ? 'dist/realms.fragment.html' : 'dist/realms.html';
const html = page({ css, js, fragment: fragmentOnly });
await writeFile(path.join(root, target), html);
console.log(`${target}  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB  (js ${(js.length / 1048576).toFixed(2)} MB, css ${(css.length / 1024).toFixed(0)} kB)`);
