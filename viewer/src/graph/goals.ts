/**
 * Goal diffs for the walkthrough: which hypotheses and goal lines a tactic
 * added or removed, and which goals it closed. Goals are matched by their text without the
 * `case` line, so a goal that only got a new case name is not shown as changed.
 */
export type LineState = 'same' | 'added' | 'removed';

export interface GoalLine {
  text: string;
  state: LineState;
}

const lines = (goal: string) => goal.split('\n');
const body = (goal: string) => lines(goal).filter((l) => !l.startsWith('case ')).join('\n');

/** Lines of each "after" goal, marked `added` when they were in no "before" goal. */
export function diffAfter(before: string[], after: string[]): GoalLine[][] {
  const old = new Set(before.flatMap(lines));
  return after.map((g) => lines(g).map((text) => ({ text, state: old.has(text) ? 'same' : 'added' })));
}

/** Lines of each "before" goal, marked `removed` when they are in no "after" goal. */
export function diffBefore(before: string[], after: string[]): GoalLine[][] {
  const next = new Set(after.flatMap(lines));
  return before.map((g) => lines(g).map((text) => ({ text, state: next.has(text) ? 'same' : 'removed' })));
}

/** How many of the "before" goals the step closed: those gone afterwards, less the goals that are
 * new afterwards (a goal the step changed, as `rw` does, is replaced, not closed). */
export function closedGoals(before: string[], after: string[]): number {
  const remaining = new Set(after.map(body));
  const previous = new Set(before.map(body));
  const gone = before.filter((g) => !remaining.has(body(g))).length;
  const added = after.filter((g) => !previous.has(body(g))).length;
  return Math.max(0, gone - added);
}

export interface StepItem {
  index: number;
  depth: number;
  hasChildren: boolean;
}

/**
 * Steps that only repeat their parent: a bullet `· t` whose single child is `t` itself. The child is
 * left out of the step list, and its own children move up one level under the bullet.
 */
export function duplicateBullets(tactics: string[], depths: number[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i + 1 < tactics.length; i++) {
    const t = tactics[i]!.trimStart();
    if (!t.startsWith('·') || depths[i + 1] !== depths[i]! + 1) continue;
    if (tactics[i + 1]!.trim() !== t.slice(1).trim()) continue;
    // Single child: no other step one level below the bullet before the bullet's subtree ends.
    let single = true;
    for (let j = i + 2; j < depths.length && depths[j]! > depths[i]!; j++) if (depths[j] === depths[i]! + 1) single = false;
    if (single) out.add(i + 1);
  }
  return out;
}

/** The step indices inside the subtree of step `i` (its children, their children, …). */
export function subtreeOf(depths: number[], i: number): number[] {
  const out: number[] = [];
  for (let j = i + 1; j < depths.length && depths[j]! > depths[i]!; j++) out.push(j);
  return out;
}

/** The case a step works on (`zero` for a goal starting `case zero`), or null. */
export function caseOf(goalsBefore: string[]): string | null {
  const first = goalsBefore[0]?.split('\n')[0] ?? '';
  return first.startsWith('case ') ? first.slice(5).trim() : null;
}

/** The steps that are visible when the given compound steps are collapsed. */
export function visibleSteps(depths: number[], collapsed: ReadonlySet<number>): StepItem[] {
  const out: StepItem[] = [];
  let hideBelow: number | null = null;
  depths.forEach((depth, index) => {
    if (hideBelow !== null && depth > hideBelow) return;
    hideBelow = null;
    const hasChildren = (depths[index + 1] ?? -1) > depth;
    out.push({ index, depth, hasChildren });
    if (hasChildren && collapsed.has(index)) hideBelow = depth;
  });
  return out;
}
