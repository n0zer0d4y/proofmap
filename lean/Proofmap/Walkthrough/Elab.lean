import Lean
import Proofmap.Walkthrough.Steps
import Proofmap.Resources

/-!
# Re-elaborating one file for its proof walkthroughs

Lean does not store tactic states in `.olean` files, so each project file is elaborated again
with InfoTrees enabled: its header is processed against the project's search path (the process
runs under `lake env`), then all its commands. The tactic steps found in the InfoTrees are
assigned to the innermost project declaration whose source range contains them; declarations
without steps (term-mode proofs, definitions) get no walkthrough.

This runs in a worker process (`__walkthrough REQUEST OUT`), one file per process, because each
file imports its own dependencies.
-/

namespace Proofmap.Walkthrough

open Lean Elab

structure WDecl where
  id : Nat
  sl : Nat
  sc : Nat
  el : Nat
  ec : Nat
  deriving ToJson, FromJson, Inhabited

structure WStep where
  tactic : String
  sl : Nat
  sc : Nat
  el : Nat
  ec : Nat
  depth : Nat
  goalsBefore : Array String
  goalsAfter : Array String
  deriving ToJson, FromJson, Inhabited

structure WRequest where
  rootDir : String
  module : String
  path : String
  decls : Array WDecl
  deriving ToJson, FromJson

structure WResult where
  module : String
  walkthroughs : Array (Nat × Array WStep)
  errors : Array String
  /-- The worker's peak working set and private memory, for choosing the number of workers. -/
  peakBytes : Option Nat := none
  privateBytes : Option Nat := none
  deriving ToJson, FromJson

unsafe def enableInitializersUnsafe : IO Unit := enableInitializersExecution
@[implemented_by enableInitializersUnsafe] opaque enableInitializers : IO Unit

/-- Elaborate a file with InfoTrees; returns the trees, error messages and the file's lines. -/
def elabFile (file : System.FilePath) (mainModule : Name) :
    IO (Array InfoTree × Array String × FileMap × Array String) := do
  initSearchPath (← findSysroot)
  enableInitializers
  let input ← IO.FS.readFile file
  let inputCtx := Parser.mkInputContext input file.toString
  let (header, parserState, messages) ← Parser.parseHeader inputCtx
  let (env, messages) ← processHeader header {} messages inputCtx (trustLevel := 1024) (leakEnv := true)
    (mainModule := mainModule)
  let cmdState := Command.mkState env messages {}
  let cmdState := { cmdState with infoState := { cmdState.infoState with enabled := true } }
  let s ← IO.processCommands inputCtx parserState cmdState
  let errors ← s.commandState.messages.toList.filterMapM fun m => do
    if m.severity == .error then
      return some s!"{file}:{m.pos.line}:{m.pos.column}: {(← m.data.toString).trimAscii.toString}"
    return none
  let lines := (input.splitOn "\n").toArray.map fun l => if l.endsWith "\r" then (l.dropEnd 1).toString else l
  return (s.commandState.infoState.trees.toArray, errors.toArray, inputCtx.fileMap, lines)

private def before (a b : Position) : Bool := a.line < b.line || (a.line == b.line && a.column ≤ b.column)

/-- Walkthroughs of the requested declarations in one file. -/
def walkthroughFile (req : WRequest) : IO WResult := do
  let file := (req.rootDir : System.FilePath) / req.path
  let (trees, errors, fileMap, lines) ← elabFile file req.module.toName
  let steps ← stepsOfTrees fileMap trees
  let contains (d : WDecl) (p : Position) := before ⟨d.sl, d.sc⟩ p && before p ⟨d.el, d.ec⟩
  let size (d : WDecl) := (d.el - d.sl) * 100000 + (d.ec + 100000 - d.sc)
  -- Assign each step to the innermost declaration that contains it.
  let mut byDecl : Std.HashMap Nat (Array RawStep) := {}
  for s in steps do
    let owners := req.decls.filter (contains · s.start)
    if let some d := owners.foldl (init := none) fun best d =>
        match best with | some b => if size d < size b then some d else some b | none => some d then
      byDecl := byDecl.insert d.id ((byDecl.getD d.id #[]).push s)
  let walkthroughs := req.decls.filterMap fun d => do
    let raw ← byDecl[d.id]?
    if raw.isEmpty then none
    -- Steps in source order; depths relative to the declaration's outermost steps.
    let raw := raw.qsort fun a b => a.start.line < b.start.line ||
      (a.start.line == b.start.line && (a.start.column < b.start.column ||
        (a.start.column == b.start.column && a.depth < b.depth)))
    let base := raw.foldl (fun m s => min m s.depth) raw[0]!.depth
    let steps := raw.map fun s => ({
      tactic := sliceText lines s.start s.stop, sl := s.start.line, sc := s.start.column
      el := s.stop.line, ec := s.stop.column, depth := s.depth - base
      goalsBefore := s.goalsBefore, goalsAfter := s.goalsAfter } : WStep)
    -- The focusing dot alone is not a step. Its syntax differs between toolchains, so it is
    -- recognised by its text; its siblings keep their depth.
    some (d.id, steps.filter fun s => s.tactic != "·" && s.tactic != ".")
  return { module := req.module, walkthroughs, errors }

/-- Worker entry point: `__walkthrough REQUEST.json OUT.json`. -/
def runWalkthroughWorker (reqFile outFile : System.FilePath) : IO UInt32 := do
  match (Json.parse (← IO.FS.readFile reqFile)) >>= fromJson? (α := WRequest) with
  | .error e =>
    IO.eprintln s!"proofmap: bad walkthrough request {reqFile}: {e}"
    return 1
  | .ok req =>
    let res ← walkthroughFile req
    let res := match ← Proofmap.Resources.selfMemory? with
      | some (peak, priv) => { res with peakBytes := some peak, privateBytes := some priv }
      | none => res
    let tmp := outFile.toString ++ ".tmp"
    IO.FS.writeFile tmp (toJson res).compress
    IO.FS.rename tmp outFile
    return 0

end Proofmap.Walkthrough
