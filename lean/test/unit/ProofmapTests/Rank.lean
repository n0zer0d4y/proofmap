import Proofmap.Extract.Rank
import ProofmapTests.Harness

/-! Roots and importance on a small hand-made graph. -/

namespace ProofmapTests

open Proofmap.Extract.Rank

/-
  0: main     uses 1, 2
  1: lemmaA   uses 3
  2: lemmaB   uses 3
  3: base
  4: side     uses 3        (unused theorem, fewer dependencies than main)
  5: defn     (not a theorem, unused)
-/
private def deps : Array (Array Nat) := #[#[1, 2], #[3], #[3], #[], #[3], #[]]
private def isThm (i : Nat) : Bool := i != 5
private def name (i : Nat) : String := s!"d{i}"

def rankTests : TestM Unit := do
  checkEq "transitive dependents" (transitiveDependents deps) #[0, 1, 1, 4, 0, 0]
  checkEq "transitive dependencies" (transitiveDependencies deps) #[3, 1, 1, 0, 1, 0]
  checkEq "auto roots: unused theorems by dependencies" (autoRoots deps isThm name) #[0, 4]
  checkEq "auto roots: top k" (autoRoots deps isThm name (k := 1)) #[0]
  -- A documented theorem comes before a larger undocumented one.
  checkEq "auto roots: documented first" (autoRoots deps isThm name (documented := (· == 4))) #[4, 0]
  -- Result wording doubles the weight, but a small lemma does not overtake a much larger result.
  checkEq "auto roots: headline wording weighs, size still counts" (autoRoots deps isThm name (headline := (· == 4))) #[0, 4]
  checkEq "states a result: iff" (statesResult "Foo.bar_iff" none) true
  checkEq "states a result: reduction in the docstring" (statesResult "Foo.clique_to_indset" (some "Clique reduces to independent set.")) true
  checkEq "states a result: helper" (statesResult "Foo.aux_bound" (some "A bound used below.")) false
  checkEq "top-10% threshold" (topTenPercentThreshold (transitiveDependents deps) isThm) 4
  -- A cycle (rare in Lean) does not loop or crash.
  checkEq "cycle tolerated" (transitiveDependencies #[#[1], #[0]]).size 2

end ProofmapTests
