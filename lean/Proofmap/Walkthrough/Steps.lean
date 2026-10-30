import Lean

/-!
# Tactic steps from InfoTrees

Walks the InfoTrees of an elaborated file and keeps every tactic a reader would see as one step:

- a `TacticInfo` node whose syntax has an original source position (macro expansions and other
  synthetic syntax have none, so they are skipped, but their children are still visited);
- that is not a sequencing wrapper (`tacticSeq`, `by`, `null` nodes ...);
- whose source range differs from the enclosing step's (an expansion that reuses the original
  syntax would otherwise appear twice).

A step nested inside another step (the tactics under `·`, the parts of `t <;> s`, a `case`
block ...) gets the enclosing step's depth + 1, so the viewer can collapse compound tactics.
Goals before and after are pretty-printed one goal at a time with `ContextInfo.ppGoals`, using the
metavariable context of the moment, so hypotheses are included.
-/

namespace Proofmap.Walkthrough

open Lean Elab

structure RawStep where
  /-- Start and end as (line, column), 1-based line, 0-based column in code points. -/
  start : Position
  stop : Position
  depth : Nat
  goalsBefore : Array String
  goalsAfter : Array String
  deriving Inhabited

/-- Syntax kinds that only group tactics; their children are the steps. -/
def wrapperKinds : List Name :=
  [`Lean.Parser.Tactic.tacticSeq, `Lean.Parser.Tactic.tacticSeq1Indented,
   `Lean.Parser.Tactic.tacticSeqBracketed, `Lean.Parser.Term.byTactic,
   `Lean.Parser.Term.byTactic', `Lean.Parser.Tactic.seq1, `null]

/-- Not a step of its own: a bare token (the `by` keyword, the closing bracket `rw` reuses for
its follow-up `rfl`) or the node around the focusing dot. One-word tactics such as `sorry`,
`rfl` or `assumption` are nodes around a single token too, so only the dot is matched. -/
private def isStepSyntax (stx : Syntax) : Bool :=
  let dot := stx.getNumArgs == 1 && stx[0].isAtom && (stx[0].getAtomVal == "·" || stx[0].getAtomVal == ".")
  !stx.isAtom && !dot && !wrapperKinds.contains stx.getKind

private def ppEach (ctx : ContextInfo) (mctx : MetavarContext) (goals : List MVarId) : IO (Array String) := do
  let ctx := { ctx with mctx }
  goals.toArray.mapM fun g => do
    return ((← ctx.ppGoals [g]).pretty 100).trimAscii.toString

/-- All steps in an InfoTree, in source order of their discovery (pre-order). -/
partial def collect (fileMap : FileMap) (ctx? : Option ContextInfo) (parent : Option (String.Pos.Raw × String.Pos.Raw))
    (depth : Nat) (t : InfoTree) : StateT (Array RawStep) IO Unit := do
  match t with
  | .context pctx t' => collect fileMap (pctx.mergeIntoOuter? ctx?) parent depth t'
  | .hole _ => pure ()
  | .node info children =>
    let visitChildren (parent : Option (String.Pos.Raw × String.Pos.Raw)) (depth : Nat) :
        StateT (Array RawStep) IO Unit :=
      children.forM fun c => collect fileMap ctx? parent depth c
    match ctx?, info with
    | some ctx, .ofTacticInfo ti =>
      let range := do
        let a ← ti.stx.getPos? (canonicalOnly := true)
        let b ← ti.stx.getTailPos? (canonicalOnly := true)
        pure (a, b)
      match range with
      | some r =>
        if isStepSyntax ti.stx && some r != parent then
          let before ← ppEach ctx ti.mctxBefore ti.goalsBefore
          let after ← ppEach ctx ti.mctxAfter ti.goalsAfter
          modify (·.push { start := fileMap.toPosition r.1, stop := fileMap.toPosition r.2, depth,
                           goalsBefore := before, goalsAfter := after })
          visitChildren (some r) (depth + 1)
        else visitChildren parent depth
      | none => visitChildren parent depth
    | _, _ => visitChildren parent depth

/-- Steps of a whole file. -/
def stepsOfTrees (fileMap : FileMap) (trees : Array InfoTree) : IO (Array RawStep) := do
  let ((), steps) ← (trees.forM fun t => collect fileMap none none 0 t).run #[]
  return steps

/-- The source text between two positions (whole lines are given; columns in code points). -/
def sliceText (lines : Array String) (a b : Position) : String :=
  if a.line == b.line then
    String.ofList (((lines[a.line - 1]?).getD "").toList.drop a.column |>.take (b.column - a.column))
  else
    let first := String.ofList (((lines[a.line - 1]?).getD "").toList.drop a.column)
    let middle := (List.range (b.line - a.line - 1)).map fun k => (lines[a.line + k]?).getD ""
    let last := String.ofList (((lines[b.line - 1]?).getD "").toList.take b.column)
    "\n".intercalate (first :: middle ++ [last])

end Proofmap.Walkthrough
