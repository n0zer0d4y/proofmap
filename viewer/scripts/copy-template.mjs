// Copies the single-file build to lean/assets/viewer.html, the template the Lean executable
// embeds with include_str. Fails if the data placeholder is missing.
import { copyFile, mkdir, readFile } from 'node:fs/promises';

const src = new URL('../dist/index.html', import.meta.url);
const dest = new URL('../../lean/assets/viewer.html', import.meta.url);
const html = await readFile(src, 'utf8');
if (html.split('/*PROOFMAP_DATA*/').length !== 2) throw new Error('viewer build lost the data placeholder');
// Everything is inline: a `src`/`href` may only hold a data: URI (the favicon), never a file or URL.
if (/<script[^>]+src=(?!["']data:)|<link[^>]+href=(?!["']data:)/i.test(html)) throw new Error('viewer build references external files');
await mkdir(new URL('../../lean/assets/', import.meta.url), { recursive: true });
await copyFile(src, dest);
console.log(`copied template to lean/assets/viewer.html (${(html.length / 1024).toFixed(0)} kB)`);
