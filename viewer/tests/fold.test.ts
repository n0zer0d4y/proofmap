import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndexes } from '../src/data/indexes';
import type { Decl, ProofmapData } from '../src/data/schema';
import { declNodeId, externalArea, fold } from '../src/graph/fold';
import { reduceDeps } from '../src/graph/reduce';

/** A minimal declaration for synthetic graphs. */
function decl(id: number, statement: number[] = [], proof: number[] = [], extra: Partial<Decl> = {}): Decl {
  return {
    id, name: `D${id}`, title: `D${id}`, kind: 'theorem', module: 'M', external: false, range: null,
    sectionPath: [], signature: '', signatureHover: [], summary: null, docstring: null, leadingComment: null,
    code: null, flags: [], status: { sorry: false, axioms: [], nonstandardAxioms: [] },
    deps: { statement, proof }, directDeps: { statement, proof }, size: { lines: 1, exprNodes: 1 },
    rank: 'lemma', step: null, tags: {}, walkthrough: null, ...extra,
  };
}

const synthetic = (decls: Decl[]): ProofmapData => ({
  schema: 2,
  generator: { name: 'proofmap', version: '0', lean: '0' },
  project: { title: 't', rootModules: ['M'], builtAt: '', roots: [0] },
  modules: [{ name: 'M', path: null, imports: [], doc: null, sections: [] }],
  decls,
  walkthroughs: [],
  glossary: {},
});

describe('reduceDeps (synthetic)', () => {
  // 0 uses 1, 2, 3; 1 uses 3 (so 0 -> 3 is redundant); 2 uses nothing.
  const decls = [decl(0, [], [1, 2, 3]), decl(1, [], [3]), decl(2), decl(3)];
  it('drops dependencies reachable through another dependency', () => {
    expect(reduceDeps(decls, [1, 2, 3], 'proof')).toEqual([1, 2]);
  });
  it('statement reduction only follows statement edges', () => {
    // Arrays are indexed by id. 1 uses 2 in its proof only: no statement path, both kept.
    const d = [decl(0, [1, 2]), decl(1, [], [2]), decl(2)];
    expect(reduceDeps(d, [1, 2], 'statement')).toEqual([1, 2]);
    const e = [decl(0, [1, 2]), decl(1, [2]), decl(2)];
    expect(reduceDeps(e, [1, 2], 'statement')).toEqual([1]);
  });
  it('keeps a lone dependency', () => {
    expect(reduceDeps(decls, [3], 'proof')).toEqual([3]);
  });
});

describe('fold (synthetic)', () => {
  it('groups more than maxDirect dependencies and opens groups on request', () => {
    const many = Array.from({ length: 12 }, (_, i) => i + 1);
    const decls = [decl(0, [], many), ...many.map((i) => decl(i, [], [], { step: i <= 6 ? 'A' : 'B' }))];
    const ix = buildIndexes(synthetic(decls));
    const base = { roots: [0], expanded: new Set([0]), expandedGroups: new Set<string>(), showNoise: false, showExternal: true };
    const f = fold(ix, base);
    expect(f.nodes.filter((n) => n.kind === 'group').map((n) => [n.label, n.members!.length])).toEqual([
      ['A', 6],
      ['B', 6],
    ]);
    const opened = fold(ix, { ...base, expandedGroups: new Set(['grp:0:A']) });
    expect(opened.nodes.filter((n) => n.kind === 'decl')).toHaveLength(1 + 6);
  });

  it('marks edges routed through hidden noise (dotted)', () => {
    // 0 uses 1 only through the hidden helper 2 (a generated `_proof_1`).
    const decls = [
      decl(0, [], [1], { directDeps: { statement: [], proof: [2] } }),
      decl(1),
      decl(2, [], [1], { flags: ['noise:internal'] }),
    ];
    const ix = buildIndexes(synthetic(decls));
    const f = fold(ix, { roots: [0], expanded: new Set([0]), expandedGroups: new Set(), showNoise: false, showExternal: true });
    expect(f.edges).toEqual([{ id: 'd1->d0', source: 'd1', target: 'd0', kind: 'proof', viaNoise: true }]);
    const shown = fold(ix, { roots: [0], expanded: new Set([0]), expandedGroups: new Set(), showNoise: true, showExternal: true });
    expect(shown.edges.map((e) => e.id)).toEqual(['d2->d0']);
  });

  it('caps the number of visible cards', () => {
    const many = Array.from({ length: 40 }, (_, i) => i + 1);
    const decls = [decl(0, [], many), ...many.map((i) => decl(i, [], [], { step: `S${i}` }))];
    const ix = buildIndexes(synthetic(decls));
    const f = fold(ix, { roots: [0], expanded: new Set([0]), expandedGroups: new Set(), showNoise: false, showExternal: true, maxDirect: 100, cap: 10 });
    expect(f.nodes.filter((n) => n.kind === 'decl').length).toBeLessThanOrEqual(41);
    expect(fold(ix, { roots: [0], expanded: new Set([0]), expandedGroups: new Set(), showNoise: false, showExternal: true, maxDirect: 100, cap: 200 }).nodes).toHaveLength(41);
  });
});

describe('fold (fixture)', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
  const ix = buildIndexes(data);
  const id = (n: string) => ix.byName.get(n)![0]!;
  const names = (ids: string[]) => ids.map((nid) => ix.decls[Number(nid.slice(1))]!.name).sort();

  it('shows the focus and its reduced direct dependencies, externals aggregated', () => {
    const main = id('Fixture.main_result');
    const f = fold(ix, { roots: [main], expanded: new Set([main]), expandedGroups: new Set(), showNoise: false, showExternal: true });
    const target = declNodeId(main);
    const into = f.edges.filter((e) => e.target === target);
    const deps = into.filter((e) => e.source.startsWith('d')).map((e) => e.source);
    // Point is mentioned by Point.origin's own statement, so main_result -> Point is redundant.
    expect(names(deps)).toEqual(['Fixture.Point.origin', 'Fixture.add_origin', 'Fixture.double', 'Fixture.double_double', 'Fixture.double_mono'].sort());
    expect(into.find((e) => e.source === declNodeId(id('Fixture.double_double')))!.kind).toBe('proof');
    expect(into.find((e) => e.source === declNodeId(id('Fixture.double')))!.kind).toBe('statement');
    const ext = f.nodes.filter((n) => n.kind === 'external').map((n) => n.label);
    expect(ext.length).toBeGreaterThan(0);
    expect(f.nodes.every((n) => n.kind !== 'decl' || !ix.decls[n.decl!]!.external)).toBe(true);
  });

  it('hides externals when asked, and shows noise only when asked', () => {
    const main = id('Fixture.main_result');
    const noExt = fold(ix, { roots: [main], expanded: new Set([main]), expandedGroups: new Set(), showNoise: false, showExternal: false });
    expect(noExt.nodes.some((n) => n.kind === 'external')).toBe(false);
    const addOrigin = id('Fixture.add_origin');
    const hidden = fold(ix, { roots: [addOrigin], expanded: new Set([addOrigin]), expandedGroups: new Set(), showNoise: false, showExternal: false });
    expect(hidden.nodes.some((n) => n.decl === id('Fixture.instAddPoint'))).toBe(false);
    const shown = fold(ix, { roots: [addOrigin], expanded: new Set([addOrigin]), expandedGroups: new Set(), showNoise: true, showExternal: false });
    expect(shown.nodes.some((n) => n.decl === id('Fixture.instAddPoint'))).toBe(true);
  });

  it('marks direct edges as not routed through noise', () => {
    const colorOf = id('Fixture.colorOf');
    const f = fold(ix, { roots: [colorOf], expanded: new Set([colorOf]), expandedGroups: new Set(), showNoise: false, showExternal: false });
    const red = f.edges.find((e) => e.source === declNodeId(id('Fixture.Color.red')))!;
    expect(red.viaNoise).toBe(false);
  });

  it('opens boundary cards into individual external cards', () => {
    const main = id('Fixture.main_result');
    const base = { roots: [main], expanded: new Set([main]), expandedGroups: new Set<string>(), showNoise: false, showExternal: true };
    const area = fold(ix, base).nodes.find((n) => n.kind === 'external')!;
    const opened = fold(ix, { ...base, expandedGroups: new Set([area.id]) });
    expect(opened.nodes.some((n) => n.id === area.id)).toBe(false);
    expect(opened.nodes.filter((n) => n.kind === 'decl' && ix.decls[n.decl!]!.external).length).toBe(area.members!.length);
  });

  it('names library cards by library, with Lean core together', () => {
    expect(externalArea('Mathlib.Data.List.Basic')).toBe('Mathlib');
    expect(externalArea('Init.Prelude')).toBe('Lean core');
    expect(externalArea('Std.Data.HashMap')).toBe('Lean core');
    expect(externalArea(null)).toBe('Other');
  });

  it('leaves Lean core out when asked', () => {
    const main = id('Fixture.main_result');
    const base = { roots: [main], expanded: new Set([main]), expandedGroups: new Set<string>(), showNoise: false, showExternal: true };
    expect(fold(ix, base).nodes.some((n) => n.id === 'ext:Lean core')).toBe(true);
    expect(fold(ix, { ...base, showCore: false }).nodes.some((n) => n.kind === 'external')).toBe(false);
  });
});
