import { useEffect, useState } from 'react';
import type { Step, Walkthrough } from './schema';
import { decodeSteps, type WireStep } from './wire';

/**
 * Split walkthroughs. In site mode, and in a single file too big to carry
 * them, a walkthrough's steps live in a script beside the page, one per module. Scripts rather
 * than JSON, because browsers refuse `fetch` between files opened from disk but run sibling
 * scripts. Each script calls `window.__proofmapWalkthroughs(file, build, { lines, steps })`, with
 * the steps keyed by declaration name and their goals as indices into `lines`
 * (`lean/Proofmap/Package/Wire.lean`). A script whose build id differs from the page's comes
 * from another build and is refused, so stale steps are never shown.
 */

type Entries = Record<string, Step[]>;
interface Payload {
  lines: string[];
  steps: Record<string, WireStep[]>;
}
type Callback = (build: string, payload: Payload) => void;

declare global {
  interface Window {
    __proofmapWalkthroughs?: (file: string, build: string, payload: Payload) => void;
  }
}

export class ChunkError extends Error {}

const callbacks = new Map<string, Callback>();
const loads = new Map<string, Promise<Entries>>();

function install() {
  window.__proofmapWalkthroughs ??= (file, build, entries) => callbacks.get(file)?.(build, entries);
}

/** Loads a chunk script once; later calls share the same promise. */
export function loadChunk(file: string, build: string, timeoutMs = 15000): Promise<Entries> {
  const key = `${file}\n${build}`;
  const known = loads.get(key);
  if (known) return known;
  install();
  const p = new Promise<Entries>((resolve, reject) => {
    const missing = () =>
      new ChunkError(`The walkthrough file ${file} could not be loaded. Keep the data folder next to the page, or rebuild.`);
    const timer = setTimeout(() => reject(missing()), timeoutMs);
    callbacks.set(file, (got, payload) => {
      clearTimeout(timer);
      if (got !== build) reject(new ChunkError('The walkthrough file comes from a different build than this page. Rebuild, or reload the page.'));
      else resolve(Object.fromEntries(Object.entries(payload.steps).map(([name, steps]) => [name, decodeSteps(steps, payload.lines)])));
    });
    const s = document.createElement('script');
    // Over HTTP the build id busts caches; file:// URLs take no query.
    s.src = location.protocol.startsWith('http') ? `${file}?v=${encodeURIComponent(build)}` : file;
    s.onerror = () => {
      clearTimeout(timer);
      reject(missing());
    };
    document.head.append(s);
  });
  loads.set(key, p);
  return p;
}

export type StepsState = { state: 'ready'; steps: Step[] } | { state: 'loading' } | { state: 'error'; message: string };

/** The steps of a walkthrough, loading its chunk when they are not inline. */
export function useWalkthroughSteps(w: Walkthrough | undefined, declName: string): StepsState {
  const inline = w && 'steps' in w ? w.steps : undefined;
  const [loaded, setLoaded] = useState<{ key: string; result: StepsState } | null>(null);
  const key = w && 'file' in w ? `${w.file}\n${w.build}\n${declName}` : '';
  useEffect(() => {
    if (!w || !('file' in w)) return;
    let live = true;
    loadChunk(w.file, w.build).then(
      (entries) => {
        const steps = entries[declName];
        const result: StepsState = steps
          ? { state: 'ready', steps }
          : { state: 'error', message: `The walkthrough file ${w.file} has no steps for ${declName}. Rebuild, or reload the page.` };
        if (live) setLoaded({ key, result });
      },
      (e: unknown) => {
        if (live) setLoaded({ key, result: { state: 'error', message: e instanceof Error ? e.message : String(e) } });
      },
    );
    return () => {
      live = false;
    };
  }, [w, declName, key]);
  if (!w) return { state: 'ready', steps: [] };
  if (inline) return { state: 'ready', steps: inline };
  return loaded?.key === key ? loaded.result : { state: 'loading' };
}
