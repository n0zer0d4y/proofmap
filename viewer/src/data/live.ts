/**
 * Live reload in serve mode. `proofmap serve` answers
 * `__proofmap/version` with `{"build": "<id>"}`; the id changes whenever the page or its data is
 * rewritten. The page polls it every 2 s and reloads on change (the URL hash keeps the view).
 * `proofmap serve` listens on 127.0.0.1 only, so a page opened as a file or from any other host
 * (a static site) never asks, and logs no failed request.
 */

export interface LiveReloadDeps {
  fetchImpl: (url: string) => Promise<Response>;
  reload: () => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  protocol: string;
  hostname: string;
}

const defaults = (): LiveReloadDeps => ({
  fetchImpl: (url) => fetch(url, { cache: 'no-store' }),
  reload: () => location.reload(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  protocol: location.protocol,
  hostname: location.hostname,
});

/** The project folder `proofmap serve` reported (it runs on this computer), for source links. */
let servedRoot: string | null = null;
export const liveProjectRoot = () => servedRoot;

async function buildId(deps: LiveReloadDeps): Promise<string | null> {
  try {
    const res = await deps.fetchImpl('__proofmap/version');
    if (!res.ok || !res.headers.get('content-type')?.startsWith('application/json')) return null;
    const body = (await res.json()) as { build?: unknown; root?: unknown };
    if (typeof body.root === 'string') servedRoot = body.root;
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  }
}

/** Resolves to true when polling started (the page is served by `proofmap serve`). */
export async function startLiveReload(intervalMs = 2000, deps: LiveReloadDeps = defaults()): Promise<boolean> {
  if (deps.protocol !== 'http:' && deps.protocol !== 'https:') return false;
  if (deps.hostname !== '127.0.0.1' && deps.hostname !== 'localhost') return false;
  const first = await buildId(deps);
  if (first === null) return false;
  let busy = false;
  deps.setInterval(() => {
    if (busy) return;
    busy = true;
    void buildId(deps).then((id) => {
      busy = false;
      // A failed poll (server restarting, build mid-write) is ignored; the next one decides.
      if (id !== null && id !== first) deps.reload();
    });
  }, intervalMs);
  return true;
}
