import type { Indexes } from '../data/indexes';
import { statusOf } from '../data/status';
import { downstream } from './propagate';

/** The health and progress summary, over the visible project declarations. */
export interface Health {
  total: number;
  proved: number;
  sorry: number;
  nonstandard: number;
  deprecated: number;
  unsafe: number;
  /** Declarations whose own proof contains `sorry`, with how many results rest on each. */
  sorrySources: Array<{ id: number; downstream: number }>;
  /** Each axiom and how many declarations use it (transitively). */
  axioms: Array<{ name: string; count: number; standard: boolean }>;
  largestByLines: number[];
  largestByTerm: number[];
  /** Declarations no other declaration uses, other than the roots and main results. */
  unused: number[];
  /** Project declarations Lean generated without a source range (`noise:generated`), left out of every list. */
  generated: number;
  byModule: Array<{ name: string; total: number; ok: number }>;
  byStep: Array<{ name: string; total: number; ok: number }>;
}

export function computeHealth(ix: Indexes, top = 10): Health {
  const ids = ix.visible;
  const decls = ix.decls;
  const standard = new Set(ix.data.project.standardAxioms ?? ['propext', 'Classical.choice', 'Quot.sound']);
  const roots = new Set(ix.data.project.roots);
  const h: Health = {
    total: ids.length, proved: 0, sorry: 0, nonstandard: 0, deprecated: 0, unsafe: 0,
    sorrySources: [], axioms: [], largestByLines: [], largestByTerm: [], unused: [], byModule: [], byStep: [],
    generated: decls.filter((d) => !d.external && d.flags.includes('noise:generated')).length,
  };
  const axiomCount = new Map<string, number>();
  const byModule = new Map<string, { total: number; ok: number }>();
  const byStep = new Map<string, { total: number; ok: number }>();
  for (const id of ids) {
    const d = decls[id]!;
    const s = statusOf(d);
    if (s === 'ok') h.proved++;
    if (d.status.sorry) h.sorry++;
    if (d.status.nonstandardAxioms.length) h.nonstandard++;
    if (d.flags.includes('deprecated')) h.deprecated++;
    if (d.flags.includes('unsafe') || d.flags.includes('partial')) h.unsafe++;
    for (const a of d.status.axioms) axiomCount.set(a, (axiomCount.get(a) ?? 0) + 1);
    const usesSorryDirectly = [...d.directDeps.statement, ...d.directDeps.proof].some((t) => decls[t]!.name === 'sorryAx');
    if (usesSorryDirectly) h.sorrySources.push({ id, downstream: downstream(ix, id).size });
    const users = ix.usedBy.statement[id]!.length + ix.usedBy.proof[id]!.length;
    if (users === 0 && !roots.has(id) && d.rank !== 'result') h.unused.push(id);
    for (const [map, key] of [[byModule, d.module ?? '?'], [byStep, d.step ?? '(no step)']] as const) {
      const e = map.get(key) ?? { total: 0, ok: 0 };
      e.total++;
      if (s === 'ok') e.ok++;
      map.set(key, e);
    }
  }
  h.axioms = [...axiomCount].map(([name, count]) => ({ name, count, standard: standard.has(name) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const largest = (f: (id: number) => number) => [...ids].filter((i) => f(i) > 0).sort((a, b) => f(b) - f(a) || a - b).slice(0, top);
  h.largestByLines = largest((i) => decls[i]!.size.lines);
  h.largestByTerm = largest((i) => decls[i]!.size.exprNodes);
  h.byModule = [...byModule].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  h.byStep = [...byStep].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  return h;
}
