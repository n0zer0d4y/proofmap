import ELK from 'elkjs/lib/elk.bundled.js';
import { elkGraph, positionsOf, type LayoutEdge, type LayoutNode, type Positions } from './elk-graph';

export type { LayoutEdge, LayoutNode, Positions } from './elk-graph';

/** Layout on the current thread with the bundled ELK. Used by the unit tests; the viewer lays out
 * in a Web Worker instead (see `client.ts`). */
let elk: InstanceType<typeof ELK> | null = null;

export async function layout(nodes: LayoutNode[], edges: LayoutEdge[], previous?: Positions): Promise<Positions> {
  elk ??= new ELK();
  return positionsOf(await elk.layout(elkGraph(nodes, edges, previous)));
}
