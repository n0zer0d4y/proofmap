import { describe, expect, it } from 'vitest';
import { caseOf, closedGoals, diffAfter, diffBefore, duplicateBullets, subtreeOf, visibleSteps } from '../src/graph/goals';

describe('goal diffs', () => {
  const before = ['x y : Int\n⊢ { x := x + 0, y := y + 0 } = { x := x, y := y }'];
  it('marks changed goal lines', () => {
    const after = ['x y : Int\n⊢ { x := x, y := y } = { x := x, y := y }'];
    expect(diffAfter(before, after)[0]!.map((l) => l.state)).toEqual(['same', 'added']);
    expect(diffBefore(before, after)[0]!.map((l) => l.state)).toEqual(['same', 'removed']);
  });
  it('counts closed goals, ignoring new case names', () => {
    expect(closedGoals(before, [])).toBe(1);
    expect(closedGoals(['case left\n⊢ p', 'case right\n⊢ q'], ['case right\n⊢ q'])).toBe(1);
    expect(closedGoals(['⊢ p ∧ q'], ['case left\n⊢ p', 'case right\n⊢ q'])).toBe(0);
    expect(closedGoals(['⊢ p'], ['case h\n⊢ p'])).toBe(0);
    // A rewrite changes the goal; nothing is closed.
    expect(closedGoals(['⊢ f x = 1'], ['⊢ g x = 1'])).toBe(0);
    // One goal closed, the other changed.
    expect(closedGoals(['case a\n⊢ p', 'case b\n⊢ q x'], ['case b\n⊢ q y'])).toBe(1);
  });
});

describe('collapsing compound tactics', () => {
  // constructor; · exact hq (child); · exact hp (child)
  const depths = [0, 0, 1, 0, 1];
  it('shows everything when nothing is collapsed', () => {
    expect(visibleSteps(depths, new Set()).map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(visibleSteps(depths, new Set()).map((s) => s.hasChildren)).toEqual([false, true, false, true, false]);
  });
  it('hides the children of a collapsed step', () => {
    expect(visibleSteps(depths, new Set([1])).map((s) => s.index)).toEqual([0, 1, 3, 4]);
    expect(visibleSteps(depths, new Set([1, 3])).map((s) => s.index)).toEqual([0, 1, 3]);
  });
});

describe('walkthrough step list', () => {
  it('leaves out a bullet copy of its only tactic', () => {
    const tactics = ['induction n', '· exact ⟨0, rfl⟩', 'exact ⟨0, rfl⟩', '· simp', 'simp', 'omega'];
    const depths = [0, 1, 2, 1, 2, 2];
    // The second bullet has two children, so its copy stays.
    expect([...duplicateBullets(tactics, depths)]).toEqual([2]);
  });
  it('finds a step subtree and its case', () => {
    expect(subtreeOf([0, 1, 2, 1, 0], 1)).toEqual([2]);
    expect(subtreeOf([0, 1, 2, 1, 0], 0)).toEqual([1, 2, 3]);
    expect(caseOf(['case zero\n⊢ 0 = 0'])).toBe('zero');
    expect(caseOf(['⊢ 0 = 0'])).toBeNull();
  });
});
