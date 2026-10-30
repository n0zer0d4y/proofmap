import ELK from 'elkjs/lib/elk-api.js';
// ELK's own worker script, as text: started from a Blob URL, because a page opened from file://
// cannot load a separate worker file. (Not `?worker&inline`, which would base64-encode it.)
import workerSource from 'elkjs/lib/elk-worker.min.js?raw';
import { elkGraph, positionsOf, type LayoutEdge, type LayoutNode, type Positions } from './elk-graph';

/** Layout always runs in a Web Worker, so the UI never freezes. Only the
 * latest request's answer is used. */
let elk: InstanceType<typeof ELK> | null = null;
let seq = 0;

function getElk(): InstanceType<typeof ELK> {
  if (!elk) {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    elk = new ELK({ workerFactory: () => new Worker(url) });
  }
  return elk;
}

/** Lay out the graph; resolves to `null` when a newer request has superseded this one. */
export async function requestLayout(nodes: LayoutNode[], edges: LayoutEdge[], previous?: Positions): Promise<Positions | null> {
  const mine = ++seq;
  const start = performance.now();
  const result = await getElk().layout(elkGraph(nodes, edges, previous));
  // Recorded for the performance checks.
  performance.measure('proofmap:layout', { start, detail: { nodes: nodes.length } });
  return mine === seq ? positionsOf(result) : null;
}
