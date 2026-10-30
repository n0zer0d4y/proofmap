import Lean
import Proofmap.Schema
import Proofmap.Util
import Proofmap.Workers
import Proofmap.Extract.Groups
import Proofmap.Walkthrough.Elab

/-!
# Proof walkthroughs for a whole project, cached per file

Each project file with declarations becomes one worker job. Its result is cached in
`.lake/proofmap/walkthrough/` under a key made of the file's contents, the `.olean` files of the
project modules it imports (when a dependency changes, its goals may print differently), the
Lake manifest, the toolchain and the proofmap binary. A second build with no changes therefore
skips every file, and changing one file re-elaborates only that file and the files that import
it. Declarations are identified by their position inside the file, never by their global id,
which shifts whenever a declaration is added anywhere else.
-/

namespace Proofmap.Walkthrough

open Lean Proofmap.Schema Proofmap.Extract

structure Options where
  rootDir : System.FilePath
  headers : Std.HashMap Name ProjectModuleHeader
  jobs : Option Nat := none
  useCache : Bool := true
  timings : Bool := false

private def readResult (f : System.FilePath) : IO (Except String WResult) := do
  try
    return (Json.parse (← IO.FS.readFile f)) >>= fromJson? (α := WResult)
  catch e => return .error (toString e)

/-- Walkthroughs for the project's declarations; fills `walkthroughs` and each declaration's
`walkthrough` index. Returns the updated data and the elaboration errors reported by Lean. -/
def addWalkthroughs (o : Options) (data : ProofmapData) : IO (ProofmapData × Array String) := do
  let cacheDir := o.rootDir / ".lake" / "proofmap" / "walkthrough"
  IO.FS.createDirAll cacheDir
  -- One request per module with a source file and declarations that have a range.
  let mut jobs : Array (WRequest × Array Nat × System.FilePath × Bool) := #[]
  for m in data.modules do
    let some path := m.path | continue
    let ids := data.decls.filter (fun d => !d.external && d.module == some m.name && d.range.isSome &&
      !d.flags.any (·.startsWith "noise:")) |>.map (·.id)
    if ids.isEmpty then continue
    let decls := ids.mapIdx fun i id =>
      let r := data.decls[id]!.range.get!
      ({ id := i, sl := r.start.line, sc := r.start.column, el := r.stop.line, ec := r.stop.column } : WDecl)
    let req : WRequest := { rootDir := Util.slashes o.rootDir, module := m.name, path, decls }
    let file := o.rootDir / path
    let imports := (projectClosure o.headers m.name.toName).erase m.name.toName
    let mut h ← Workers.baseKey ((toJson req).compress)
    h := mixHash h (← IO.FS.readBinFile file).hash
    h ← Workers.mixOLeans h o.rootDir o.headers imports
    let out := cacheDir / s!"{Workers.hex h}.json"
    let cached := o.useCache && (← out.pathExists) && ((← readResult out) matches .ok _)
    jobs := jobs.push (req, ids, out, cached)
  let todo := jobs.filter (!·.2.2.2)
  -- Biggest files first, so the pool finishes evenly.
  let todo := todo.qsort fun a b => a.1.decls.size > b.1.decls.size
  let mut cmds := #[]
  for (req, _, out, _) in todo do
    let reqFile := out.toString.dropEnd 5 |>.toString |> (· ++ ".request.json")
    IO.FS.writeFile reqFile (toJson req).compress
    cmds := cmds.push (reqFile, out.toString)
  let n ← Workers.chooseJobs o.rootDir o.jobs cmds.size (kind := "walkthrough")
  if o.timings then
    IO.eprintln s!"proofmap: walkthrough: {jobs.size - todo.size} file(s) cached, {todo.size} to elaborate with {n} job(s)"
  Workers.runPool "__walkthrough" cmds n
  -- Merge: map file-local ids back to global ids.
  let mut walkthroughs : Array Walkthrough := #[]
  let mut index : Std.HashMap Nat Nat := {}
  let mut errors : Array String := #[]
  for (_, ids, out, _) in jobs do
    match ← readResult out with
    | .error e => errors := errors.push s!"cannot read walkthrough result {out}: {e}"
    | .ok res =>
      errors := errors ++ res.errors
      for (local_, steps) in res.walkthroughs do
        let some gid := ids[local_]? | continue
        index := index.insert gid walkthroughs.size
        walkthroughs := walkthroughs.push {
          decl := gid
          steps := steps.map fun s => {
            tactic := s.tactic, depth := s.depth, goalsBefore := s.goalsBefore, goalsAfter := s.goalsAfter
            range := { start := ⟨s.sl, s.sc⟩, stop := ⟨s.el, s.ec⟩ } } }
  -- Learn this kind of worker's memory from the files elaborated now.
  let mut peak := 0
  let mut priv := 0
  for (_, _, out, cached) in jobs do
    unless cached do
      if let .ok res ← readResult out then
        peak := max peak (res.peakBytes.getD 0)
        priv := max priv (res.privateBytes.getD 0)
  Workers.learnEstimate o.rootDir peak priv (kind := "walkthrough")
  let decls := data.decls.map fun d => { d with walkthrough := index[d.id]? }
  return ({ data with decls, walkthroughs }, errors)

end Proofmap.Walkthrough
