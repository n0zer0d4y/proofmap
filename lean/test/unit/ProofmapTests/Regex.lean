import Proofmap.Source.Regex
import ProofmapTests.Harness

/-! Regex engine tests (used for divider patterns). -/

namespace ProofmapTests

open Proofmap.Regex

private def groups (pat text : String) : Option (Array (Option String)) :=
  match compile pat with
  | .ok r => r.find? text
  | .error _ => none

private def compiles (pat : String) : Bool := (compile pat).toOption.isSome

/-- The default divider patterns. -/
def dividerA := "^--\\s*[─━=#*-]{2,}\\s*(.+?)\\s*[─━=#*-]*$"
def dividerB := "^-- (§|#)\\s*(.+)$"

def regexTests : TestM Unit := do
  checkEq "literal" (groups "abc" "xxabcxx") (some #[some "abc"])
  checkEq "anchored fails" (groups "^abc" "xabc") none
  checkEq "class range" (groups "[a-c]+" "zzbcaz") (some #[some "bca"])
  checkEq "negated class" (groups "[^ ]+" "  word  ") (some #[some "word"])
  checkEq "alternation group" (groups "(cat|dog)s" "hotdogs") (some #[some "dogs", some "dog"])
  checkEq "non-capturing group" (groups "(?:ab)+(c)" "ababc") (some #[some "ababc", some "c"])
  checkEq "counted" (groups "^a{2,3}$" "aaaa") none
  checkEq "counted ok" (groups "^a{2,3}$" "aaa") (some #[some "aaa"])
  checkEq "lazy" (groups "<(.+?)>" "<a><b>") (some #[some "<a>", some "a"])
  checkEq "greedy" (groups "<(.+)>" "<a><b>") (some #[some "<a><b>", some "a><b"])
  checkEq "\\s and \\d" (groups "^\\s*(\\d+)\\s*$" "  42 ") (some #[some "  42 ", some "42"])
  -- A real project's divider style and the default patterns.
  checkEq "divider ── title ──" (groups dividerA "-- ── The prime case ──")
    (some #[some "-- ── The prime case ──", some "The prime case"])
  checkEq "divider with long tail" ((groups dividerA "-- ── Counterexample ──────────────").bind (·[1]!))
    (some "Counterexample")
  checkEq "divider ====" ((groups dividerA "-- ==== Final results ====").bind (·[1]!)) (some "Final results")
  checkEq "divider keeps inner punctuation" ((groups dividerA "-- ── Bounds: a ≤ b (part 2) ──").bind (·[1]!))
    (some "Bounds: a ≤ b (part 2)")
  checkEq "ordinary comment is not a divider" (groups dividerA "-- A string containing \"--\" here") none
  checkEq "§ divider" ((groups dividerB "-- § Axioms and sorry").bind (·[2]!)) (some "Axioms and sorry")
  -- Errors.
  check "unbalanced paren rejected" (!compiles "(ab")
  check "bad escape rejected" (!compiles "\\q")
  check "dangling quantifier rejected" (!compiles "*a")
  check "default patterns compile" (compiles dividerA && compiles dividerB)

end ProofmapTests
