import { useMemo } from 'react';
import type { Indexes } from '../data/indexes';
import { outlineChildren, tourSteps } from '../graph/outline';
import { useStore } from '../state/store';
import { Statement } from './Statement';
import { StatusBadge } from './StatusBadge';

/**
 * Guided tour: "Walk me through it" steps from the main result down through
 * the big steps, one result at a time, in outline order, with a narration built from summaries.
 * Each step selects the result and, on the map, expands the way to it.
 */
export function useTour(ix: Indexes) {
  const roots = ix.data.project.roots;
  return useMemo(() => {
    const steps = tourSteps(ix, roots);
    // The outline parent of each step, to open the way to it on the map.
    const parent = new Map<number, number>();
    for (const s of steps) for (const k of outlineChildren(ix, s)) if (!parent.has(k) && steps.includes(k)) parent.set(k, s);
    const pathTo = (id: number) => {
      const out = [id];
      for (let p = parent.get(id); p !== undefined; p = parent.get(p)) out.unshift(p);
      return out;
    };
    return { steps, pathTo };
  }, [ix, roots]);
}

export function TourPanel({ ix }: { ix: Indexes }) {
  const tour = useStore((s) => s.tour);
  const goTo = useStore((s) => s.tourGo);
  const end = useStore((s) => s.tourEnd);
  const select = useStore((s) => s.select);
  const { steps, pathTo } = useTour(ix);
  if (tour === null || !steps.length) return null;
  const id = steps[tour]!;
  const d = ix.decls[id]!;
  const go = (i: number) => goTo(i, pathTo(steps[i]!));
  return (
    <div className="tour" role="dialog" aria-label="Guided tour" aria-live="polite">
      <div className="tour-head">
        <span className="muted">
          Step {tour + 1} of {steps.length}
        </span>
        <button className="linklike" onClick={end} aria-label="End the tour">
          ✕
        </button>
      </div>
      <h3>
        <StatusBadge decl={d} withText={false} /> {d.title}
      </h3>
      <p className="plain">
        {d.summary ? (d.summary.source === 'section' ? `Part of “${d.summary.text}”.` : d.summary.text) : 'No description in the code.'}
      </p>
      <Statement decl={d} ix={ix} onSelect={select} />
      <div className="tour-nav">
        <button className="icon-button" onClick={() => go(tour - 1)} disabled={tour === 0}>
          ← Back
        </button>
        <button className="icon-button" onClick={() => (tour + 1 < steps.length ? go(tour + 1) : end())}>
          {tour + 1 < steps.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    </div>
  );
}
