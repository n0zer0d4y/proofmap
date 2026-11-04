import { useEffect, useMemo } from 'react';
import type { Indexes } from '../data/indexes';
import { outlineChildren, tourSteps } from '../graph/outline';
import { useStore } from '../state/store';
import { MarkdownInline } from './Markdown';
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
  const { steps, pathTo } = useTour(ix);
  // Escape ends the tour, unless the reader is typing.
  useEffect(() => {
    if (tour === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) return;
      if (document.querySelector('dialog[open]')) return;
      end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour, end]);
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
      <div className="mono muted tour-name">{d.name}</div>
      <p className="plain">
        {d.summary ? (
          d.summary.source === 'section' ? (
            <>
              Part of “<MarkdownInline text={d.summary.text} />”.
            </>
          ) : (
            <MarkdownInline text={d.summary.text} />
          )
        ) : (
          'No description in the code.'
        )}
      </p>
      <p className="muted tour-hint">The statement and proof are in the details panel; the map shows the way here.</p>
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
