import type { Indexes } from '../data/indexes';
import { reduceDeps } from './reduce';

/**
 * The outline: a tree rooted at the roots that follows what each result rests
 * on (project dependencies after noise collapse and transitive reduction), ordered by step, then
 * section, then source position. The same result can be used in several places; in the tree it
 * is shown in full at its first place and as an "also used here" link elsewhere.
 */
export function outlineChildren(ix: Indexes, id: number): readonly number[] {
  // The transitive reduction behind this is the costly part, and the outline, the tour, the map's
  // "Show more" and Expand all ask for the same declarations again and again: computed once per
  // page and declaration.
  let cache = childrenCache.get(ix);
  if (!cache) childrenCache.set(ix, (cache = new Map()));
  let kids = cache.get(id);
  if (!kids) cache.set(id, (kids = computeChildren(ix, id)));
  return kids;
}

const childrenCache = new WeakMap<Indexes, Map<number, readonly number[]>>();

function computeChildren(ix: Indexes, id: number): number[] {
  const d = ix.decls[id]!;
  const proof = reduceDeps(ix.decls, d.deps.proof, 'proof');
  const statement = reduceDeps(ix.decls, d.deps.statement, 'statement');
  // Proof dependencies first ("rests on"), then what the statement is about.
  const ids = [...new Set([...proof, ...statement])].filter((i) => !ix.decls[i]!.external && !ix.isNoise(i));
  // Within a step, the mathematics (theorems) before the definitions and encodings it uses.
  const key = (i: number) => {
    const x = ix.decls[i]!;
    return [x.step ?? '', x.kind === 'theorem' ? '0' : '1', x.module ?? '', String(x.range?.start[0] ?? 0).padStart(7, '0')];
  };
  return ids.sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return ka[k]! < kb[k]! ? -1 : 1;
    return 0;
  });
}

export interface OutlineRow {
  id: number;
  depth: number;
  /** False when the result is shown in full earlier in the outline ("also used here"). */
  first: boolean;
  hasChildren: boolean;
}

/** The visible rows: roots, and the children of every expanded first occurrence, in order. */
export function outlineRows(ix: Indexes, roots: number[], expanded: ReadonlySet<number>, maxDepth = 64): OutlineRow[] {
  const seen = new Set<number>();
  const rows: OutlineRow[] = [];
  const visit = (id: number, depth: number) => {
    const first = !seen.has(id);
    seen.add(id);
    const kids = outlineChildren(ix, id);
    rows.push({ id, depth, first, hasChildren: kids.length > 0 });
    if (first && expanded.has(id) && depth < maxDepth) for (const k of kids) visit(k, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  return rows;
}

/**
 * The rows to open so that `target` shows in the outline: the shortest way down from a root
 * (breadth-first over outline children), without the target itself. Opening these ids is enough:
 * the first occurrence of each is expanded, so the target appears under one of them. Null when the
 * target is not below any root within `maxDepth` levels.
 */
export function outlinePathTo(ix: Indexes, roots: number[], target: number, maxDepth = 16): number[] | null {
  if (roots.includes(target)) return [];
  const parent = new Map<number, number>();
  let frontier = roots.filter((r) => ix.decls[r]);
  const seen = new Set(frontier);
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: number[] = [];
    for (const id of frontier)
      for (const k of outlineChildren(ix, id)) {
        if (seen.has(k)) continue;
        seen.add(k);
        parent.set(k, id);
        if (k === target) {
          const path: number[] = [];
          for (let p = parent.get(k); p !== undefined; p = parent.get(p)) path.unshift(p);
          return path;
        }
        next.push(k);
      }
    frontier = next;
  }
  return null;
}

/** The guided tour: each root, then its big steps (children and their
 * children) in outline order, each result once. */
export function tourSteps(ix: Indexes, roots: number[], depth = 2): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const visit = (id: number, d: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    if (d < depth) for (const k of outlineChildren(ix, id)) visit(k, d + 1);
  };
  for (const r of roots) visit(r, 0);
  return out;
}
