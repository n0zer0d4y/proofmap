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
  -- Sanity checks give way to what they check.
  --   0: main       uses 1          (the real result, used only by its check)
  --   1: helper
  --   2: main_hyps_satisfiable  uses 0, 1   (unused, rests on more than main)
  let wDeps : Array (Array Nat) := #[#[1], #[], #[0, 1]]
  let wName (i : Nat) : String := #["Foo.main", "Foo.helper", "Foo.main_hyps_satisfiable"][i]!
  -- A check that gave way is not a main result itself: the theorem it checks stands for it.
  checkEq "auto roots: a check named as one gives way to the theorem it checks"
    (autoRoots wDeps (fun _ => true) wName) #[0]
  checkEq "auto roots: an undocumented check of a documented theorem gives way, whatever its name"
    (autoRoots wDeps (fun _ => true) (fun i => s!"Foo.d{i}") (documented := (· == 0))) #[0]
  -- A check whose theorem is used elsewhere too promotes nothing, so it stays, last.
  --   0: main (used by 1 and 2)   1: corollary (unused)   2: main_example (unused check)
  checkEq "auto roots: a check that promotes nothing is kept, after the results"
    (autoRoots #[#[], #[0], #[0]] (fun _ => true) (fun i => #["Foo.main", "Foo.cor", "Foo.main_example"][i]!)) #[1, 2]
  -- A documented main theorem whose proof is one big lemma keeps its place.
  checkEq "auto roots: a documented result proved by one lemma stays first"
    (autoRoots #[#[1], #[]] (fun _ => true) (fun i => s!"Foo.d{i}") (documented := fun _ => true)) #[0]
  -- Every area gets a main result: three heavy results in area A and one light one in area B.
  --   0..2: A, unused, each resting on 3 and 4;  5: B, unused, resting on nothing.
  let aDeps : Array (Array Nat) := #[#[3, 4], #[3, 4], #[3, 4], #[], #[], #[]]
  let aArea (i : Nat) : String := if i == 5 then "Proj.B" else "Proj.A"
  -- The top k stay, and an area left out adds its best result.
  checkEq "auto roots: an unrepresented area adds its best, keeping the top k"
    (autoRoots aDeps (fun i => i != 3 && i != 4) (fun i => s!"d{i}") (k := 2) (area := aArea)) #[0, 1, 5]
  checkEq "auto roots: without areas the heaviest win"
    (autoRoots aDeps (fun i => i != 3 && i != 4) (fun i => s!"d{i}") (k := 2)) #[0, 1]
  checkEq "auto roots: more areas than k shows one of each, up to maxK"
    (autoRoots #[#[], #[], #[]] (fun _ => true) (fun i => s!"d{i}") (k := 2) (area := fun i => s!"P.{i}")).size 3
  checkEq "looks like a check" ((["T_hyps_satisfiable", "Foo.bar_witness", "Foo.example", "Foo.sanity_check", "Foo.bound_nonvacuous", "Foo.hyps_nonvacuity"].map looksLikeCheck)) [true, true, true, true, true, true]
  checkEq "does not look like a check" ((["Foo.examples_are_dense", "Foo.check_correct", "Foo.testing_lemma"].map looksLikeCheck)) [false, false, false]
  checkEq "states a result: iff" (statesResult "Foo.bar_iff" none) true
  checkEq "states a result: reduction in the docstring" (statesResult "Foo.clique_to_indset" (some "Clique reduces to independent set.")) true
  checkEq "states a result: helper" (statesResult "Foo.aux_bound" (some "A bound used below.")) false
  checkEq "top-10% threshold" (topTenPercentThreshold (transitiveDependents deps) isThm) 4
  -- A cycle (rare in Lean) does not loop or crash.
  checkEq "cycle tolerated" (transitiveDependencies #[#[1], #[0]]).size 2

end ProofmapTests
