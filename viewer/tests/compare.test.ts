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

describe('compare across proofmap versions', () => {
  // The same declaration, printed with full names (proofmap 0.1) and relative to its namespace (0.2).
  const shorten = (data: ProofmapData): ProofmapData => ({
    ...data,
    decls: data.decls.map((d) => {
      if (d.external || !d.signatureHover.length) return d;
      const cps = Array.from(d.signature);
      let out = '';
      let at = 0;
      const hover = [];
      for (const h of d.signatureHover) {
        const full = cps.slice(h.start, h.end).join('');
        const short = full.split('.').pop()!;
        out += cps.slice(at, h.start).join('');
        const start = Array.from(out).length;
        out += short;
        hover.push({ ...h, start, end: start + Array.from(short).length });
        at = h.end;
      }
      out += cps.slice(at).join('');
      return { ...d, signature: out, signatureHover: hover };
    }),
  });
  it('does not report a statement printed differently as changed', () => {
    const c = compare(cur, shorten(cur));
    expect(c.changed).toEqual([]);
    expect(shorten(cur).decls.some((d, i) => d.signature !== cur.decls[i]!.signature)).toBe(true);
  });
  it('still reports a real change of statement', () => {
    const i = cur.decls.findIndex((d) => !d.external && d.signatureHover.length && !d.flags.some((f) => f.startsWith('noise:')));
    const edited = { ...cur, decls: cur.decls.map((d, j) => (j === i ? { ...d, signature: `${d.signature} ∧ True` } : d)) };
    expect(compare(cur, edited).changed.map((x) => x.id)).toContain(i);
  });
});
