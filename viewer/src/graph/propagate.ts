import type { Indexes } from '../data/indexes';
import { statusOf, type StatusKind } from '../data/status';

/**
 * Status propagation. The extractor computes each declaration's axioms
 * transitively (like `#print axioms`), so `sorry` and non-standard axioms already reach every
 * declaration downstream: a declaration's own status is its propagated status. This module adds
 * what the map needs on top: the status of group and boundary cards (the worst member), and
 * which edges carry a taint (their source is tainted).
 */
const ORDER: StatusKind[] = ['sorry', 'axiom', 'ok', 'external'];

export function worstStatus(ix: Indexes, ids: number[]): StatusKind {
  let best = ORDER.length - 1;
  for (const id of ids) best = Math.min(best, ORDER.indexOf(statusOf(ix.decls[id]!)));
  return ORDER[best]!;
}

export const isTainted = (s: StatusKind) => s === 'sorry' || s === 'axiom';

/** Every declaration that depends (transitively) on `id`, using collapsed dependencies. */
export function downstream(ix: Indexes, id: number): Set<number> {
  const out = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const v = stack.pop()!;
    for (const u of [...ix.usedBy.statement[v]!, ...ix.usedBy.proof[v]!])
      if (!out.has(u)) {
        out.add(u);
        stack.push(u);
      }
  }
  return out;
}
