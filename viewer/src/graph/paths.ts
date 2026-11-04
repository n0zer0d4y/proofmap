import type { Indexes } from '../data/indexes';

/**
 * Path finder: simple chains from `from` (a foundation) up to `to` (a result that rests on it),
 * following "is used by", at most `maxLength` steps and at most `limit` chains, shortest first.
 *
 * A breadth-first pass from `from` gives every declaration's distance from it, so the shortest
 * chain is always found, and chains are then listed by increasing length (each length searched
 * with that distance as a bound), so the first `limit` chains are the shortest ones. The search
 * only visits declarations that rest on `from`.
 */
export function findPaths(ix: Indexes, from: number, to: number, maxLength = 8, limit = 200): number[][] {
  const deps = (id: number) => [...new Set([...ix.decls[id]!.deps.statement, ...ix.decls[id]!.deps.proof])];
  // Steps from `from` up to each declaration that rests on it.
  const dist = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let d = 1; frontier.length && d <= maxLength; d++) {
    const next: number[] = [];
    for (const v of frontier)
      for (const u of [...ix.usedBy.statement[v]!, ...ix.usedBy.proof[v]!])
        if (!dist.has(u)) {
          dist.set(u, d);
          next.push(u);
        }
    frontier = next;
  }
  const shortest = dist.get(to);
  if (shortest === undefined) return [];
  const paths: number[][] = [];
  for (let length = shortest; length <= maxLength && paths.length < limit; length++) {
    const path = [to];
    const onPath = new Set([to]);
    // Down from `to` through dependencies, `left` steps still to go; a dependency further than
    // that from `from` cannot finish the chain.
    const walk = (v: number, left: number) => {
      if (paths.length >= limit) return;
      if (left === 0) {
        if (v === from) paths.push([...path].reverse());
        return;
      }
      for (const w of deps(v)) {
        const dw = dist.get(w);
        if (dw === undefined || dw > left - 1 || onPath.has(w)) continue;
        path.push(w);
        onPath.add(w);
        walk(w, left - 1);
        path.pop();
        onPath.delete(w);
      }
    };
    walk(to, length);
  }
  return paths;
}

/** The relation between consecutive declarations of a path, for the plain-words list. */
export function relation(ix: Indexes, dep: number, user: number): 'statement' | 'proof' {
  return ix.decls[user]!.deps.statement.includes(dep) ? 'statement' : 'proof';
}

/**
 * Everything a path can reach from `start` within `maxLength` steps, with its distance: going `up`
 * (what rests on `start`, the valid ends of a path from it) or `down` (what `start` rests on, the
 * valid starts of a path to it). Generated helpers are left out; `start` itself is not included.
 */
export function reachable(ix: Indexes, start: number, dir: 'up' | 'down', maxLength = 8): Map<number, number> {
  const next = (v: number) =>
    dir === 'up' ? [...ix.usedBy.statement[v]!, ...ix.usedBy.proof[v]!] : [...ix.decls[v]!.deps.statement, ...ix.decls[v]!.deps.proof];
  const dist = new Map<number, number>([[start, 0]]);
  let frontier = [start];
  for (let d = 1; frontier.length && d <= maxLength; d++) {
    const out: number[] = [];
    for (const v of frontier)
      for (const u of next(v))
        if (!dist.has(u)) {
          dist.set(u, d);
          out.push(u);
        }
    frontier = out;
  }
  dist.delete(start);
  for (const id of [...dist.keys()]) if (ix.isNoise(id)) dist.delete(id);
  return dist;
}
