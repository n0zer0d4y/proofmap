import { describe, expect, it } from 'vitest';
import { startLiveReload, type LiveReloadDeps } from '../src/data/live';

/** A fake server whose build id the test controls, and a manual clock. */
function harness(protocol = 'http:', initial: string | null = 'b1') {
  const state = { build: initial, reloads: 0, tick: null as null | (() => void), requests: 0 };
  const deps: LiveReloadDeps = {
    protocol,
    fetchImpl: async () => {
      state.requests++;
      if (state.build === null) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ build: state.build }), { headers: { 'content-type': 'application/json' } });
    },
    reload: () => state.reloads++,
    setInterval: (fn) => (state.tick = fn),
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { state, deps, settle };
}

describe('live reload', () => {
  it('reloads when the build id changes', async () => {
    const { state, deps, settle } = harness();
    expect(await startLiveReload(2000, deps)).toBe(true);
    state.tick!();
    await settle();
    expect(state.reloads).toBe(0);
    state.build = 'b2';
    state.tick!();
    await settle();
    expect(state.reloads).toBe(1);
  });
  it('does not start on file:// or without the endpoint', async () => {
    const file = harness('file:');
    expect(await startLiveReload(2000, file.deps)).toBe(false);
    expect(file.state.requests).toBe(0);
    const staticHost = harness('https:', null);
    expect(await startLiveReload(2000, staticHost.deps)).toBe(false);
    expect(staticHost.state.tick).toBeNull();
  });
  it('ignores a failed poll', async () => {
    const { state, deps, settle } = harness();
    await startLiveReload(2000, deps);
    state.build = null;
    state.tick!();
    await settle();
    expect(state.reloads).toBe(0);
  });
});
