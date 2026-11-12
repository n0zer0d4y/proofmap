import Fixture.Basic

/-!
# Status cases

Declarations that exercise proofmap's status checks: `sorry`, a custom axiom, and flags.
-/

namespace Fixture

-- § Axioms and sorry

/-- A custom axiom: proofmap must flag it as non-standard. -/
axiom customAxiom : ∀ n : Nat, double n ≥ n

/-- Uses the custom axiom directly. -/
theorem uses_custom_axiom (n : Nat) : double n ≥ n := customAxiom n

/-- Uses the custom axiom through `uses_custom_axiom`. -/
theorem uses_custom_axiom_indirectly : double 3 ≥ 3 := uses_custom_axiom 3

/-- An unfinished proof. -/
theorem unfinished (n : Nat) : double n = n * 2 := by
  sorry

/-- Downstream of `unfinished`, so it contains `sorry` transitively. -/
theorem downstream_of_sorry : double 5 = 5 * 2 := unfinished 5

/-- Classical reasoning: uses only standard axioms. -/
theorem classical_fact (p : Prop) : p ∨ ¬p := Classical.em p

-- § Flags

private def hiddenHelper (n : Nat) : Nat := n + 1

/-- A public lemma about a private helper. -/
theorem hiddenHelper_pos (n : Nat) : 0 < hiddenHelper n := by
  unfold hiddenHelper
  omega

/-- Old name for `double`. -/
@[deprecated double (since := "2026-01-01")]
def twice (n : Nat) : Nat := double n

/-- Counts Collatz steps. It may not terminate, so it is `partial`. -/
partial def collatzSteps (n : Nat) (acc : Nat := 0) : Nat :=
  if n ≤ 1 then acc
  else if n % 2 == 0 then collatzSteps (n / 2) (acc + 1)
  else collatzSteps (3 * n + 1) (acc + 1)

/-- An unsafe definition. -/
unsafe def unsafeId (n : Nat) : Nat := n

/-- A safe definition implemented at runtime by an unsafe one. -/
@[implemented_by unsafeId]
def safeId (n : Nat) : Nat := n

/-- Sums a list by structural recursion: recursive, but neither partial nor unsafe. -/
def sumList : List Nat → Nat
  | [] => 0
  | x :: xs => x + sumList xs

/-- Counts halvings by well-founded recursion: recursive, but neither partial nor unsafe. -/
def halvings (n : Nat) : Nat :=
  if h : n ≤ 1 then 0 else 1 + halvings (n / 2)
termination_by n
decreasing_by omega

/-- A recursive type with derived equality: its generated `decEq` is recursive, not partial. -/
inductive Tree
  | leaf
  | node (l r : Tree)
  deriving DecidableEq

-- Nothing uses these two. The first is audited by a command below; the second is a private
-- leftover. Commands leave nothing in the compiled code, so proofmap reads them from the source.
theorem audited_only (n : Nat) : n + 0 = n := rfl
private theorem leftover_helper : True := trivial

#print axioms audited_only
#check @double
-- #print axioms in_a_comment

end Fixture
