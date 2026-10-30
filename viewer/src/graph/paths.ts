import type { Indexes } from '../data/indexes';

/**
 * Path finder: every simple chain from `from` (a foundation) up to `to` (a
 * result that rests on it), following "is used by", at most `maxLength` steps, at most `limit`
 * paths. The search only walks declarations from which `from` can be reached, so it never
 * wanders into unrelated parts of the graph. Paths are sorted shortest first.
 */
export function findPaths(ix: Indexes, from: number, to: number, maxLength = 8, limit = 200): number[][] {
  const deps = (id: number) => [...ix.decls[id]!.deps.statement, ...ix.decls[id]!.deps.proof];
  // Declarations that rest (transitively) on `from`, plus `from` itself.
  const reaches = new Set<number>([from]);
  const stack = [from];
  while (stack.length) {
    const v = stack.pop()!;
    for (const u of [...ix.usedBy.statement[v]!, ...ix.usedBy.proof[v]!])
      if (!reaches.has(u)) {
        reaches.add(u);
        stack.push(u);
      }
  }
  if (!reaches.has(to)) return [];
  const paths: number[][] = [];
  const path = [to];
  const onPath = new Set([to]);
  // Depth-first from `to` down through dependencies that still lead to `from`.
  const dfs = (v: number) => {
    if (paths.length >= limit) return;
    if (v === from) {
      paths.push([...path].reverse());
      return;
    }
    if (path.length > maxLength) return;
    for (const w of new Set(deps(v))) {
      if (!reaches.has(w) || onPath.has(w)) continue;
      path.push(w);
      onPath.add(w);
      dfs(w);
      path.pop();
      onPath.delete(w);
    }
  };
  dfs(to);
  return paths.sort((a, b) => a.length - b.length);
}

/** The relation between consecutive declarations of a path, for the plain-words list. */
export function relation(ix: Indexes, dep: number, user: number): 'statement' | 'proof' {
  return ix.decls[user]!.deps.statement.includes(dep) ? 'statement' : 'proof';
}
