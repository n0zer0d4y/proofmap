import Fixture.Basic
import Proofmap.Attr

/-!
# Tagged declarations

Uses the optional `@[proofmap ...]` attribute. The tags override the docstring summary, the
section step and the computed rank.
-/

namespace Fixture

/-- The docstring summary, which the attribute's summary overrides. -/
@[proofmap summary "Doubling never makes a number smaller", step "Tagged step", rank result]
theorem le_double (n : Nat) : n ≤ double n := by
  unfold double
  omega

-- The attribute's keywords are not reserved: these names stay usable.
def summary : Nat := 1
def step : Nat := 2
def rank : Nat := 3
def proofmap : Nat := 4

end Fixture

namespace Fixture

-- ════════════════════════════════════════
-- Banner section
-- ════════════════════════════════════════
/-- A docstring right under a banner belongs to the declaration, not to the section. -/
theorem double_one : double 1 = 2 := rfl

-- A comment above a one-shot command prefix and an attribute.
set_option linter.unusedVariables false in
@[simp]
theorem double_two : double 2 = 4 := rfl

end Fixture
