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
  /** The declarations behind each count, so a count can be opened. */
  lists: { total: number[]; proved: number[]; sorry: number[]; nonstandard: number[]; deprecated: number[]; unsafe: number[] };
  /** The declarations using each axiom (transitively). */
  axiomUsers: Map<string, number[]>;
  /** Documented theorems no other declaration uses (main results excluded): findings in their own right. */
  standalone: number[];
  /** Other declarations no other declaration uses, other than the roots and main results. */
  unused: number[];
  /** Project declarations Lean generated without a source range (`noise:generated`), left out of every list. */
  generated: number;
  byModule: Array<{ name: string; total: number; ok: number }>;
  /** Steps grouped by module, in source order (the same title in two files stays two rows). */
  byStep: Array<{ module: string; name: string; total: number; ok: number }>;
}

export function computeHealth(ix: Indexes, top = 10): Health {
  const ids = ix.visible;
  const decls = ix.decls;
  const standard = new Set(ix.data.project.standardAxioms ?? ['propext', 'Classical.choice', 'Quot.sound']);
  const roots = new Set(ix.data.project.roots);
  const h: Health = {
    total: ids.length, proved: 0, sorry: 0, nonstandard: 0, deprecated: 0, unsafe: 0,
    sorrySources: [], axioms: [], largestByLines: [], largestByTerm: [], standalone: [], unused: [], byModule: [], byStep: [],
    lists: { total: [...ids], proved: [], sorry: [], nonstandard: [], deprecated: [], unsafe: [] },
    axiomUsers: new Map(),
    generated: decls.filter((d) => !d.external && d.flags.includes('noise:generated')).length,
  };
  const axiomCount = new Map<string, number>();
  const byModule = new Map<string, { total: number; ok: number }>();
  const byStep = new Map<string, { module: string; name: string; total: number; ok: number; line: number }>();
  const add = (list: number[], id: number) => list.push(id);
  for (const id of ids) {
    const d = decls[id]!;
    const s = statusOf(d);
    if (s === 'ok') add(h.lists.proved, id);
    if (d.status.sorry) add(h.lists.sorry, id);
    if (d.status.nonstandardAxioms.length) add(h.lists.nonstandard, id);
    if (d.flags.includes('deprecated')) add(h.lists.deprecated, id);
    if (d.flags.includes('unsafe') || d.flags.includes('partial')) add(h.lists.unsafe, id);
    for (const a of d.status.axioms) {
      axiomCount.set(a, (axiomCount.get(a) ?? 0) + 1);
      h.axiomUsers.set(a, [...(h.axiomUsers.get(a) ?? []), id]);
    }
    const usesSorryDirectly = [...d.directDeps.statement, ...d.directDeps.proof].some((t) => decls[t]!.name === 'sorryAx');
    if (usesSorryDirectly) h.sorrySources.push({ id, downstream: downstream(ix, id).size });
    const users = ix.usedBy.statement[id]!.length + ix.usedBy.proof[id]!.length;
    if (users === 0 && !roots.has(id) && d.rank !== 'result') (d.kind === 'theorem' && d.docstring ? h.standalone : h.unused).push(id);
    const m = byModule.get(d.module ?? '?') ?? { total: 0, ok: 0 };
    m.total++;
    if (s === 'ok') m.ok++;
    byModule.set(d.module ?? '?', m);
    const module = d.module ?? '?';
    const key = JSON.stringify([module, d.step ?? '']);
    const st = byStep.get(key) ?? { module, name: d.step ?? '(no step)', total: 0, ok: 0, line: d.range?.start[0] ?? 0 };
    st.total++;
    if (s === 'ok') st.ok++;
    st.line = Math.min(st.line, d.range?.start[0] ?? st.line);
    byStep.set(key, st);
  }
  h.proved = h.lists.proved.length;
  h.sorry = h.lists.sorry.length;
  h.nonstandard = h.lists.nonstandard.length;
  h.deprecated = h.lists.deprecated.length;
  h.unsafe = h.lists.unsafe.length;
  h.axioms = [...axiomCount].map(([name, count]) => ({ name, count, standard: standard.has(name) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const largest = (f: (id: number) => number) => [...ids].filter((i) => f(i) > 0).sort((a, b) => f(b) - f(a) || a - b).slice(0, top);
  h.largestByLines = largest((i) => decls[i]!.size.lines);
  h.largestByTerm = largest((i) => decls[i]!.size.exprNodes);
  h.byModule = [...byModule].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  h.byStep = [...byStep.values()]
    .sort((a, b) => a.module.localeCompare(b.module) || a.line - b.line)
    .map(({ module, name, total, ok }) => ({ module, name, total, ok }));
  return h;
}
