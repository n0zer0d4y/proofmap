import Lean

/-!
# Axioms and `sorry`

A memoized version of `Lean.collectAxioms`: it follows the same edges and uses the same
cycle sentinel as Lean v4.35.0's implementation, but keeps one cache for the whole run,
so a project costs one walk of the environment. (On v4.29.0, `collectAxioms` re-walks all
dependencies on every call.) Results are sorted by name string, because the order
`collectAxioms` returns differs between toolchains.
-/

namespace Proofmap.Extract

open Lean

abbrev AxiomCache := Std.HashMap Name (Array Name)

private def sortNames (xs : Array Name) : Array Name :=
  xs.qsort fun a b => a.toString < b.toString

partial def axiomsOf (env : Environment) (c : Name) : StateM AxiomCache (Array Name) := do
  if let some axs := (← get)[c]? then return axs
  -- Sentinel against cycles (inductive types and their constructors refer to each other).
  modify (·.insert c #[])
  let (self, consts) : Array Name × Array Name := match env.find? c with
    | some (.axiomInfo v) => (#[c], v.type.getUsedConstants)
    | some (.defnInfo v) => (#[], v.type.getUsedConstants ++ v.value.getUsedConstants)
    | some (.thmInfo v) => (#[], v.type.getUsedConstants ++ v.value.getUsedConstants)
    | some (.opaqueInfo v) => (#[], v.type.getUsedConstants ++ v.value.getUsedConstants)
    | some (.ctorInfo v) => (#[], v.type.getUsedConstants)
    | some (.recInfo v) => (#[], v.type.getUsedConstants)
    | some (.inductInfo v) => (#[], v.type.getUsedConstants ++ v.ctors.toArray)
    | some (.quotInfo _) | none => (#[], #[])
  let mut acc : NameSet := self.foldl (·.insert ·) {}
  for d in consts do
    for a in (← axiomsOf env d) do
      acc := acc.insert a
  let result := sortNames acc.toArray
  modify (·.insert c result)
  return result

def defaultStandardAxioms : Array String := #["propext", "Classical.choice", "Quot.sound"]

/-- `(sorry, nonstandard)` for a sorted axiom list. -/
def classifyAxioms (standard : Array String) (axioms : Array Name) : Bool × Array String :=
  let names := axioms.map toString
  (names.contains "sorryAx", names.filter fun a => a != "sorryAx" && !standard.contains a)

end Proofmap.Extract
