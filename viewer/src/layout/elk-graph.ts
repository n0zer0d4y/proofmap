/**
 * Layered left-to-right layout with ELK. Foundations end up on the left,
 * results on the right. When previous positions are given, ELK's interactive strategies keep the
 * existing layering and order, so expanding a card does not reshuffle the map: already placed
 * cards keep their relative order and only shift by whole layers when needed.
 */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}
export type Positions = Record<string, { x: number; y: number }>;

const BASE: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '28',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  // Not 'considerModelOrder': it made a 300-card layout take ~690 ms instead of ~80 ms.
  'elk.layered.thoroughness': '3',
  'elk.separateConnectedComponents': 'false',
};

const INTERACTIVE: Record<string, string> = {
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
  'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
};

/** The ELK input graph. With previous positions, interactive strategies keep the placed cards'
 * layering and order; new cards start next to the card they connect to. */
export function elkGraph(nodes: LayoutNode[], edges: LayoutEdge[], previous?: Positions) {
  const ids = new Set(nodes.map((n) => n.id));
  const interactive = previous && nodes.some((n) => previous[n.id]);
  const hint = (id: string) => {
    if (previous?.[id]) return previous[id];
    for (const e of edges) {
      if (e.source === id && previous?.[e.target]) return { x: previous[e.target]!.x - 300, y: previous[e.target]!.y };
      if (e.target === id && previous?.[e.source]) return { x: previous[e.source]!.x + 300, y: previous[e.source]!.y };
    }
    return undefined;
  };
  return {
    id: 'root',
    layoutOptions: interactive ? { ...BASE, ...INTERACTIVE } : BASE,
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height, ...(interactive ? hint(n.id) : {}) })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

export function positionsOf(result: { children?: Array<{ id: string; x?: number; y?: number }> }): Positions {
  const out: Positions = {};
  for (const c of result.children ?? []) out[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  return out;
}
