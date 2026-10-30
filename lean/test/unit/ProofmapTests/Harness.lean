/-! A minimal test harness: each check records a pass or a failure with a message. -/

namespace ProofmapTests

structure Results where
  passed : Nat := 0
  failures : Array String := #[]

abbrev TestM := StateT Results IO

def check (name : String) (ok : Bool) (detail : String := "") : TestM Unit :=
  modify fun r =>
    if ok then { r with passed := r.passed + 1 }
    else { r with failures := r.failures.push (if detail.isEmpty then name else s!"{name}: {detail}") }

def checkEq [BEq α] [Repr α] (name : String) (got want : α) : TestM Unit :=
  check name (got == want) s!"got {repr got}, expected {repr want}"

end ProofmapTests
