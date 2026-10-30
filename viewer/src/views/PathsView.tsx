import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import { DeclSearch } from '../components/SearchBox';
import { StatusBadge } from '../components/StatusBadge';
import type { Indexes } from '../data/indexes';
import { declNodeId, type Folded } from '../graph/fold';
import { findPaths, relation } from '../graph/paths';
import { useStore } from '../state/store';
import { edgeTypes, IxContext, nodeTypes, useLaidOutGraph } from './MapView';

const NO_HIGHLIGHT: ReadonlySet<string> = new Set();

/** Path finder: how does one result lead to another? Every chain within the
 * length cap is shown as a filtered map, and the shortest one as a numbered list in plain words. */
export function PathsView({ ix }: { ix: Indexes }) {
  const from = useStore((s) => s.pathFrom);
  const to = useStore((s) => s.pathTo);
  const setPath = useStore((s) => s.setPath);
  const select = useStore((s) => s.select);
  const paths = useMemo(() => (from !== null && to !== null ? findPaths(ix, from, to) : []), [ix, from, to]);
  const reverse = useMemo(
    () => (from !== null && to !== null && paths.length === 0 ? findPaths(ix, to, from, 8, 1).length : 0),
    [ix, from, to, paths],
  );
  const graph: Folded = useMemo(() => {
    const ids = new Set(paths.flat());
    const edges = new Map<string, Folded['edges'][number]>();
    for (const p of paths)
      for (let i = 0; i + 1 < p.length; i++) {
        const source = declNodeId(p[i]!), target = declNodeId(p[i + 1]!);
        edges.set(`${source}->${target}`, { id: `${source}->${target}`, source, target, kind: relation(ix, p[i]!, p[i + 1]!), viaNoise: false });
      }
    return { nodes: [...ids].map((id) => ({ id: declNodeId(id), kind: 'decl' as const, decl: id, label: ix.decls[id]!.title })), edges: [...edges.values()] };
  }, [ix, paths]);
  const shortest = paths[0];
  const name = (id: number | null) => (id === null ? null : ix.decls[id]!);
  return (
    <div className="paths">
      <div className="paths-form" role="group" aria-label="Choose two results">
        <label>
          From (foundation)
          <DeclSearch ix={ix} onChoose={(id) => setPath(id, to)} placeholder={name(from)?.title ?? 'Search…'} label="Path from" />
        </label>
        <button className="icon-button" onClick={() => setPath(to, from)} aria-label="Swap from and to" disabled={from === null && to === null}>
          ⇄
        </button>
        <label>
          To (result)
          <DeclSearch ix={ix} onChoose={(id) => setPath(from, id)} placeholder={name(to)?.title ?? 'Search…'} label="Path to" />
        </label>
        <span className="paths-chosen">
          {name(from) && <span className="mono">{name(from)!.name}</span>} → {name(to) && <span className="mono">{name(to)!.name}</span>}
        </span>
      </div>
      {(from === null || to === null) && (
        <p className="empty">Pick a foundation and a result, or press <kbd>p</kbd> on two cards in the map.</p>
      )}
      {from !== null && to !== null && paths.length === 0 && (
        <p className="empty">
          {ix.decls[to]!.title} does not rest on {ix.decls[from]!.title} (within 8 steps).
          {reverse > 0 && (
            <>
              {' '}
              It is the other way round:{' '}
              <button className="linklike" onClick={() => setPath(to, from)}>
                swap
              </button>
              .
            </>
          )}
        </p>
      )}
      {shortest && (
        <>
          <section className="paths-summary" aria-label="Shortest chain">
            <h3>
              Shortest chain ({shortest.length - 1} step{shortest.length === 2 ? '' : 's'}); {paths.length} chain{paths.length === 1 ? '' : 's'} in all
              {paths.length >= 200 ? ' (first 200)' : ''}
            </h3>
            <ol>
              {shortest.slice(0, -1).map((id, i) => {
                const next = shortest[i + 1]!;
                return (
                  <li key={id}>
                    <StatusBadge decl={ix.decls[id]!} />{' '}
                    <button className="linklike" onClick={() => select(id)}>
                      {ix.decls[id]!.title}
                    </button>{' '}
                    {relation(ix, id, next) === 'proof' ? 'is used in the proof of' : 'appears in the statement of'}{' '}
                    <button className="linklike" onClick={() => select(next)}>
                      {ix.decls[next]!.title}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
          <div className="paths-canvas">
            <IxContext.Provider value={ix}>
              <ReactFlowProvider>
                <PathCanvas ix={ix} graph={graph} resetKey={`${from}-${to}`} />
              </ReactFlowProvider>
            </IxContext.Provider>
          </div>
        </>
      )}
    </div>
  );
}

function PathCanvas({ ix, graph, resetKey }: { ix: Indexes; graph: Folded; resetKey: string }) {
  const select = useStore((s) => s.select);
  const { nodes, edges, onNodesChange } = useLaidOutGraph(ix, graph, NO_HIGHLIGHT, resetKey);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, n) => {
        const id = Number(n.id.slice(1));
        if (!Number.isNaN(id)) select(id);
      }}
      nodesDraggable={false}
      nodesConnectable={false}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    />
  );
}
