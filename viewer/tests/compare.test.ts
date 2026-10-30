import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProofmapData } from '../src/data/schema';
import { compare } from '../src/graph/compare';

// Same snapshots and expectations as lean/test/check-compare.mjs, so the viewer and
// `proofmap compare` agree.
const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as ProofmapData;
const old = load('compare-old.json');
const cur = load('compare-new.json');

describe('compare', () => {
  const c = compare(old, cur);
  const name = (id: number) => cur.decls[id]!.name;
  it('finds the planted additions, removals and changes', () => {
    expect(c.added.map(name)).toEqual(['Fixture.double_three']);
    expect(c.removed.map((r) => r.name)).toEqual(['Fixture.classical_fact']);
    expect(c.changed.map((x) => `${name(x.id)} (${x.what.join(', ')})`).sort()).toEqual([
      'Fixture.downstream_of_sorry (status)',
      'Fixture.hiddenHelper_pos (code, dependencies)',
      'Fixture.tainted_result (status)',
      'Fixture.unfinished (code, status, dependencies)',
    ]);
  });
  it('reports the status deltas', () => {
    expect(c.nowSorryFree.map(name).sort()).toEqual(['Fixture.downstream_of_sorry', 'Fixture.tainted_result', 'Fixture.unfinished']);
    expect(c.nowSorry).toEqual([]);
    expect(c.newAxioms).toEqual([]);
  });
  it('a snapshot compared with itself has no changes', () => {
    const same = compare(cur, cur);
    expect([same.added.length, same.removed.length, same.changed.length]).toEqual([0, 0, 0]);
  });
});
