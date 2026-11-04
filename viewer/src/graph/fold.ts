import type { Indexes } from '../data/indexes';
import { isCoreLibrary, libraryOf } from '../data/library';
import { reduceDeps } from './reduce';

/**
 * The visible part of the dependency graph.
 *
 * Starting from the roots, every expanded declaration shows its direct dependencies (after noise
 * collapse and transitive reduction). When more than `maxDirect` remain, they are grouped by
 * step label, then section, then module, each group becoming one "+N" card that can be opened.
 * Dependencies from other libraries are aggregated into one boundary card per library
 * ("Mathlib", "Lean core"); Lean core can be left out. Above `cap` visible declaration cards, further expansions are grouped
 * regardless, so the hairball cannot come back.
 *
 * Edges point from a dependency to its user, so foundations end up on the left.
 */
export type MapNodeKind = 'decl' | 'group' | 'external';

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  /** The declaration (decl nodes). */
  decl?: number;
  /** Members (group and external nodes). */
  members?: number[];
  label: string;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: 'statement' | 'proof';
  /** The dependency goes through declarations hidden as noise. */
  viaNoise: boolean;
}

export interface FoldOptions {
  roots: number[];
  /** Declarations whose dependencies are shown. */
  expanded: ReadonlySet<number>;
  /** Group and boundary cards that are opened (their ids). */
  expandedGroups: ReadonlySet<string>;
  showNoise: boolean;
  showExternal: boolean;
  /** Lean's own libraries (Init, Std, Lean); shown unless false. */
  showCore?: boolean;
  /** Declarations that are always shown as their own cards (never grouped away). */
  pinned?: ReadonlySet<number>;
  maxDirect?: number;
  cap?: number;
}

export interface Folded {
  nodes: MapNode[];
  edges: MapEdge[];
}

export const declNodeId = (id: number) => `d${id}`;

/** The library card an external declaration goes to: its library ("Mathlib"), with Lean's own
 * libraries together as "Lean core". */
export function externalArea(module: string | null): string {
  return libraryOf(module);
}

export function fold(ix: Indexes, o: FoldOptions): Folded {
  const maxDirect = o.maxDirect ?? 9;
  const cap = o.cap ?? 150;
  const decls = ix.decls;
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const queue: number[] = [];
  let declCount = 0;

  const addDecl = (id: number): string => {
    const nid = declNodeId(id);
    if (!nodes.has(nid)) {
      nodes.set(nid, { id: nid, kind: 'decl', decl: id, label: decls[id]!.title });
      declCount++;
      if (o.expanded.has(id)) queue.push(id);
    }
    return nid;
  };
  const addEdge = (source: string, target: string, kind: 'statement' | 'proof', viaNoise: boolean) => {
    const id = `${source}->${target}`;
    const prev = edges.get(id);
    // A statement use is the stronger relation when both exist.
    if (!prev || (prev.kind === 'proof' && kind === 'statement'))
      edges.set(id, { id, source, target, kind, viaNoise: prev ? prev.viaNoise && viaNoise : viaNoise });
  };
  const groupLabel = (id: number): string => {
    const d = decls[id]!;
    return d.step ?? ix.sectionsOf(id).at(-1)?.title ?? d.module ?? 'Other';
  };

  for (const r of o.roots) addDecl(r);

  while (queue.length) {
    const x = queue.shift()!;
    const xd = decls[x]!;
    const target = declNodeId(x);
    const source = o.showNoise ? xd.directDeps : xd.deps;
    const direct = new Set([...xd.directDeps.statement, ...xd.directDeps.proof]);
    const byKind: Array<['statement' | 'proof', number[]]> = [
      ['statement', reduceDeps(decls, source.statement, 'statement')],
      ['proof', reduceDeps(decls, source.proof, 'proof')],
    ];
    const kindOf = new Map<number, 'statement' | 'proof'>();
    for (const [kind, ids] of byKind) for (const id of ids) if (!kindOf.has(id)) kindOf.set(id, kind);

    // Externals: one boundary card per library area.
    const project: number[] = [];
    const areas = new Map<string, number[]>();
    for (const [id] of kindOf) {
      const d = decls[id]!;
      if (!o.showNoise && ix.isNoise(id)) continue;
      if (d.external) {
        if (!o.showExternal) continue;
        const area = externalArea(d.module);
        if (o.showCore === false && isCoreLibrary(area)) continue;
        areas.set(area, [...(areas.get(area) ?? []), id]);
      } else project.push(id);
    }
    for (const [area, ids] of areas) {
      const nid = `ext:${area}`;
      const node = nodes.get(nid);
      const members = [...new Set([...(node?.members ?? []), ...ids])];
      nodes.set(nid, { id: nid, kind: 'external', members, label: area });
      const kind = ids.some((i) => kindOf.get(i) === 'statement') ? 'statement' : 'proof';
      addEdge(nid, target, kind, ids.every((i) => !direct.has(i)));
    }

    // Project dependencies: shown directly, or grouped when there are too many.
    const alreadyShown = project.filter((id) => nodes.has(declNodeId(id)));
    const fresh = project.filter((id) => !nodes.has(declNodeId(id)));
    const mustGroup = fresh.length + alreadyShown.length > maxDirect || declCount + fresh.length > cap;
    const showDirect = (id: number) => addEdge(addDecl(id), target, kindOf.get(id)!, !direct.has(id));
    alreadyShown.forEach(showDirect);
    if (!mustGroup) {
      fresh.forEach(showDirect);
      continue;
    }
    const groups = new Map<string, number[]>();
    for (const id of fresh) {
      if (o.pinned?.has(id)) {
        showDirect(id);
        continue;
      }
      const label = groupLabel(id);
      groups.set(label, [...(groups.get(label) ?? []), id]);
    }
    for (const [label, ids] of groups) {
      if (ids.length === 1) {
        showDirect(ids[0]!);
        continue;
      }
      const gid = `grp:${x}:${label}`;
      if (o.expandedGroups.has(gid)) {
        ids.forEach(showDirect);
        continue;
      }
      nodes.set(gid, { id: gid, kind: 'group', members: ids, label });
      const kind = ids.some((i) => kindOf.get(i) === 'statement') ? 'statement' : 'proof';
      addEdge(gid, target, kind, ids.every((i) => !direct.has(i)));
    }
  }

  // Opened boundary cards show their members as individual cards.
  for (const node of [...nodes.values()]) {
    if (node.kind !== 'external' || !o.expandedGroups.has(node.id)) continue;
    nodes.delete(node.id);
    for (const e of [...edges.values()]) {
      if (e.source !== node.id) continue;
      edges.delete(e.id);
      const user = decls[Number(e.target.slice(1))]!;
      for (const m of node.members ?? []) {
        const uses = user.deps.statement.includes(m) ? 'statement' : user.deps.proof.includes(m) ? 'proof' : null;
        if (uses) addEdge(addDecl(m), e.target, uses, false);
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
