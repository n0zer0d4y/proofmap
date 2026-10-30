import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndexes } from '../src/data/indexes';
import type { ProofmapData } from '../src/data/schema';
import { computeHealth } from '../src/graph/health';
import { outlineChildren, outlineRows, tourSteps } from '../src/graph/outline';
import { findPaths } from '../src/graph/paths';

const data = JSON.parse(readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
const ix = buildIndexes(data);
const id = (n: string) => ix.byName.get(n)![0]!;
const name = (i: number) => ix.decls[i]!.name;

describe('outline', () => {
  it('children follow reduced project dependencies, proof first', () => {
    expect(outlineChildren(ix, id('Fixture.main_result')).map(name)).toEqual(
      expect.arrayContaining(['Fixture.double_double', 'Fixture.add_origin', 'Fixture.double_mono']),
    );
  });
  it('shows a shared result in full once, then as "also used here"', () => {
    const main = id('Fixture.main_result');
    const rows = outlineRows(ix, [main], new Set([main, id('Fixture.double_double'), id('Fixture.double_mono')]));
    const eqAdd = rows.filter((r) => r.id === id('Fixture.double_eq_add'));
    expect(eqAdd.length).toBe(2);
    expect(eqAdd.map((r) => r.first)).toEqual([true, false]);
  });
});

describe('guided tour', () => {
  it('visits every root, each followed by its outline in order', () => {
    const roots = data.project.roots;
    const steps = tourSteps(ix, roots);
    // Each root appears, in root order.
    const rootPositions = roots.map((r) => steps.indexOf(r));
    expect(rootPositions.every((p) => p >= 0)).toBe(true);
    expect([...rootPositions].sort((a, b) => a - b)).toEqual(rootPositions);
    // Right after the first root come its outline children (those not seen before), in order.
    const kids = outlineChildren(ix, roots[0]!);
    const after = steps.slice(1).filter((s) => kids.includes(s));
    expect(after).toEqual(kids.filter((k) => steps.indexOf(k) > 0));
    expect(new Set(steps).size).toBe(steps.length);
  });
});

describe('path finder', () => {
  /** Brute force: every simple path along "is used by", with no pruning at all. */
  function brute(from: number, to: number, maxLength = 8): string[] {
    const out: string[] = [];
    const walk = (path: number[]) => {
      const v = path[path.length - 1]!;
      if (v === to) {
        out.push(path.map(name).join(' > '));
        return;
      }
      if (path.length > maxLength) return;
      for (const u of new Set([...ix.usedBy.statement[v]!, ...ix.usedBy.proof[v]!])) if (!path.includes(u)) walk([...path, u]);
    };
    walk([from]);
    return out.sort();
  }
  const pairs: Array<[string, string]> = [
    ['Fixture.double', 'Fixture.main_result'],
    ['Fixture.double_eq_add', 'Fixture.main_result'],
    ['Fixture.customAxiom', 'Fixture.tainted_result'],
    ['Fixture.Point', 'Fixture.main_result'],
    ['Fixture.double', 'Fixture.tainted_result'],
    ['Fixture.main_result', 'Fixture.double'],
  ];
  for (const [a, b] of pairs)
    it(`matches brute force: ${a} → ${b}`, () => {
      expect(findPaths(ix, id(a), id(b)).map((p) => p.map(name).join(' > ')).sort()).toEqual(brute(id(a), id(b)));
    });
  it('sorts shortest first', () => {
    const p = findPaths(ix, id('Fixture.double'), id('Fixture.main_result'));
    expect(p[0]!.length).toBe(Math.min(...p.map((x) => x.length)));
  });
});

describe('health', () => {
  const h = computeHealth(ix);
  // Independent counts straight from the JSON.
  const visible = data.decls.filter((d) => !d.external && !d.flags.some((f) => f.startsWith('noise:')));
  it('counts match the extractor data', () => {
    expect(h.total).toBe(visible.length);
    expect(h.sorry).toBe(visible.filter((d) => d.status.sorry).length);
    expect(h.nonstandard).toBe(visible.filter((d) => d.status.nonstandardAxioms.length > 0).length);
    expect(h.deprecated).toBe(visible.filter((d) => d.flags.includes('deprecated')).length);
    expect(h.proved).toBe(visible.filter((d) => !d.status.sorry && d.status.nonstandardAxioms.length === 0).length);
  });
  it('finds the sorry source and what rests on it', () => {
    expect(h.sorrySources.map((s) => [name(s.id), s.downstream])).toEqual([['Fixture.unfinished', 2]]);
  });
  it('counts axiom usage', () => {
    const custom = h.axioms.find((a) => a.name === 'Fixture.customAxiom')!;
    expect(custom.count).toBe(visible.filter((d) => d.status.axioms.includes('Fixture.customAxiom')).length);
    expect(custom.standard).toBe(false);
    expect(h.axioms.find((a) => a.name === 'propext')!.standard).toBe(true);
  });
  it('lists unused declarations (not roots or main results)', () => {
    const unused = h.unused.map(name);
    expect(unused).toContain('Fixture.classical_fact');
    expect(unused).not.toContain('Fixture.main_result');
    expect(unused).not.toContain('Fixture.double');
  });
  it('counts generated declarations and leaves them out of the unused list', () => {
    expect(h.generated).toBe(0);
    // The fixture has none, so mark an unused one as generated (no source range).
    const target = id('Fixture.classical_fact');
    const marked: ProofmapData = {
      ...data,
      decls: data.decls.map((d) => (d.id === target ? { ...d, range: null, flags: ['noise:generated'] } : d)),
    };
    const hm = computeHealth(buildIndexes(marked));
    expect(hm.generated).toBe(1);
    expect(hm.unused.map(name)).not.toContain('Fixture.classical_fact');
    expect(hm.total).toBe(h.total - 1);
  });
  it('orders the largest proofs', () => {
    const lines = h.largestByLines.map((i) => ix.decls[i]!.size.lines);
    expect([...lines].sort((a, b) => b - a)).toEqual(lines);
  });
});
