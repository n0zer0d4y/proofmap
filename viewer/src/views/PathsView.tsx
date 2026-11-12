import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import { DeclSearch } from '../components/SearchBox';
import { StatusBadge } from '../components/StatusBadge';
import { twinModule, type Indexes } from '../data/indexes';
import { declNodeId, type Folded } from '../graph/fold';
import { findPaths, reachable, relation } from '../graph/paths';
import { isCoreLibrary, libraryOf } from '../data/library';
import { useStore } from '../state/store';
import { edgeTypes, IxContext, nodeTypes, useLaidOutGraph } from './MapView';

const NO_HIGHLIGHT: ReadonlySet<string> = new Set();

/** Where a declaration comes from, for ordering choices: this project, other libraries, Lean core. */
function origin(ix: Indexes, id: number): number {
  const d = ix.decls[id]!;
  return !d.external ? 0 : isCoreLibrary(libraryOf(d.module)) ? 2 : 1;
}

/** Choices for the other end of a path: the project's own first (Lean core last), main results
 * first, then nearest first, then by name. */
function ordered(ix: Indexes, m: Map<number, number> | null): number[] | undefined {
  if (!m) return undefined;
  const roots = new Set(ix.data.project.roots);
  return [...m.keys()].sort(
    (a, b) =>
      origin(ix, a) - origin(ix, b) ||
      Number(roots.has(b)) - Number(roots.has(a)) ||
      m.get(a)! - m.get(b)! ||
      ix.decls[a]!.name.localeCompare(ix.decls[b]!.name),
  );
}

/** Before anything is chosen: every project declaration that can start a path (something rests on
 * it), the most used first, and every one that can end a path (it rests on something), main
 * results first, then the ones resting on most. */
function startChoices(ix: Indexes): { from: number[]; to: number[] } {
  const users = (id: number) => new Set([...ix.usedBy.statement[id]!, ...ix.usedBy.proof[id]!].filter((u) => !ix.isNoise(u))).size;
  const uses = (id: number) => new Set([...ix.decls[id]!.deps.statement, ...ix.decls[id]!.deps.proof].filter((u) => !ix.isNoise(u))).size;
  const own = ix.visible.filter((id) => !ix.decls[id]!.external);
  const roots = new Set(ix.data.project.roots);
  const byName = (a: number, b: number) => ix.decls[a]!.name.localeCompare(ix.decls[b]!.name);
  return {
    from: own.filter((id) => users(id) > 0).sort((a, b) => users(b) - users(a) || byName(a, b)),
    to: own.filter((id) => uses(id) > 0).sort((a, b) => Number(roots.has(b)) - Number(roots.has(a)) || uses(b) - uses(a) || byName(a, b)),
  };
}

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
  // Dependent choices: once one end is chosen, the other box offers only ends that make a path
  // (nearest first, main results first among equals), so every pair it offers has an answer.
  const ups = useMemo(() => (from !== null ? reachable(ix, from, 'up') : null), [ix, from]);
  const downs = useMemo(() => (to !== null ? reachable(ix, to, 'down') : null), [ix, to]);
  const toChoices = useMemo(() => ordered(ix, ups), [ix, ups]);
  const start = useMemo(() => startChoices(ix), [ix]);
  const fromChoices = useMemo(() => ordered(ix, downs), [ix, downs]);
  const toAllowed = useMemo(() => (ups ? new Set(ups.keys()) : undefined), [ups]);
  const fromAllowed = useMemo(() => (downs ? new Set(downs.keys()) : undefined), [downs]);
  // Choosing one end keeps the other only when the pair still has a path.
  const chooseFrom = (id: number) => setPath(id, to !== null && reachable(ix, id, 'up').has(to) ? to : null);
  const chooseTo = (id: number) => setPath(from !== null && reachable(ix, id, 'down').has(from) ? from : null, id);
  return (
    <div className="paths">
      <div className="paths-form" role="group" aria-label="Choose two results">
        <label>
          <span className="paths-label">
            From (foundation)
            {fromChoices && (
              <span className="paths-hint">
                {fromChoices.length} lead to {name(to)!.title}
              </span>
            )}
          </span>
          <DeclSearch
            ix={ix}
            onChoose={chooseFrom}
            placeholder={name(from)?.title ?? 'Choose or search…'}
            label="Path from"
            allowed={fromAllowed}
            suggestions={fromChoices ?? start.from}
          />
        </label>
        <button className="icon-button" onClick={() => setPath(to, from)} aria-label="Swap from and to" disabled={from === null && to === null}>
          ⇄
        </button>
        <label>
          <span className="paths-label">
            To (result)
            {toChoices && (
              <span className="paths-hint">
                {toChoices.length} rest on {name(from)!.title}
              </span>
            )}
          </span>
          <DeclSearch
            ix={ix}
            onChoose={chooseTo}
            placeholder={name(to)?.title ?? 'Choose or search…'}
            label="Path to"
            allowed={toAllowed}
            suggestions={toChoices ?? start.to}
          />
        </label>
        <span className="paths-chosen">
          {from !== null && <ChosenName ix={ix} id={from} />} → {to !== null && <ChosenName ix={ix} id={to} />}
        </span>
        {(from !== null || to !== null) && (
          <button className="icon-button" onClick={() => setPath(null, null)}>
            Clear
          </button>
        )}
      </div>
      {from !== null && to === null && toChoices?.length === 0 && (
        <p className="empty">
          Nothing in this project rests on {name(from)!.title}, so no path starts there. Choose something it builds on instead, such as
          a definition or a lemma it uses.
        </p>
      )}
      {to !== null && from === null && fromChoices?.length === 0 && (
        <p className="empty">{name(to)!.title} rests on nothing else in this project, so no path ends there.</p>
      )}
      {from === null && to === null && (
        <p className="empty">
          Pick a foundation and a result, or press <kbd>p</kbd> on two cards in the map. Once one is chosen, the other box offers only
          choices that connect to it.
        </p>
      )}
      {((from !== null && to === null && (toChoices?.length ?? 0) > 0) || (to !== null && from === null && (fromChoices?.length ?? 0) > 0)) && (
        <p className="empty">Now choose the {from === null ? 'foundation' : 'result'}: click the box to see the choices.</p>
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
              Shortest chain ({shortest.length - 1} step{shortest.length === 2 ? '' : 's'});{' '}
              {paths.length >= 200 ? 'at least 200 chains (the 200 shortest are listed)' : `${paths.length} chain${paths.length === 1 ? '' : 's'} in all`}
            </h3>
            <ol>
              {shortest.slice(0, -1).map((id, i) => {
                const next = shortest[i + 1]!;
                return (
                  <li key={id}>
                    <StatusBadge decl={ix.decls[id]!} />{' '}
                    <button className="linklike" onClick={() => select(id)}>
                      {ix.decls[id]!.title}
                    </button>
                    <TwinNote ix={ix} id={id} />{' '}
                    {relation(ix, id, next) === 'proof' ? 'is used in the proof of' : 'appears in the statement of'}{' '}
                    <button className="linklike" onClick={() => select(next)}>
                      {ix.decls[next]!.title}
                    </button>
                    <TwinNote ix={ix} id={next} />
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
  const { nodes, edges, onNodesChange, ready } = useLaidOutGraph(ix, graph, NO_HIGHLIGHT, resetKey);
  return (
    <ReactFlow
      className={ready ? undefined : 'map-pending'}
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

/** A chosen end of the path: its Lean name, and its module when another declaration shares the name. */
function ChosenName({ ix, id }: { ix: Indexes; id: number }) {
  const twin = twinModule(ix, id);
  return (
    <span className="mono">
      {ix.decls[id]!.name}
      {twin && <span className="muted"> · {twin}</span>}
    </span>
  );
}

/** The module, in brackets, of a declaration whose name another declaration shares. */
function TwinNote({ ix, id }: { ix: Indexes; id: number }) {
  const twin = twinModule(ix, id);
  return twin ? <span className="muted"> ({twin})</span> : null;
}
