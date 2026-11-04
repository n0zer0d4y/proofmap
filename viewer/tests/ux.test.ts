import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { projectFolder } from '../src/components/links';
import { headLength } from '../src/components/Statement';
import { buildIndexes, type Indexes } from '../src/data/indexes';
import { libraryOf, plainText } from '../src/data/library';
import type { ProofmapData } from '../src/data/schema';
import { outlineChildren, outlinePathTo, outlineRows } from '../src/graph/outline';
import { findPaths } from '../src/graph/paths';
import { PRESET_DEFAULTS } from '../src/state/presets';
import { useStore } from '../src/state/store';
import { nextRing } from '../src/views/MapView';

const data = JSON.parse(readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
const ix = buildIndexes(data);
const id = (n: string) => ix.byName.get(n)![0]!;

describe('store: navigation', () => {
  beforeEach(() => useStore.setState({ view: 'map', focus: null, walkthrough: false, tour: null, highlight: [], anchor: null }));

  it('choosing a view leaves an open walkthrough', () => {
    useStore.setState({ focus: id('Fixture.add_origin'), walkthrough: true });
    useStore.getState().setView('outline');
    expect(useStore.getState().walkthrough).toBe(false);
    expect(useStore.getState().view).toBe('outline');
  });

  it('a tour step switches to the map and leaves the walkthrough', () => {
    useStore.setState({ view: 'health', focus: id('Fixture.add_origin'), walkthrough: true });
    useStore.getState().tourGo(1, [id('Fixture.main_result'), id('Fixture.add_origin')]);
    const s = useStore.getState();
    expect(s.view).toBe('map');
    expect(s.walkthrough).toBe(false);
    expect(s.focus).toBe(id('Fixture.add_origin'));
  });

  it('a preset changes what is shown, not the view', () => {
    useStore.setState({ view: 'map' });
    useStore.getState().setPreset('auditor');
    expect(useStore.getState().view).toBe('map');
    expect(useStore.getState().showCore).toBe(PRESET_DEFAULTS.auditor.showCore);
  });

  it('re-anchoring clears a highlighted chain', () => {
    useStore.setState({ highlight: [1, 2, 3] });
    useStore.getState().setAnchor(id('Fixture.double'));
    expect(useStore.getState().highlight).toEqual([]);
  });

  it('selecting clears a missing-link message', () => {
    useStore.setState({ missingKey: 'Gone.lemma' });
    useStore.getState().select(id('Fixture.double'));
    expect(useStore.getState().missingKey).toBeNull();
  });
});

describe('outline', () => {
  const roots = data.project.roots;
  it('finds the rows to open to reveal a deep result', () => {
    // Every project declaration below a root: opening the path shows it.
    const deep = [...new Set(roots.flatMap((r) => outlineChildren(ix, r).flatMap((k) => outlineChildren(ix, k))))].filter((i) => !roots.includes(i));
    expect(deep.length).toBeGreaterThan(0);
    for (const target of deep) {
      const path = outlinePathTo(ix, roots, target)!;
      expect(path).not.toBeNull();
      const rows = outlineRows(ix, roots, new Set(path));
      expect(rows.some((r) => r.id === target)).toBe(true);
    }
  });
  it('lists theorems before definitions within a step', () => {
    for (const r of roots) {
      const kids = outlineChildren(ix, r);
      const key = (i: number) => `${ix.decls[i]!.step ?? ''}`;
      for (let k = 1; k < kids.length; k++) {
        const a = ix.decls[kids[k - 1]!]!, b = ix.decls[kids[k]!]!;
        if (key(kids[k - 1]!) === key(kids[k]!)) expect(a.kind !== 'theorem' && b.kind === 'theorem').toBe(false);
      }
    }
  });
});

describe('show more', () => {
  it('opens the selection first, then one ring at a time, then nothing', () => {
    const main = id('Fixture.main_result');
    let expanded = new Set<number>();
    expect(nextRing(ix, main, expanded)).toEqual([main]);
    expanded = new Set([main]);
    const ring = nextRing(ix, main, expanded);
    expect(ring.length).toBeLessThanOrEqual(8);
    expect(ring.every((r) => outlineChildren(ix, main).includes(r) || !expanded.has(r))).toBe(true);
    let guard = 0;
    while (nextRing(ix, main, expanded).length && guard++ < 50) expanded = new Set([...expanded, ...nextRing(ix, main, expanded)]);
    expect(nextRing(ix, main, expanded)).toEqual([]);
  });
});

describe('path finder', () => {
  /** A synthetic graph: `to` uses `from` directly, and also through many long detours that a
   * depth-first search meets first. */
  function graph(detours: number): { ix: Indexes; from: number; to: number } {
    const n = 2 + detours * 3;
    const decls = Array.from({ length: n }, (_, i) => ({ id: i, deps: { statement: [] as number[], proof: [] as number[] } }));
    const from = 0, to = 1;
    for (let k = 0; k < detours; k++) {
      const a = 2 + k * 3, b = a + 1, c = a + 2;
      decls[to]!.deps.proof.push(a);
      decls[a]!.deps.proof.push(b);
      decls[b]!.deps.proof.push(c);
      decls[c]!.deps.proof.push(from);
    }
    decls[to]!.deps.proof.push(from);
    const usedBy = { statement: decls.map(() => [] as number[]), proof: decls.map(() => [] as number[]) };
    for (const d of decls) for (const t of d.deps.proof) usedBy.proof[t]!.push(d.id);
    return { ix: { decls, usedBy } as unknown as Indexes, from, to };
  }
  it('always finds the shortest chain, even past the limit', () => {
    const g = graph(30);
    const paths = findPaths(g.ix, g.from, g.to, 8, 5);
    expect(paths[0]).toEqual([g.from, g.to]);
    expect(paths.length).toBe(5);
    expect(paths.map((p) => p.length)).toEqual([...paths.map((p) => p.length)].sort((a, b) => a - b));
  });
});

describe('search', () => {
  it('finds words inside Markdown and hyphenated phrases', () => {
    const tainted = ix.search('tainted').map((h) => h.name);
    expect(tainted).toContain('Fixture.tainted_result');
    expect(ix.search('double-double').map((h) => h.name)).toContain('Fixture.double_double');
  });
  it('ranks main results and project declarations before other libraries', () => {
    const hits = ix.search('double');
    const firstExternal = hits.findIndex((h) => ix.decls[h.id]!.external);
    const lastProject = hits.map((h) => !ix.decls[h.id]!.external).lastIndexOf(true);
    if (firstExternal >= 0) expect(lastProject).toBeLessThan(firstExternal);
  });
});

describe('text helpers', () => {
  it('names libraries, with Lean core together', () => {
    expect(libraryOf('Mathlib.Data.Nat.Basic')).toBe('Mathlib');
    expect(libraryOf('Init.Prelude')).toBe('Lean core');
    expect(libraryOf('Lean.Elab')).toBe('Lean core');
    expect(libraryOf(null)).toBe('Other');
  });
  it('removes inline Markdown', () => {
    expect(plainText('`PolyFin` rebuild of **the** verifier')).toBe('PolyFin rebuild of the verifier');
    expect(plainText('see [docs](https://x.y) and *this*')).toBe('see docs and this');
  });
  it('finds the head of a signature, universes included', () => {
    const cps = (s: string) => Array.from(s);
    expect(headLength(cps('Even.{u_2} {α : Type u_2} : Prop'))).toBe('Even.{u_2} '.length);
    expect(headLength(cps('Nat.sum_four_squares (n : ℕ) : ∃ a b c d, a ^ 2 + b ^ 2 + c ^ 2 + d ^ 2 = n'))).toBe('Nat.sum_four_squares '.length);
    expect(headLength(cps('Foo.«weird name» (x : ℕ) : x = x'))).toBe('Foo.«weird name» '.length);
  });
});

describe('source links without absolute paths', () => {
  const withRel = (rel: string | null) => buildIndexes({ ...data, project: { ...data.project, pageToRoot: rel } });
  it('finds the project folder from the page location', () => {
    expect(projectFolder(withRel(''), { protocol: 'file:', pathname: '/C:/Users/me/proj/proofmap.html' })).toBe('C:/Users/me/proj');
    expect(projectFolder(withRel('..'), { protocol: 'file:', pathname: '/home/me/proj/docs/map.html' })).toBe('/home/me/proj');
    expect(projectFolder(withRel('../proj'), { protocol: 'file:', pathname: '/home/me/out/map.html' })).toBe('/home/me/proj');
  });
  it('has no folder for a page without one, or on a web host', () => {
    expect(projectFolder(withRel(null), { protocol: 'file:', pathname: '/x/p.html' })).toBeNull();
    expect(projectFolder(withRel(''), { protocol: 'https:', pathname: '/site/index.html' })).toBeNull();
  });
  it('never puts an absolute path into the data', () => {
    expect(JSON.stringify(data.project)).not.toMatch(/rootDir/);
  });
});
