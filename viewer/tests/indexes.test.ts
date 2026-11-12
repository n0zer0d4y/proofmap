import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndexes, twinModule } from '../src/data/indexes';
import { loadData } from '../src/data/load';
import type { ProofmapData } from '../src/data/schema';

const data = JSON.parse(
  readFileSync(new URL('./fixtures/fixture.json', import.meta.url), 'utf8'),
) as ProofmapData;
const ix = buildIndexes(data);
const id = (name: string) => ix.byName.get(name)![0]!;

describe('indexes (fixture)', () => {
  it('looks declarations up by name, including clashing names', () => {
    expect(ix.decls[id('Fixture.main_result')]!.kind).toBe('theorem');
    expect(ix.byName.get('ClashDemo.value')).toHaveLength(2);
  });

  it('gives the module only for a name another declaration shares', () => {
    const [a, b] = ix.byName.get('ClashDemo.value')!;
    expect([twinModule(ix, a!), twinModule(ix, b!)].sort()).toEqual(['Fixture.Clash.A', 'Fixture.Clash.B']);
    expect(twinModule(ix, id('Fixture.main_result'))).toBeNull();
  });

  it('builds reverse dependencies', () => {
    const usedByProof = ix.usedBy.proof[id('Fixture.double_double')]!.map((i) => ix.decls[i]!.name);
    expect(usedByProof).toContain('Fixture.main_result');
    expect(ix.usedBy.statement[id('Fixture.main_result')]).toEqual([]);
    expect(ix.usedBy.proof[id('Fixture.main_result')]).toEqual([]);
  });

  it('separates visible declarations from noise and externals', () => {
    expect(ix.visible).toContain(id('Fixture.double'));
    expect(ix.visible).not.toContain(id('Fixture.Point.mk'));
    expect(ix.isNoise(id('Fixture.Point.mk'))).toBe(true);
    expect(ix.visible.every((i) => !ix.decls[i]!.external)).toBe(true);
    expect(ix.byModule.get('Fixture.Status')).toContain(id('Fixture.unfinished'));
  });

  it('searches names, titles and summaries', () => {
    expect(ix.search('double_eq_add')[0]?.name).toBe('Fixture.double_eq_add');
    expect(ix.search('main result').map((h) => h.name)).toContain('Fixture.main_result');
    expect(ix.search('colour').map((h) => h.name)).toContain('Fixture.Color');
    expect(ix.search('Point.mk')).toEqual(expect.not.arrayContaining([expect.objectContaining({ name: 'Fixture.Point.mk' })]));
  });

  it('searches within the performance budget (≤ 50 ms)', () => {
    const t = performance.now();
    for (const q of ['double', 'origin', 'axiom', 'sorry', 'colour']) ix.search(q);
    expect((performance.now() - t) / 5).toBeLessThan(50);
  });

  it('finds the section path of a declaration', () => {
    expect(ix.sectionsOf(id('Fixture.double_eq_add')).map((s) => s.title)).toEqual([
      'Basic definitions',
      'Fixture',
      'Facts',
    ]);
  });

  it('makes URL keys that round-trip, also for clashing names', () => {
    for (const i of ix.visible) expect(ix.idOfKey(ix.keyOf(i))).toBe(i);
    const keys = ix.byName.get('ClashDemo.value')!.map((i) => ix.keyOf(i));
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toMatch(/^ClashDemo\.value~Fixture\.Clash\.[AB]$/);
  });
});

describe('loadData', () => {
  const fakeDoc = (text: string) =>
    ({ getElementById: () => ({ textContent: text }) }) as unknown as Document;

  it('reads inlined data', async () => {
    const d = await loadData(fakeDoc(JSON.stringify({ schema: 1, decls: [] })));
    expect(d.schema).toBe(1);
  });

  it('falls back to fetch when the placeholder is still there', async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ schema: 1, decls: [] }));
    }) as typeof fetch;
    try {
      await loadData(fakeDoc('/*' + 'PROOFMAP_DATA*/'));
      expect(calls).toEqual(['data/page.json']);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
