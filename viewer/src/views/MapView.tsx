import {
  BaseEdge,
  getBezierPath,
  MarkerType,
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
import { outlineChildren } from '../graph/outline';
import { isTainted, worstStatus } from '../graph/propagate';
import type { Positions } from '../layout/elk-graph';
import { requestLayout } from '../layout/client';
import { currentPalette, ExportButtons } from '../components/Export';
import { mapSvg, svgToPng } from '../graph/svg';
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
      <BaseEdge path={path} markerEnd={props.markerEnd} style={{ stroke, strokeDasharray: dash, strokeWidth: props.data!.tainted ? 2 : 1.4 }} />
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
            ? cardHeight(ix, n.decl!, statementsExpanded, showCode && n.decl === focus)
            : 96),
      })),
    [folded, ix, statementsExpanded, showCode, focus, measured],
  );
  const sizeOf = useCallback((id: string) => sizes.find((s) => s.id === id) ?? { width: CARD_WIDTH, height: 112 }, [sizes]);

  const [positions, setPositions] = useState<Positions>({});
  const previous = useRef<Positions | undefined>(undefined);
  const fitted = useRef(false);
  // Cards that appeared with the last layout (an opened card or library), to bring into view.
  const revealed = useRef<string[]>([]);
  const target = useRef<{ ids: string[] } | null>(null);
  // A move the reader makes (drag, wheel, minimap) ends the automatic following.
  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) target.current = null;
  }, []);
  // A new map (another anchor) starts a fresh layout and a fresh view. This happens here, before
  // the layout is requested: seeding the new map's layout with the old map's positions would let a
  // later pass rearrange it after the view was chosen.
  const layoutKey = useRef<unknown>(resetKey);
  useEffect(() => {
    if (layoutKey.current !== resetKey) {
      layoutKey.current = resetKey;
      previous.current = undefined;
      fitted.current = false;
      target.current = null;
    }
    let live = true;
    void requestLayout(sizes, folded.edges, previous.current).then((p) => {
      if (!live || !p) return;
      const before = previous.current;
      revealed.current = before ? Object.keys(p).filter((id) => !before[id]) : [];
      previous.current = p;
      setPositions(p);
    });
    return () => {
      live = false;
    };
  }, [sizes, folded.edges, resetKey]);
  // The first view is chosen once every card has its measured size: the layout made from estimated
  // sizes moves when the real ones arrive, and a view chosen before that can leave cards outside.
  const allMeasured = folded.nodes.every((n) => measured[n.id] && positions[n.id]);
  useEffect(() => {
    if (!Object.keys(positions).length) return;
    const box = viewportBox();
    if (!box) return;
    const sel = focus !== null ? declNodeId(focus) : null;
    // Keep `ids` in view at a readable zoom; when they are too wide for that, keep the selected
    // card in view, a third from the left, so the rest (what uses it) continues to the right.
    const show = (ids: string[], animate: boolean) => {
      const b = boundsOf(ids, positions, sizeOf);
      const v = flow.getViewport();
      const left = -v.x / v.zoom, top = -v.y / v.zoom;
      if (b.x >= left && b.y >= top && b.x + b.width <= left + box.width / v.zoom && b.y + b.height <= top + box.height / v.zoom) return;
      const fit = Math.min(box.width / b.width, box.height / b.height) * 0.9;
      const zoom = Math.max(MIN_READABLE_ZOOM, Math.min(Math.max(v.zoom, MIN_READABLE_ZOOM), fit));
      const duration = animate ? 300 : 0;
      if (fit < MIN_READABLE_ZOOM && sel && positions[sel]) {
        const p = positions[sel]!, s = sizeOf(sel);
        void flow.setCenter(p.x + s.width / 2 + box.width / zoom / 6, p.y + s.height / 2, { zoom, duration });
      } else void flow.setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom, duration });
    };
    if (!fitted.current) {
      if (!allMeasured) return;
      // First view of this map: fit it if that keeps the cards readable; otherwise keep the
      // selection (and a highlighted chain) in view, or else show the result (the right-most card)
      // at a readable zoom, with what it rests on to its left.
      fitted.current = true;
      revealed.current = [];
      const all = boundsOf(Object.keys(positions), positions, sizeOf);
      const fit = Math.min(box.width / all.width, box.height / all.height) * 0.88;
      const wanted = [...highlighted, ...(sel ? [sel] : [])].filter((id) => positions[id]);
      if (fit >= MIN_READABLE_ZOOM) requestAnimationFrame(() => void flow.fitView({ padding: 0.12, maxZoom: 1 }));
      else if (wanted.length) {
        // Followed like a reveal, so later layout passes keep it in view too.
        target.current = { ids: wanted };
        void flow.setViewport({ x: 0, y: 0, zoom: Math.max(flow.getZoom(), MIN_READABLE_ZOOM) });
        show(wanted, false);
      } else {
        const zoom = 0.75;
        const right = all.x + all.width;
        requestAnimationFrame(
          () => void flow.setCenter(right - box.width / zoom / 2 + 24 / zoom, all.y + all.height / 2, { zoom }),
        );
      }
      return;
    }
    const fresh = revealed.current;
    revealed.current = [];
    // The new cards and the cards they connect to. They stay the camera's target through every
    // layout pass (later passes, with measured sizes, can move them) until the reader moves the map,
    // the map is rebuilt, or more cards appear.
    if (fresh.length) {
      const users = folded.edges.filter((e) => fresh.includes(e.source)).map((e) => e.target);
      target.current = { ids: [...new Set([...fresh, ...users])] };
    }
    if (!target.current) return;
    // The selected card and a highlighted chain are always part of what is kept in view.
    const ids = [...target.current.ids, ...highlighted, ...(sel ? [sel] : [])].filter((id) => positions[id]);
    if (ids.length) show(ids, true);
  }, [positions, flow, folded.edges, sizeOf, allMeasured, focus, highlighted]);

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
    const text = sentence(ix, e, byId);
    const tainted = isTainted(st) ? st : null;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'dep',
      className: onChain ? 'highlighted' : undefined,
      // Read aloud instead of React Flow's "Edge from d12 to d40"; edges are not Tab stops.
      ariaLabel: text,
      focusable: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: tainted ? STATUS_COLOR[tainted] : 'var(--edge)' },
      data: { edge: e, sentence: text, tainted },
    };
  });

  return { nodes, edges, positions, onNodesChange, byId, sizeOf, onMoveStart };
}

/** Below this zoom card text is too small to read; the map pans instead of shrinking further. */
const MIN_READABLE_ZOOM = 0.6;

const STATUS_COLOR: Record<string, string> = { sorry: 'var(--sorry)', axiom: 'var(--axiom)' };

/** The map's visible area in screen pixels. */
function viewportBox(): { width: number; height: number } | null {
  const el = document.querySelector('.react-flow');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : null;
}

/** The bounding box of some cards, in map coordinates. */
function boundsOf(ids: string[], positions: Positions, size: (id: string) => { width: number; height: number }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    if (!p) continue;
    const s = size(id);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + s.width);
    y1 = Math.max(y1, p.y + s.height);
  }
  if (x0 === Infinity) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

function MapInner({ ix }: { ix: Indexes }) {
  const flow = useReactFlow();
  const anchorState = useStore((s) => s.anchor);
  const anchor = anchorState ?? ix.data.project.roots[0] ?? ix.visible[0] ?? null;
  const expanded = useStore((s) => s.expanded);
  const expandedGroups = useStore((s) => s.expandedGroups);
  const showNoise = useStore((s) => s.showNoise);
  const showExternal = useStore((s) => s.showExternal);
  const showCore = useStore((s) => s.showCore);
  const focus = useStore((s) => s.focus);
  const select = useStore((s) => s.select);
  const highlight = useStore((s) => s.highlight);
  const tour = useStore((s) => s.tour);

  const folded = useMemo(() => {
    if (anchor === null) return { nodes: [], edges: [] };
    return fold(ix, {
      roots: [anchor],
      expanded: new Set([anchor, ...expanded]),
      expandedGroups,
      showNoise,
      showExternal,
      showCore,
      pinned: new Set(highlight),
    });
  }, [ix, anchor, expanded, expandedGroups, showNoise, showExternal, showCore, highlight]);
  const highlighted = useMemo(() => new Set(highlight.map(declNodeId)), [highlight]);

  const { nodes, edges, positions, onNodesChange, byId, sizeOf, onMoveStart } = useLaidOutGraph(ix, folded, highlighted, anchor);
  const exportMap = async (kind: 'svg' | 'png') => {
    const pic = mapSvg(ix, folded, positions, sizeOf, currentPalette(), ix.data.project.title);
    if (kind === 'svg') return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pic.svg)}`;
    return svgToPng(pic.svg, pic.width, pic.height);
  };

  // Keyboard navigation.
  const container = useRef<HTMLDivElement>(null);
  // Center a card at a readable zoom (never zooming out to do it).
  const centerOn = useCallback(
    (id: number) => {
      const p = positions[declNodeId(id)];
      if (p) void flow.setCenter(p.x + CARD_WIDTH / 2, p.y + 60, { duration: 250, zoom: Math.max(flow.getZoom(), 0.8) });
    },
    [positions, flow],
  );
  // Each tour step is centered once its card is laid out.
  const tourCentered = useRef<string | null>(null);
  useEffect(() => {
    if (tour === null || focus === null) {
      tourCentered.current = null;
      return;
    }
    const key = `${tour}:${focus}`;
    if (tourCentered.current === key || !positions[declNodeId(focus)]) return;
    tourCentered.current = key;
    centerOn(focus);
  }, [tour, focus, positions, centerOn]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys on the toolbar, a card's buttons and links, or a form control belong to that control.
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t.closest('button, a, input, select, textarea, label, [role="toolbar"]')) return;
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
        if (s.pathFrom === null) {
          s.setPath(cur, null);
          s.setNotice(`Path from ${ix.decls[cur]!.title}: press p on a second result.`);
        } else {
          s.setPath(s.pathFrom, cur);
          s.setNotice(null);
          s.setView('paths');
        }
        break;
    }
  };

  // A selection made elsewhere (search, a link, Health, a statement) that this map does not show:
  // rebuild the map around it, or open the library card that holds it. Only a change of selection
  // does this, so "Back to main result" keeps the selection without jumping back.
  const lastFocus = useRef<number | null>(null);
  useEffect(() => {
    if (focus === lastFocus.current) return;
    lastFocus.current = focus;
    if (focus === null || byId.has(declNodeId(focus))) return;
    const d = ix.decls[focus];
    if (!d) return;
    const s = useStore.getState();
    if (d.external) {
      const holder = folded.nodes.find((n) => n.kind === 'external' && n.members?.includes(focus));
      if (holder && !s.expandedGroups.has(holder.id)) s.toggleGroup(holder.id);
      return;
    }
    if (ix.isNoise(focus) && !s.showNoise) return;
    s.setAnchor(focus, { replace: true });
  }, [focus, byId, folded, ix]);

  if (anchor === null) return <p className="empty">This project has no declarations to show.</p>;
  const focusDecl = focus !== null ? ix.decls[focus] : undefined;
  return (
    <div ref={container} className="map" tabIndex={0} onKeyDown={onKeyDown} aria-label="Dependency map. Arrow keys move between results, Enter expands, Escape collapses, f focuses the map here, p pins to the path finder.">
      <MapToolbar
        ix={ix}
        anchor={anchor}
        focusName={focusDecl?.title ?? null}
        onFit={() => void flow.fitView({ padding: 0.15, duration: 250 })}
        centerOn={centerOn}
        exportMap={exportMap}
      />
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
        edgesFocusable={false}
        onMoveStart={onMoveStart}
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

/**
 * The next ring "Show more around this" opens: the selection itself first; once it is open, the
 * not yet opened results it rests on (directly, or through opened results), at most 8 at a time.
 */
export function nextRing(ix: Indexes, focus: number, expanded: ReadonlySet<number>, max = 8): number[] {
  const opens = (id: number) => outlineChildren(ix, id).length > 0;
  if (ix.decls[focus]?.external) return [];
  if (!expanded.has(focus)) return opens(focus) ? [focus] : [];
  const out: number[] = [];
  const seen = new Set([focus]);
  let frontier = [focus];
  while (frontier.length && out.length < max) {
    const next: number[] = [];
    for (const id of frontier)
      for (const k of outlineChildren(ix, id)) {
        if (seen.has(k)) continue;
        seen.add(k);
        if (expanded.has(k)) next.push(k);
        else if (opens(k) && out.length < max) out.push(k);
      }
    frontier = next;
  }
  return out;
}

function minimapColor(ix: Indexes, n: MapNode): string {
  const s = n.kind === 'decl' ? statusOf(ix.decls[n.decl!]!) : worstStatus(ix, n.members ?? []);
  return s === 'sorry' ? '#d14b42' : s === 'axiom' ? '#d99a35' : s === 'external' ? '#9aa0aa' : '#4c9a6a';
}

function MapToolbar({
  ix,
  anchor,
  focusName,
  onFit,
  centerOn,
  exportMap,
}: {
  ix: Indexes;
  anchor: number;
  focusName: string | null;
  onFit: () => void;
  centerOn: (id: number) => void;
  exportMap: (kind: 'svg' | 'png') => Promise<string | null>;
}) {
  const s = useStore();
  const focus = s.focus;
  const roots = ix.data.project.roots;
  const ring = focus !== null ? nextRing(ix, focus, s.expanded) : [];
  return (
    <div className="map-toolbar" role="toolbar" aria-label="Map controls">
      {roots.length > 1 ? (
        <label className="toolbar-title">
          <span className="sr-only">Main result shown on the map</span>★{' '}
          <select
            className="control"
            value={roots.includes(anchor) ? String(anchor) : ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              s.setAnchor(id === roots[0] ? null : id);
              s.select(id);
            }}
            title={ix.decls[anchor]!.name}
          >
            {!roots.includes(anchor) && <option value="">{ix.decls[anchor]!.title}</option>}
            {roots.map((r) => (
              <option key={r} value={r}>
                {ix.decls[r]!.title} ({ix.decls[r]!.name.split('.').pop()})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="toolbar-title" title={ix.decls[anchor]!.name}>
          ★ {ix.decls[anchor]!.title}
        </span>
      )}
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
        disabled={ring.length === 0}
        title={focus === null ? 'Select a result first' : ring.length === 0 ? 'Everything around this result is already shown' : `Show what ${ring.length === 1 ? 'it rests on' : `${ring.length} more results rest on`}`}
        onClick={() => s.setExpanded([...s.expanded, ...ring])}
      >
        Show more around this
      </button>
      {anchor !== (roots[0] ?? null) && (
        <button className="icon-button" onClick={() => s.setAnchor(null)}>
          Back to main result
        </button>
      )}
      <label className="toggle">
        <input type="checkbox" checked={s.showExternal} onChange={(e) => s.setShowExternal(e.target.checked)} /> Other libraries
      </label>
      {s.showExternal && (
        <label className="toggle" title="Lean's own libraries: Init, Std, Lean">
          <input type="checkbox" checked={s.showCore} onChange={(e) => s.setShowCore(e.target.checked)} /> Lean core
        </label>
      )}
      {(s.noiseControls || s.showNoise) && (
        <label className="toggle">
          <input type="checkbox" checked={s.showNoise} onChange={(e) => s.setShowNoise(e.target.checked)} /> Generated helpers
        </label>
      )}
      <label className="toggle">
        <input type="checkbox" checked={s.showCode} onChange={(e) => s.setShowCode(e.target.checked)} /> Code in cards
      </label>
      <ExportButtons fileName={ix.data.project.title} make={exportMap} />
    </div>
  );
}

/** The legend; it can be folded away so it does not cover cards (remembered for this browser). */
function Legend() {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem('proofmap.legend') !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      window.localStorage.setItem('proofmap.legend', open ? 'closed' : 'open');
    } catch {
      // Not remembered.
    }
  };
  if (!open)
    return (
      <Panel position="bottom-left" className="map-legend folded">
        <button className="linklike" onClick={toggle} aria-expanded={false}>
          Legend
        </button>
      </Panel>
    );
  return (
    <Panel position="bottom-left" className="map-legend" aria-label="Legend">
      <button className="linklike legend-close" onClick={toggle} aria-expanded aria-label="Hide the legend">
        ×
      </button>
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
