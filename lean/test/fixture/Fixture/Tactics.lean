/-!
# Compound tactics

Proofs whose steps nest, for the proof walkthrough: focusing dots and `<;>`.
-/

namespace Fixture

/-- Each focused goal is closed separately. -/
theorem and_swap (p q : Prop) (hp : p) (hq : q) : q ∧ p := by
  constructor
  · exact hq
  · exact hp

/-- One tactic runs on every goal the first one leaves. -/
theorem two_goals (a : Nat) : a + 0 = a ∧ 0 + a = a := by
  constructor <;> omega

end Fixture
