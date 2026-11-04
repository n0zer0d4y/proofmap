import { useEffect, useMemo, useState } from 'react';
import { CodeBlock } from '../components/CodeBlock';
import { StatusBadge } from '../components/StatusBadge';
import { useWalkthroughSteps } from '../data/chunks';
import type { Indexes } from '../data/indexes';
import { caseOf, closedGoals, diffAfter, diffBefore, duplicateBullets, subtreeOf, visibleSteps, type GoalLine } from '../graph/goals';
import { useStore } from '../state/store';

const VIEW_NAMES = { map: 'map', outline: 'outline', paths: 'path finder', health: 'health view', compare: 'comparison' } as const;

/**
 * Proof walkthrough: the proof's source with the current tactic highlighted
 * on the left, the goals before and after it on the right (changed lines highlighted, closed
 * goals marked), and controls to step through: back / next (← →), a timeline scrubber, a step
 * list to jump, and collapsing of compound tactics.
 */
export function WalkthroughView({ ix, id }: { ix: Indexes; id: number }) {
  const d = ix.decls[id]!;
  const setWalkthrough = useStore((s) => s.setWalkthrough);
  const view = useStore((s) => s.view);
  const w = d.walkthrough !== null ? ix.data.walkthroughs[d.walkthrough] : undefined;
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(0);
  const loaded = useWalkthroughSteps(w, d.name);
  const steps = useMemo(() => (loaded.state === 'ready' ? loaded.steps : []), [loaded]);
  const depths = useMemo(() => steps.map((s) => s.depth), [steps]);
  // A bullet's copy of its only tactic is left out; its children move up under the bullet.
  const items = useMemo(() => {
    const dup = duplicateBullets(
      steps.map((s) => s.tactic),
      depths,
    );
    const kept = steps.map((_, i) => i).filter((i) => !dup.has(i));
    const lifted = kept.map((i) => depths[i]! - [...dup].filter((j) => j < i && subtreeOf(depths, j).includes(i)).length);
    const collapsedAt = new Set(kept.flatMap((i, p) => (collapsed.has(i) ? [p] : [])));
    return visibleSteps(lifted, collapsedAt).map((it) => ({ ...it, index: kept[it.index]! }));
  }, [steps, depths, collapsed]);
  const pos = Math.max(0, items.findIndex((it) => it.index === current));
  const go = (p: number) => {
    const it = items[Math.min(Math.max(p, 0), items.length - 1)];
    if (it) setCurrent(it.index);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      // Keys meant for a dialog (About, the tour) stay there.
      if (t?.closest('dialog, [role="dialog"]') || document.querySelector('dialog[open]')) return;
      if (e.key === 'ArrowRight') go(pos + 1);
      else if (e.key === 'ArrowLeft') go(pos - 1);
      else if (e.key === 'Escape' && useStore.getState().tour === null) setWalkthrough(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const back = (
    <button className="icon-button" onClick={() => setWalkthrough(false)}>
      ← Back to the {VIEW_NAMES[view]}
    </button>
  );
  if (!w || steps.length === 0) {
    const reason =
      loaded.state === 'loading'
        ? 'Loading the proof steps…'
        : loaded.state === 'error'
          ? loaded.message
          : ix.data.walkthroughs.length === 0
            ? 'Walkthroughs were not built for this page (proofmap build --walkthrough adds them).'
            : 'This proof is a single term: there are no tactic steps to walk through.';
    return (
      <div className="walkthrough">
        <div className="wt-head">
          {back} <strong>{d.title}</strong>
        </div>
        <p className="empty" role={loaded.state === 'error' ? 'alert' : undefined}>
          {reason}
        </p>
        {d.code && <CodeBlock code={d.code} firstLine={d.range?.start[0] ?? 1} />}
      </div>
    );
  }
  const step = steps[current]!;
  const closed = closedGoals(step.goalsBefore, step.goalsAfter);
  return (
    <div className="walkthrough" aria-label={`Walkthrough of ${d.name}`}>
      <div className="wt-head">
        {back}
        <StatusBadge decl={d} /> <strong>{d.title}</strong> <span className="mono muted">{d.name}</span>
        <span className="spacer" />
        <button className="icon-button" onClick={() => go(pos - 1)} disabled={pos === 0} aria-label="Previous step">
          ←
        </button>
        <span className="wt-count" aria-live="polite">
          Step {pos + 1} of {items.length}
        </span>
        <button className="icon-button" onClick={() => go(pos + 1)} disabled={pos === items.length - 1} aria-label="Next step">
          →
        </button>
      </div>
      <input
        className="wt-scrubber"
        type="range"
        min={0}
        max={items.length - 1}
        value={pos}
        onChange={(e) => go(Number(e.target.value))}
        aria-label="Timeline of the proof steps"
      />
      <div className="wt-body">
        <div className="wt-source">
          {d.code && (
            <CodeBlock
              code={d.code}
              firstLine={d.range?.start[0] ?? 1}
              highlight={{ from: step.range.start[0], to: step.range.end[0] }}
              label={`Lean code of ${d.name}`}
            />
          )}
          <ol className="wt-steps" aria-label="Steps">
            {items.map((it, p) => {
              const s = steps[it.index]!;
              // The case a step works on, shown where it changes.
              const kase = caseOf(s.goalsBefore);
              const prevCase = p > 0 ? caseOf(steps[items[p - 1]!.index]!.goalsBefore) : null;
              return (
                <li key={it.index} style={{ paddingLeft: 8 + it.depth * 16 }} className={it.index === current ? 'current' : undefined}>
                  {it.hasChildren ? (
                    <button
                      className="chevron"
                      aria-label={collapsed.has(it.index) ? 'Expand compound tactic' : 'Collapse compound tactic'}
                      onClick={() => {
                        const closing = !collapsed.has(it.index);
                        setCollapsed((c) => {
                          const n = new Set(c);
                          if (n.has(it.index)) n.delete(it.index);
                          else n.add(it.index);
                          return n;
                        });
                        // Collapsing the step that holds the current one makes it current.
                        if (closing && subtreeOf(depths, it.index).includes(current)) setCurrent(it.index);
                      }}
                    >
                      {collapsed.has(it.index) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="chevron" aria-hidden="true" />
                  )}
                  {kase && kase !== prevCase && <span className="wt-case">case {kase}</span>}
                  <button className="linklike mono" onClick={() => go(p)} aria-current={it.index === current ? 'step' : undefined}>
                    {s.tactic.split('\n')[0]}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="wt-goals">
          <h3>
            Tactic <code>{step.tactic.split('\n')[0]}</code>
          </h3>
          <section aria-label="Goals before">
            <h4>Before ({step.goalsBefore.length} goal{step.goalsBefore.length === 1 ? '' : 's'})</h4>
            <Goals goals={diffBefore(step.goalsBefore, step.goalsAfter)} />
          </section>
          <section aria-label="Goals after">
            <h4>After ({step.goalsAfter.length} goal{step.goalsAfter.length === 1 ? '' : 's'})</h4>
            {closed > 0 && (
              <p className="goal-closed status status-ok">
                ✓ {closed === 1 ? 'goal closed' : `${closed} goals closed`}
              </p>
            )}
            {step.goalsAfter.length === 0 ? (
              // Lean lists only the goals in focus, so an empty list after a case means that case is
              // done; the proof is complete only after its last step.
              <p className="muted plain">
                {steps.some((_, j) => j > current && !subtreeOf(depths, current).includes(j))
                  ? 'This case is done; the proof continues with the next step.'
                  : 'No goals left: the proof is complete.'}
              </p>
            ) : (
              <Goals goals={diffAfter(step.goalsBefore, step.goalsAfter)} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Goals({ goals }: { goals: GoalLine[][] }) {
  return (
    <>
      {goals.map((g, i) => (
        <pre className="goal" key={i}>
          {g.map((l, j) => (
            <span key={j} className={`goal-line ${l.state}`}>
              {l.state === 'added' ? '+ ' : l.state === 'removed' ? '− ' : '  '}
              {l.text}
              {'\n'}
            </span>
          ))}
        </pre>
      ))}
    </>
  );
}
