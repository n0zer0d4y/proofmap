import {
  BaseEdge,
  getBezierPath,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CARD_WIDTH, cardHeight, DeclCard, GroupCard } from '../components/Card';
import type { Indexes } from '../data/indexes';
import { statusOf, type StatusKind } from '../data/status';
import { declNodeId, fold, type Folded, type MapEdge, type MapNode } from '../graph/fold';
import { isTainted, worstStatus } from '../graph/propagate';
import type { Positions } from '../layout/elk-graph';
import { requestLayout } from '../layout/client';
import { useStore } from '../state/store';

/** The map: the anchor result and what it rests on, laid out left to right,
 * foundations on the left. Nothing moves on its own; expanding a card shifts its neighbours. */
export const IxContext = createContext<Indexes | null>(null);
const useIx = () => useContext(IxContext)!;

type CardData = { node: MapNode };

function DeclNode({ data }: NodeProps<Node<CardData>>) {
  return <DeclCard ix={useIx()} id={data.node.decl!} />;
}

function GroupNode({ data }: NodeProps<Node<CardData>>) {
  const ix = useIx();
  const toggleGroup = useStore((s) => s.toggleGroup);
  const n = data.node;
  return (
    <GroupCard
      label={n.label}
      count={n.members!.length}
      external={n.kind === 'external'}
      status={worstStatus(ix, n.members!)}
      open={() => toggleGroup(n.id)}
    />
  );
}

type EdgeData = { edge: MapEdge; sentence: string; tainted: StatusKind | null };

function DepEdge(props: EdgeProps<Edge<EdgeData>>) {
  const [path] = getBezierPath(props);
  const e = props.data!.edge;
  const dash = e.viaNoise ? '2 5' : e.kind === 'statement' ? '7 5' : undefined;
  const stroke = props.data!.tainted ? `var(--${props.data!.tainted})` : 'var(--edge)';
  return (
    // role="img": a label is only allowed on an element with a role (WebKit's axe audit fails it otherwise).
    <g className="dep-edge" role="img" aria-label={props.data!.sentence}>
      <title>{props.data!.sentence}</title>
      <BaseEdge path={path} style={{ stroke, strokeDasharray: dash, strokeWidth: props.data!.tainted ? 2 : 1.4 }} />
      {/* A wide invisible path makes the edge easy to hover. */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} />
    </g>
  );
}

// Not 'group': that is React Flow's built-in node type, with its own styling.
export const nodeTypes = { declCard: DeclNode, groupCard: GroupNode };
export const edgeTypes = { dep: DepEdge };

function nodeLabel(ix: Indexes, n: MapNode | undefined): string {
  if (!n) return '?';
  if (n.kind === 'decl') return ix.decls[n.decl!]!.name;
  return `${n.label} (${n.members!.length} results)`;
}

function sentence(ix: Indexes, e: MapEdge, byId: Map<string, MapNode>): string {
  const a = nodeLabel(ix, byId.get(e.source));
  const b = nodeLabel(ix, byId.get(e.target));
  const base = e.kind === 'proof' ? `${a} is used in the proof of ${b}` : `${a} appears in the statement of ${b}`;
  return e.viaNoise ? `${base} (through hidden helper declarations)` : base;
}

/**
 * Lays out a folded graph and turns it into React Flow nodes and edges. Card sizes are measured
 * by React Flow; until a card is measured its height is estimated. Layout uses the measured
 * sizes, so cards never overlap; it converges because layout does not change sizes. A change of
 * `resetKey` starts a fresh layout and re-fits the view.
 */
export function useLaidOutGraph(ix: Indexes, folded: Folded, highlighted: ReadonlySet<string>, resetKey: unknown) {
  const flow = useReactFlow();
  const expanded = useStore((s) => s.expanded);
  const showCode = useStore((s) => s.showCode);
  const statementsExpanded = useStore((s) => s.statementsExpanded);
  const focus = useStore((s) => s.focus);
  const byId = useMemo(() => new Map(folded.nodes.map((n) => [n.id, n])), [folded]);
  // Card sizes measured by React Flow; until a card is measured its height is estimated. Layout
  // uses the measured sizes, so cards never overlap; it converges because layout does not
  // change sizes.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setMeasured((m) => {
      let next = m;
      for (const c of changes) {
        if (c.type !== 'dimensions' || !c.dimensions) continue;
        const prev = m[c.id];
        const d = c.dimensions;
        if (prev && Math.abs(prev.height - d.height) < 4 && Math.abs(prev.width - d.width) < 4) continue;
        if (next === m) next = { ...m };
        next[c.id] = { width: d.width, height: d.height };
      }
      return next;
    });
  }, []);
  const sizes = useMemo(
    () =>
      folded.nodes.map((n) => ({
        id: n.id,
        width: measured[n.id]?.width ?? CARD_WIDTH,
        height:
          measured[n.id]?.height ??
          (n.kind === 'decl'
            ? cardHeight(ix, n.decl!, expanded.has(n.decl!) || statementsExpanded, showCode && expanded.has(n.decl!))
            : 96),
      })),
    [folded, ix, expanded, statementsExpanded, showCode, measured],
  );

  const [positions, setPositions] = useState<Positions>({});
  const previous = useRef<Positions | undefined>(undefined);
  const fitted = useRef(false);
  useEffect(() => {
    let live = true;
    void requestLayout(sizes, folded.edges, previous.current).then((p) => {
      if (!live || !p) return;
      previous.current = p;
      setPositions(p);
    });
    return () => {
      live = false;
    };
  }, [sizes, folded.edges]);
  useEffect(() => {
    if (!fitted.current && Object.keys(positions).length) {
      fitted.current = true;
      requestAnimationFrame(() => void flow.fitView({ padding: 0.15, maxZoom: 1 }));
    }
  }, [positions, flow]);
  useEffect(() => {
    fitted.current = false;
    previous.current = undefined;
  }, [resetKey]);

  const nodes: Node<CardData>[] = folded.nodes.map((n) => ({
    id: n.id,
    type: n.kind === 'decl' ? 'declCard' : 'groupCard',
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { node: n },
    draggable: false,
    selectable: true,
    selected: n.kind === 'decl' && n.decl === focus,
    className: highlighted.has(n.id) ? 'highlighted' : undefined,
    // Known sizes let the minimap and fit-view see the cards.
    measured: measured[n.id],
    style: positions[n.id] ? undefined : { visibility: 'hidden' },
  }));
  const edges: Edge<EdgeData>[] = folded.edges.map((e) => {
    const src = byId.get(e.source);
    const st = src?.kind === 'decl' ? statusOf(ix.decls[src.decl!]!) : src ? worstStatus(ix, src.members!) : 'ok';
    const onChain = highlighted.has(e.source) && highlighted.has(e.target);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'dep',
      className: onChain ? 'highlighted' : undefined,
      data: { edge: e, sentence: sentence(ix, e, byId), tainted: isTainted(st) ? st : null },
    };
  });

  return { nodes, edges, positions, onNodesChange, byId };
}

function MapInner({ ix }: { ix: Indexes }) {
  const flow = useReactFlow();
  const anchorState = useStore((s) => s.anchor);
  const anchor = anchorState ?? ix.data.project.roots[0] ?? ix.visible[0] ?? null;
  const expanded = useStore((s) => s.expanded);
  const expandedGroups = useStore((s) => s.expandedGroups);
  const showNoise = useStore((s) => s.showNoise);
  const showExternal = useStore((s) => s.showExternal);
  const focus = useStore((s) => s.focus);
  const select = useStore((s) => s.select);
  const highlight = useStore((s) => s.highlight);

  const folded = useMemo(() => {
    if (anchor === null) return { nodes: [], edges: [] };
    return fold(ix, {
      roots: [anchor],
      expanded: new Set([anchor, ...expanded]),
      expandedGroups,
      showNoise,
      showExternal,
      pinned: new Set(highlight),
    });
  }, [ix, anchor, expanded, expandedGroups, showNoise, showExternal, highlight]);
  const highlighted = useMemo(() => new Set(highlight.map(declNodeId)), [highlight]);

  const { nodes, edges, positions, onNodesChange, byId } = useLaidOutGraph(ix, folded, highlighted, anchor);

  // Keyboard navigation.
  const container = useRef<HTMLDivElement>(null);
  const centerOn = useCallback(
    (id: number) => {
      const p = positions[declNodeId(id)];
      if (p) void flow.setCenter(p.x + CARD_WIDTH / 2, p.y + 50, { duration: 250, zoom: flow.getZoom() });
    },
    [positions, flow],
  );
  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = useStore.getState();
    const visibleDecl = (id: number) => byId.has(declNodeId(id));
    const cur = s.focus !== null && visibleDecl(s.focus) ? s.focus : anchor;
    if (cur === null) return;
    const move = (id: number | undefined) => {
      if (id === undefined) return;
      e.preventDefault();
      s.select(id);
      centerOn(id);
    };
    const pos = (id: number) => positions[declNodeId(id)] ?? { x: 0, y: 0 };
    const byDistance = (ids: number[]) => ids.filter(visibleDecl).sort((a, b) => Math.abs(pos(a).y - pos(cur).y) - Math.abs(pos(b).y - pos(cur).y));
    const d = ix.decls[cur]!;
    switch (e.key) {
      case 'ArrowLeft':
        move(byDistance([...d.deps.statement, ...d.deps.proof])[0]);
        break;
      case 'ArrowRight':
        move(byDistance([...ix.usedBy.statement[cur]!, ...ix.usedBy.proof[cur]!])[0]);
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        const column = folded.nodes
          .filter((n) => n.kind === 'decl' && Math.abs(pos(n.decl!).x - pos(cur).x) < 5)
          .map((n) => n.decl!)
          .sort((a, b) => pos(a).y - pos(b).y);
        const i = column.indexOf(cur);
        move(column[e.key === 'ArrowUp' ? i - 1 : i + 1]);
        break;
      }
      case 'Enter':
        e.preventDefault();
        if (!s.expanded.has(cur)) s.toggleExpanded(cur);
        break;
      case 'Escape':
        e.preventDefault();
        if (s.expanded.has(cur)) s.toggleExpanded(cur);
        break;
      case 'f':
        e.preventDefault();
        s.setAnchor(cur);
        break;
      case 'p':
        e.preventDefault();
        if (s.pathFrom === null) s.setPath(cur, null);
        else {
          s.setPath(s.pathFrom, cur);
          s.setView('paths');
        }
        break;
    }
  };

  if (anchor === null) return <p className="empty">This project has no declarations to show.</p>;
  const focusDecl = focus !== null ? ix.decls[focus] : undefined;
  return (
    <div ref={container} className="map" tabIndex={0} onKeyDown={onKeyDown} aria-label="Dependency map. Arrow keys move between results, Enter expands, Escape collapses, f focuses the map here, p pins to the path finder.">
      <MapToolbar ix={ix} anchor={anchor} focusName={focusDecl?.title ?? null} onFit={() => void flow.fitView({ padding: 0.15, duration: 250 })} centerOn={centerOn} />
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, n) => {
          const node = (n.data as CardData).node;
          if (node.kind === 'decl') select(node.decl!);
          container.current?.focus();
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll
        panOnDrag
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <MiniMap pannable zoomable ariaLabel="Overview of the map" nodeColor={(n) => minimapColor(ix, (n.data as CardData).node)} />
        <Legend />
      </ReactFlow>
    </div>
  );
}

function minimapColor(ix: Indexes, n: MapNode): string {
  const s = n.kind === 'decl' ? statusOf(ix.decls[n.decl!]!) : worstStatus(ix, n.members ?? []);
  return s === 'sorry' ? '#d14b42' : s === 'axiom' ? '#d99a35' : s === 'external' ? '#9aa0aa' : '#4c9a6a';
}

function MapToolbar({ ix, anchor, focusName, onFit, centerOn }: { ix: Indexes; anchor: number; focusName: string | null; onFit: () => void; centerOn: (id: number) => void }) {
  const s = useStore();
  const focus = s.focus;
  return (
    <div className="map-toolbar" role="toolbar" aria-label="Map controls">
      <span className="toolbar-title" title={ix.decls[anchor]!.name}>
        ★ {ix.decls[anchor]!.title}
      </span>
      <button className="icon-button" onClick={onFit}>
        Fit
      </button>
      <button className="icon-button" disabled={focus === null} onClick={() => focus !== null && centerOn(focus)}>
        Find selected
      </button>
      <button className="icon-button" disabled={focus === null || focus === anchor} onClick={() => focus !== null && s.setAnchor(focus)} title={focusName ? `Build the map around ${focusName}` : undefined}>
        Focus map here
      </button>
      <button
        className="icon-button"
        disabled={focus === null}
        onClick={() => {
          if (focus === null) return;
          // One more ring: the selected result and each of its direct dependencies.
          const d = ix.decls[focus]!;
          s.setExpanded([...s.expanded, focus, ...[...d.deps.statement, ...d.deps.proof].filter((i) => !ix.decls[i]!.external)]);
        }}
      >
        Show more around this
      </button>
      {anchor !== (ix.data.project.roots[0] ?? null) && (
        <button className="icon-button" onClick={() => s.setAnchor(null)}>
          Back to main result
        </button>
      )}
      <label className="toggle">
        <input type="checkbox" checked={s.showExternal} onChange={(e) => s.setShowExternal(e.target.checked)} /> Other libraries
      </label>
      {(s.noiseControls || s.showNoise) && (
        <label className="toggle">
          <input type="checkbox" checked={s.showNoise} onChange={(e) => s.setShowNoise(e.target.checked)} /> Generated helpers
        </label>
      )}
      <label className="toggle">
        <input type="checkbox" checked={s.showCode} onChange={(e) => s.setShowCode(e.target.checked)} /> Code in cards
      </label>
    </div>
  );
}

function Legend() {
  return (
    <Panel position="bottom-left" className="map-legend" aria-label="Legend">
      <span>
        <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--edge)" strokeWidth="1.6" /></svg> used in the proof
      </span>
      <span>
        <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--edge)" strokeWidth="1.6" strokeDasharray="7 5" /></svg> appears in the statement
      </span>
      <span>
        <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--edge)" strokeWidth="1.6" strokeDasharray="2 5" /></svg> through hidden helpers
      </span>
      <span className="status status-ok">✓ proved</span>
      <span className="status status-sorry">✗ sorry</span>
      <span className="status status-axiom">! extra axiom</span>
    </Panel>
  );
}

export function MapView({ ix }: { ix: Indexes }) {
  return (
    <IxContext.Provider value={ix}>
      <ReactFlowProvider>
        <MapInner ix={ix} />
      </ReactFlowProvider>
    </IxContext.Provider>
  );
}
