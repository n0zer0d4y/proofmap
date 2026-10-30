import type { Indexes } from '../data/indexes';

/**
 * "Why does this need ...?": the shortest chain of declarations from `from`
 * to the source of a `sorry` or a non-standard axiom.
 *
 * The source of an axiom is the axiom itself (when it is in the data) or else a declaration that
 * uses it directly. The source of `sorry` is a declaration that uses `sorryAx` directly, i.e.
 * one whose own proof contains `sorry`. The search follows dependencies (breadth first, so the
 * chain is shortest) through declarations that carry the same axiom.
 */
export function whyChain(ix: Indexes, from: number, axiom: string): number[] | null {
  const decls = ix.decls;
  const carries = (id: number) => decls[id]!.status.axioms.includes(axiom);
  const usesDirectly = (id: number) =>
    [...decls[id]!.directDeps.statement, ...decls[id]!.directDeps.proof].some((t) => decls[t]!.name === axiom);
  const isSource = (id: number) => decls[id]!.name === axiom || (axiom === 'sorryAx' ? usesDirectly(id) : usesDirectly(id) && !ix.byName.has(axiom));
  if (!carries(from)) return null;
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const v = queue.shift()!;
    if (isSource(v)) {
      const chain: number[] = [];
      for (let c = v; c !== -1; c = prev.get(c)!) chain.push(c);
      return chain.reverse();
    }
    const d = decls[v]!;
    for (const t of [...d.deps.statement, ...d.deps.proof, ...d.directDeps.statement, ...d.directDeps.proof]) {
      if (!prev.has(t) && (carries(t) || decls[t]!.name === axiom)) {
        prev.set(t, v);
        queue.push(t);
      }
    }
  }
  return null;
}

/** The axioms and `sorry` a declaration needs beyond the standard ones. */
export function extraAxioms(ix: Indexes, id: number): string[] {
  const s = ix.decls[id]!.status;
  return [...(s.sorry ? ['sorryAx'] : []), ...s.nonstandardAxioms];
}
