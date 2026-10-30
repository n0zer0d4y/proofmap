import Lean
import Proofmap.Util
import Proofmap.Extract.Env
import Proofmap.Extract.Decls
import Proofmap.Extract.Deps
import Proofmap.Extract.Status
import Proofmap.Extract.Pretty
import Proofmap.Extract.Modules
import Proofmap.Attr

/-!
# One import group (worker side)

A worker imports one clash-free group, extracts the declarations of the group's own modules,
and writes a `Part`. Every reference is resolved in this group's environment and recorded as
a (module, name) key, so declarations with the same name in different modules stay apart.
External declarations referenced directly are included with their name-level data only.
The `Part` format is internal to proofmap (parent and worker are the same binary).
-/

namespace Proofmap.Extract

open Lean Meta

structure Key where
  m : String
  n : String
  deriving ToJson, FromJson, BEq, Hashable, Inhabited

structure PartRange where
  sl : Nat
  sc : Nat
  el : Nat
  ec : Nat
  deriving ToJson, FromJson

structure PartHover where
  s : Nat
  e : Nat
  k : Key
  deriving ToJson, FromJson

structure PartDecl where
  key : Key
  userName : String
  title : String
  kind : String
  project : Bool
  flags : Array String
  axioms : Array String
  signature : String
  hover : Array PartHover := #[]
  docstring : Option String := none
  range : Option PartRange := none
  code : Option String := none
  stmt : Array Key := #[]
  proof : Array Key := #[]
  lines : Nat := 0
  exprNodes : Nat := 0
  /-- Author tags from `@[proofmap ...]`. -/
  tagStep : Option String := none
  tagRank : Option String := none
  tagSummary : Option String := none
  deriving ToJson, FromJson, Inhabited

structure PartModule where
  name : String
  path : Option String := none
  imports : Array String
  doc : Option String := none
  deriving ToJson, FromJson

structure Part where
  members : Array String
  modules : Array PartModule
  decls : Array PartDecl
  /-- The worker's own peak working set and private memory (bytes), when measurable. -/
  peakBytes : Option Nat := none
  privateBytes : Option Nat := none
  deriving ToJson, FromJson

/-- What the parent asks a worker to do. -/
structure GroupRequest where
  rootDir : String
  members : Array String
  projectModules : Array String
  glossary : Array (String × String)
  timings : Bool := false
  deriving ToJson, FromJson

def keyOf (ix : ModIndex) (env : Environment) (n : Name) : Key :=
  { m := ((ix.moduleOf? env n).map toString).getD "", n := toString n }

private def sliceLines (lines : Array String) (r : DeclarationRange) : String :=
  "\n".intercalate (lines.extract (r.pos.line - 1) r.endPos.line).toList

def extractGroup (req : GroupRequest) : IO Part := do
  let rootDir : System.FilePath := req.rootDir
  let members := req.members.map String.toName
  let memberSet : NameSet := members.foldl (·.insert ·) {}
  let projectSet : NameSet := req.projectModules.foldl (fun s m => s.insert m.toName) {}
  let tLast ← IO.mkRef (← IO.monoMsNow)
  let phase (label : String) : IO Unit := do
    if req.timings then
      let now ← IO.monoMsNow
      IO.eprintln s!"proofmap: [group {members[0]?.getD .anonymous} +{members.size - 1}] {label}: {now - (← tLast.get)} ms"
      tLast.set now
  let env ← loadEnv members
  phase "import"
  -- Bound with `←` so it is computed once, not inside every use.
  let ix ← IO.lazyPure fun _ => ModIndex.build env projectSet
  -- Declarations of this group's own modules.
  let mut ownNames : Array Name := #[]
  for h : i in [0:ix.names.size] do
    if memberSet.contains ix.names[i] then
      if let some d := env.header.moduleData[i]? then ownNames := ownNames ++ d.constNames
  let own := ownNames.filter env.contains
  let direct ← IO.lazyPure fun _ => own.map fun n => directDeps env n (env.find? n).get!
  phase "direct dependencies"
  -- External boundary: constants outside the project that own declarations use directly.
  let mut extSet : NameSet := {}
  for (s, p) in direct do
    for d in s ++ p do
      if !ix.isProject env d && env.contains d then extSet := extSet.insert d
  let externals := extSet.toArray
  let all := own ++ externals
  phase "external boundary"
  let (axiomLists, _) ← IO.lazyPure fun _ => (all.mapM fun n => axiomsOf env n).run {}
  phase s!"axioms ({own.size} own, {externals.size} external)"
  -- `pp.tagAppFns` tags the function at the head of an application, so names like `double`
  -- in `double n` get hover links too (doc-gen4 does the same).
  let ppOptions : Options := ({} : Options).setBool `pp.tagAppFns true
  let ctx : Core.Context := { fileName := "<proofmap>", fileMap := default, maxHeartbeats := 0, options := ppOptions }
  let (signatures, _) ← (all.mapM fun n => signatureOf n : MetaM _).run'.toIO ctx { env }
  let (ranges, _) ← (own.mapM fun n => findDeclarationRanges? n : MetaM _).run'.toIO ctx { env }
  phase "signatures, ranges"
  -- Modules and source lines.
  let mut modules : Array PartModule := #[]
  let mut fileLines : Std.HashMap Name (Array String) := {}
  for h : i in [0:ix.names.size] do
    let mod := ix.names[i]
    unless memberSet.contains mod do continue
    let path ← modulePath? rootDir mod
    if let some p := path then
      let text ← IO.FS.readFile (rootDir / p)
      fileLines := fileLines.insert mod
        ((text.splitOn "\n").toArray.map fun l => if l.endsWith "\r" then (l.dropEnd 1).toString else l)
    modules := modules.push { name := toString mod, path, imports := moduleImports env (i : ModuleIdx), doc := moduleDoc? env mod }
  let mut decls : Array PartDecl := #[]
  for h : i in [0:all.size] do
    let n := all[i]
    let ci := (env.find? n).get!
    let project := i < own.size
    -- Ranges are known for project declarations only; externals are folded per library anyway.
    let noise := if project then generatedFlag (noiseFlags env n ci) ranges[i]!.isSome else noiseFlags env n ci
    let flags := noise ++ (if project then infoFlags env n ci else #[])
    let range := if project then ranges[i]!.map (·.range) else none
    let mod? := ix.moduleOf? env n
    let code : Option String := do
      guard (project && !isNoise noise)
      let r ← range
      let lines ← fileLines[mod?.getD .anonymous]?
      return sliceLines lines r
    let exprNodes ← if project then (ci.value?.mapM (·.numObjs)) else pure none
    let doc ← findDocString? env n
    let tag := if project then Proofmap.tagOf? env n else none
    let (s, p) := if project then direct[i]! else (#[], #[])
    decls := decls.push {
      key := keyOf ix env n, userName := toString (privateToUserName n), title := humanize req.glossary n
      kind := (declKind env n ci).toString, project, flags
      axioms := axiomLists[i]!.map toString, signature := signatures[i]!.1
      hover := signatures[i]!.2.map fun h => { s := h.start, e := h.stop, k := keyOf ix env h.const }
      docstring := doc
      range := range.map fun r => { sl := r.pos.line, sc := r.pos.column, el := r.endPos.line, ec := r.endPos.column }
      code, stmt := s.map (keyOf ix env), proof := p.map (keyOf ix env)
      lines := (range.map fun r => r.endPos.line - r.pos.line + 1).getD 0, exprNodes := exprNodes.getD 0
      tagStep := tag.bind (·.step), tagRank := tag.bind (·.rank), tagSummary := tag.bind (·.summary) }
  phase "records"
  return { members := req.members, modules, decls }

end Proofmap.Extract
