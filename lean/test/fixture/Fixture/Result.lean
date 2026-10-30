import Fixture.Basic
import Fixture.Status

/-!
# Main results

## Doubling

Results about `double`.

## Points

Results about points.
-/

namespace Fixture

-- ────────────── Doubling ──────────────

section Doubling

/-- Doubling is monotone. -/
theorem double_mono {a b : Nat} (h : a ≤ b) : double a ≤ double b := by
  simp only [double_eq_add]
  omega

-- A string containing "--" and "-/" must not confuse the comment scanner.
def trickyString : String := "-- not a comment -/ /- still not"

def trickyChar : Char := '-'

/-- Doubling twice is multiplying by four. -/
theorem double_double (n : Nat) : double (double n) = 4 * n := by
  rw [double_eq_add, double_eq_add]
  omega

end Doubling

-- ── Points ──

section Points

/-- Adding the origin changes nothing. -/
theorem add_origin (p : Point) : p + Point.origin = p := by
  obtain ⟨x, y⟩ := p
  show Point.mk (x + 0) (y + 0) = Point.mk x y
  rw [Int.add_zero, Int.add_zero]

namespace Geometry

/-- Taxicab distance from the origin. -/
def dist1 (p : Point) : Nat := p.x.natAbs + p.y.natAbs

/-- The origin is at distance zero from itself. -/
theorem dist1_origin : dist1 Point.origin = 0 := rfl

end Geometry

end Points

-- ==== Final results ====

/-- The main result of the fixture. It uses only standard axioms. -/
theorem main_result (n : Nat) (p : Point) :
    double (double n) = 4 * n ∧ p + Point.origin = p ∧ double n ≤ double (n + 1) :=
  ⟨double_double n, add_origin p, double_mono (Nat.le_succ n)⟩

/-- A result that is tainted twice: by `sorry` and by the custom axiom. -/
theorem tainted_result : double 5 = 5 * 2 ∧ double 3 ≥ 3 :=
  ⟨downstream_of_sorry, uses_custom_axiom_indirectly⟩

end Fixture
