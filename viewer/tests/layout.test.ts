import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndexes } from '../src/data/indexes';
import type { ProofmapData } from '../src/data/schema';
import { statusOf } from '../src/data/status';
import { declNodeId, fold } from '../src/graph/fold';
import { downstream, worstStatus } from '../src/graph/propagate';
import { layout, type LayoutNode } from '../src/layout/elk';

const data = JSON.parse(readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
const ix = buildIndexes(data);
const id = (n: string) => ix.byName.get(n)![0]!;
const sized = (ids: string[]): LayoutNode[] => ids.map((i) => ({ id: i, width: 260, height: 96 }));

describe('status propagation', () => {
  it('everything downstream of the sorry is red', () => {
    const down = downstream(ix, id('Fixture.unfinished'));
    expect([...down].map((i) => ix.decls[i]!.name).sort()).toEqual(['Fixture.downstream_of_sorry', 'Fixture.tainted_result']);
    for (const i of down) expect(statusOf(ix.decls[i]!)).toBe('sorry');
  });
  it('everything downstream of the custom axiom is amber or red, and nothing else is', () => {
    const down = downstream(ix, id('Fixture.customAxiom'));
    for (const i of down) expect(['axiom', 'sorry']).toContain(statusOf(ix.decls[i]!));
    expect(statusOf(ix.decls[id('Fixture.main_result')]!)).toBe('ok');
  });
  it('a group card takes the worst status of its members', () => {
    expect(worstStatus(ix, [id('Fixture.main_result'), id('Fixture.uses_custom_axiom')])).toBe('axiom');
    expect(worstStatus(ix, [id('Fixture.uses_custom_axiom'), id('Fixture.unfinished')])).toBe('sorry');
  });
});

describe('layout', () => {
  it('puts dependencies to the left of their users', async () => {
    const main = id('Fixture.main_result');
    const f = fold(ix, { roots: [main], expanded: new Set([main]), expandedGroups: new Set(), showNoise: false, showExternal: true });
    const pos = await layout(sized(f.nodes.map((n) => n.id)), f.edges);
    for (const e of f.edges) expect(pos[e.source]!.x).toBeLessThan(pos[e.target]!.x);
  });

  it('expanding a card keeps placed cards in order and moves them only by layer shifts', async () => {
    const main = id('Fixture.main_result');
    const base = { roots: [main], expandedGroups: new Set<string>(), showNoise: false, showExternal: true };
    const f1 = fold(ix, { ...base, expanded: new Set([main]) });
    const p1 = await layout(sized(f1.nodes.map((n) => n.id)), f1.edges);
    const f2 = fold(ix, { ...base, expanded: new Set([main, id('Fixture.double_mono'), id('Fixture.add_origin')]) });
    const p2 = await layout(sized(f2.nodes.map((n) => n.id)), f2.edges, p1);
    const kept = f1.nodes.map((n) => n.id);
    // Vertical order of the cards that were already there is unchanged.
    const order = (p: typeof p1) => [...kept].sort((a, b) => p[a]!.y - p[b]!.y || p[a]!.x - p[b]!.x);
    expect(order(p2)).toEqual(order(p1));
    // Horizontal moves are whole layers (layer width = card width + layer spacing), never partial.
    const layer = 260 + 90;
    for (const n of kept) {
      const dx = Math.abs(p2[n]!.x - p1[n]!.x);
      expect(Math.abs(dx / layer - Math.round(dx / layer))).toBeLessThan(0.05);
    }
    expect(p2[declNodeId(main)]).toBeDefined();
  });

  it('lays out 300 cards within the budget (≤ 500 ms)', async () => {
    const n = 300;
    const nodes = sized(Array.from({ length: n }, (_, i) => `n${i}`));
    const edges = Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, source: `n${i + 1}`, target: `n${Math.floor(i / 3)}` }));
    for (let k = 0; k < 3; k++) await layout(nodes, edges); // warm up the JIT
    const t = performance.now();
    await layout(nodes, edges);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
