import Lean

/-!
# Statement and proof dependencies

`statement` = constants in the type; `proof` = constants in the value that are not already
statement dependencies. For an inductive type the statement also covers its constructors'
types. Self-references are removed.
-/

namespace Proofmap.Extract

open Lean

private def dedup (self : Name) (exclude : Array Name) (xs : Array Name) : Array Name := Id.run do
  let mut seen : NameSet := {}
  let mut out := #[]
  for x in xs do
    unless x == self || exclude.contains x || seen.contains x do
      seen := seen.insert x
      out := out.push x
  return out

/-- Constants used by an expression. The arguments of `sorryAx` (its type and the name tag
Lean stores for the `sorry`) are not dependencies, so only `sorryAx` itself is kept. -/
def usedConstants (e : Expr) : Array Name :=
  let e := e.replace fun s => if s.isAppOf ``sorryAx then some (mkConst ``sorryAx) else none
  e.getUsedConstants

/-- Direct `(statement, proof)` dependencies of a constant, by name. -/
def directDeps (env : Environment) (n : Name) (ci : ConstantInfo) : Array Name × Array Name :=
  let (stmt, ctors) := match ci with
    | .inductInfo v =>
      let ctorTypes := v.ctors.toArray.filterMap fun c => (env.find? c).map (usedConstants ·.type)
      (usedConstants ci.type ++ ctorTypes.flatten, v.ctors.toArray)
    | _ => (usedConstants ci.type, #[])
  let stmt := dedup n ctors stmt
  let proof := match ci with
    | .thmInfo v => usedConstants v.value
    | .defnInfo v => usedConstants v.value
    | _ => #[]
  (stmt, dedup n stmt proof)

/--
Collapse dependencies through hidden (noise) project declarations. `direct` holds the direct
`(statement, proof)` ids of every declaration; `hiddenProject id` says whether a declaration is
a noise declaration of the project, whose own dependencies replace it. Other noise (external)
is dropped from the collapsed lists but stays in `directDeps`.
-/
partial def collapse (direct : Array (Array Nat × Array Nat)) (hiddenProject : Nat → Bool)
    (hiddenExternal : Nat → Bool) : Array (Array Nat × Array Nat) := Id.run do
  -- Visible replacement set for each hidden project declaration, memoized.
  let mut memo : Std.HashMap Nat (Array Nat) := {}
  let rec expand (memo : Std.HashMap Nat (Array Nat)) (visiting : List Nat) (id : Nat) :
      Array Nat × Std.HashMap Nat (Array Nat) := Id.run do
    if let some r := memo[id]? then return (r, memo)
    if visiting.contains id then return (#[], memo)
    let (s, p) := direct[id]!
    let mut out : Array Nat := #[]
    let mut memo := memo
    for t in s ++ p do
      if t == id then continue
      if hiddenProject t then
        let (r, memo') := expand memo (id :: visiting) t
        memo := memo'
        out := out ++ r
      else if !hiddenExternal t then
        out := out.push t
    let uniq := out.foldl (fun acc x => if acc.contains x then acc else acc.push x) #[]
    return (uniq, memo.insert id uniq)
  let mut result := #[]
  for h : id in [0:direct.size] do
    let (s, p) := direct[id]
    let mut stmt : Array Nat := #[]
    let mut proof : Array Nat := #[]
    for t in s do
      if hiddenProject t then
        let (r, memo') := expand memo [id] t
        memo := memo'
        stmt := stmt ++ r
      else if !hiddenExternal t then stmt := stmt.push t
    for t in p do
      if hiddenProject t then
        let (r, memo') := expand memo [id] t
        memo := memo'
        proof := proof ++ r
      else if !hiddenExternal t then proof := proof.push t
    let uniq (xs : Array Nat) := xs.foldl (fun acc x => if acc.contains x || x == id then acc else acc.push x) #[]
    let stmtIds := uniq stmt
    let proofIds := (uniq proof).filter (!stmtIds.contains ·)
    result := result.push (stmtIds, proofIds)
  return result

end Proofmap.Extract
