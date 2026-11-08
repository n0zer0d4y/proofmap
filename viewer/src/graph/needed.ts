import type { Indexes } from '../data/indexes';

/**
 * Which main results rest on each declaration: for every main result, everything it depends on
 * (statement and proof, through hidden helpers, as the map draws it). Computed once per page.
 * A main result is not counted as needed for itself.
 */
export function mainResultsNeeding(ix: Indexes, id: number): readonly number[] {
  let byDecl = cache.get(ix);
  if (!byDecl) cache.set(ix, (byDecl = compute(ix)));
  return byDecl.get(id) ?? NONE;
}

const NONE: readonly number[] = [];
const cache = new WeakMap<Indexes, Map<number, number[]>>();

function compute(ix: Indexes): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const root of ix.data.project.roots) {
    const seen = new Set([root]);
    const stack = [root];
    while (stack.length) {
      const d = ix.decls[stack.pop()!]!;
      for (const t of [...d.deps.statement, ...d.deps.proof])
        if (!seen.has(t)) {
          seen.add(t);
          stack.push(t);
        }
    }
    seen.delete(root);
    for (const id of seen) {
      const list = out.get(id);
      if (list) list.push(root);
      else out.set(id, [root]);
    }
  }
  return out;
}
