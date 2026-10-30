import type { Decl } from '../data/schema';

/**
 * Transitive reduction of one declaration's dependencies.
 *
 * A dependency `d` of X is redundant when it can also be reached through another dependency of
 * X (for example `main_result` uses `double_double` and `double_eq_add`, and `double_double`
 * already rests on `double_eq_add`). Statement dependencies are reduced along statement edges
 * only; proof dependencies along all edges. One depth-first search per call, from the children
 * of all dependencies at once, so nothing is precomputed for the whole graph.
 */
export function reduceDeps(decls: Decl[], deps: number[], kind: 'statement' | 'proof'): number[] {
  if (deps.length < 2) return deps;
  const next = (id: number) => {
    const d = decls[id]!;
    return kind === 'statement' ? d.deps.statement : [...d.deps.statement, ...d.deps.proof];
  };
  const seen = new Set<number>();
  const stack: number[] = [];
  for (const d of deps) for (const c of next(d)) stack.push(c);
  while (stack.length) {
    const v = stack.pop()!;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const c of next(v)) if (!seen.has(c)) stack.push(c);
  }
  return deps.filter((d) => !seen.has(d));
}
