import type { Indexes } from '../data/indexes';
import { useStore, type ViewerState } from './store';

/**
 * Which cards on the map show what they rest on. The main result the map is built around is open
 * unless the reader closed it (its own flag, so links stay short); every other card is open when
 * the reader opened it. The card button, the keyboard and "Show more around this" all use these.
 */
export const mapAnchor = (ix: Indexes, anchor: number | null): number | null =>
  anchor ?? ix.data.project.roots[0] ?? ix.visible[0] ?? null;

type OpenState = Pick<ViewerState, 'anchor' | 'anchorClosed' | 'expanded'>;

export function isOpen(ix: Indexes, s: OpenState, id: number): boolean {
  return id === mapAnchor(ix, s.anchor) ? !s.anchorClosed : s.expanded.has(id);
}

export function openCards(ix: Indexes, s: OpenState): Set<number> {
  const anchor = mapAnchor(ix, s.anchor);
  return anchor === null || s.anchorClosed ? new Set(s.expanded) : new Set([anchor, ...s.expanded]);
}

export function toggleOpen(ix: Indexes, id: number): void {
  const s = useStore.getState();
  if (id === mapAnchor(ix, s.anchor)) s.setAnchorClosed(!s.anchorClosed);
  else s.toggleExpanded(id);
}

/** Open several cards at once (the main result through its flag). */
export function openAll(ix: Indexes, ids: Iterable<number>): void {
  const s = useStore.getState();
  const anchor = mapAnchor(ix, s.anchor);
  const all = [...ids];
  const rest = all.filter((id) => id !== anchor);
  if (rest.length !== all.length) s.setAnchorClosed(false);
  s.setExpanded([...s.expanded, ...rest]);
}
