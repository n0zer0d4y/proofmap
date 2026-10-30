/-!
# Basic definitions

The building blocks of the fixture: a colour type, points and doubling.
Every declaration here is listed in `expected/manifest.json`.
-/

namespace Fixture

-- ── Data types ──

/-- Three colours, used to test inductive types and their constructors. -/
inductive Color where
  | red
  | green
  | blue

/-- A point in the integer plane. -/
structure Point where
  x : Int
  y : Int

/-- Points add coordinate-wise. -/
instance instAddPoint : Add Point where
  add p q := ⟨p.x + q.x, p.y + q.y⟩

/-- The origin. -/
def Point.origin : Point := ⟨0, 0⟩

/-- A short name for pairs of natural numbers. -/
abbrev NatPair := Nat × Nat

-- Picks a colour for a number. A definition by pattern matching,
-- so Lean generates a matcher for it.
def colorOf : Nat → Color
  | 0 => .red
  | 1 => .green
  | _ => .blue

/- A plain block comment above a definition. /- With a nested block comment. -/
   The leading comment covers this whole block. -/
def double (n : Nat) : Nat := 2 * n

/-- An opaque constant: its value is hidden. -/
opaque secretNumber : Nat

-- ── Facts ──

/-- Doubling is adding a number to itself. Proved with tactics. -/
theorem double_eq_add (n : Nat) : double n = n + n := by
  unfold double
  omega

/-- Doubling is multiplying by two, by definition. -/
theorem double_eq_add' (n : Nat) : double n = 2 * n := rfl

/-- Only zero doubles to zero. -/
theorem double_eq_zero_iff (n : Nat) : double n = 0 ↔ n = 0 := by
  unfold double
  omega

/-- The origin's first coordinate is zero. A term-mode proof. -/
theorem origin_x : Point.origin.x = 0 := rfl

-- The colour of zero is red, by computation.
theorem colorOf_zero : colorOf 0 = .red := rfl

-- This comment is separated from the next declaration by two blank lines,
-- so it must not be attached to it.


theorem double_zero : double 0 = 0 := by
  simp [double]

end Fixture
