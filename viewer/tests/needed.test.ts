import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndexes } from '../src/data/indexes';
import type { ProofmapData } from '../src/data/schema';
import { mainResultsNeeding } from '../src/graph/needed';

// "Needed for N of M main results" in the details panel.

const data = JSON.parse(readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8')) as ProofmapData;
const ix = buildIndexes(data);
const id = (name: string) => data.decls.findIndex((d) => d.name === name);
const names = (decl: string) => mainResultsNeeding(ix, id(decl)).map((r) => data.decls[r]!.name).sort();

describe('main results needing a declaration', () => {
  it('counts every main result that rests on it, directly or further down', () => {
    // Double is used by the main result's chain and by the tainted result's.
    expect(names('Fixture.double')).toEqual(['Fixture.main_result', 'Fixture.tainted_result']);
    expect(names('Fixture.double_eq_add')).toEqual(['Fixture.main_result']);
    expect(names('Fixture.Color.red')).toEqual(['Fixture.colorOf_zero']);
  });
  it('counts no main result for a declaration that none rests on', () => {
    const offMainLine = data.decls.find((d) => !d.external && !data.project.roots.includes(d.id) && !mainResultsNeeding(ix, d.id).length);
    expect(offMainLine).toBeDefined();
  });
  it('does not count a main result as needed for itself', () => {
    for (const r of data.project.roots) expect(mainResultsNeeding(ix, r)).not.toContain(r);
  });
});
