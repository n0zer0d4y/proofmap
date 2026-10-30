/-!
# Clash A

Declares names that `Fixture.Clash.B` also declares, so the two modules cannot be imported
together. The library still builds them, through the glob in the lakefile. Real
projects can have the same structure.
-/

namespace ClashDemo

/-- A value, defined differently in `Fixture.Clash.B`. -/
def value : Nat := 1

/-- Uses this module's `value`. -/
theorem value_pos : 0 < value := by decide

end ClashDemo
