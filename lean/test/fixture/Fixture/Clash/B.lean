/-!
# Clash B

The counterpart of `Fixture.Clash.A`: the same names, with a different `value`.
-/

namespace ClashDemo

/-- A value, defined differently in `Fixture.Clash.A`. -/
def value : Nat := 2

/-- Uses this module's `value`. -/
theorem value_pos : 0 < value := by decide

end ClashDemo
