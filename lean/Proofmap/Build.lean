import Lean
import Proofmap.Schema
import Proofmap.Util
import Proofmap.Version
import Proofmap.Extract.Groups
import Proofmap.Extract.Part
import Proofmap.Extract.Deps
import Proofmap.Extract.Status
import Proofmap.Extract.Pretty
import Proofmap.Resources
import Proofmap.Workers
import Proofmap.Walkthrough.Cache
import Proofmap.Enrich
import Proofmap.Source.Sections
import Proofmap.Repo

/-!
# Extraction pipeline (parent side)

1. Find the project modules (each root and its built submodules).
2. Split them into clash-free import groups from their `.olean` headers.
3. Extract each group in a worker process (this executable, `__extract-group`), reusing a
   cached result when the group's inputs are unchanged.
4. Merge: assign ids, collapse noise across groups, classify axioms.
5. Enrich: read the sources (sections, leading comments), then summaries, steps, ranks, roots.
-/

namespace Proofmap

open Lean Proofmap.Schema Proofmap.Extract

structure BuildOptions where
  rootDir : System.FilePath
  rootModules : Array Name
  title : Option String := none
  /-- Where a title that was not configured came from (CITATION.cff, README.md, the lakefile). -/
  titleSource : Option String := none
  repoUrl : Option String := none
  standardAxioms : Array String := defaultStandardAxioms
  glossary : Array (String × String) := defaultGlossary
  /-- Print the time spent in each phase to stderr. -/
  timings : Bool := false
  /-- Worker processes run at the same time; `none` chooses from CPUs and free memory. -/
  jobs : Option Nat := none
  /-- Reuse cached group results. -/
  useCache : Bool := true
  /-- Divider comment patterns (regular expressions) for the section tree. -/
  dividerPatterns : Array String := Source.defaultDividerPatterns
  /-- Viewer settings from the config. -/
  preset : Option String := none
  footer : Bool := true
  /-- Treat framed comment banners as section headings. -/
  banners : Bool := true
  /-- Summaries, steps, ranks and roots from the config. -/
  overrides : Overrides := {}
  /-- Build proof walkthroughs (re-elaborates the project files; cached per file). -/
  walkthrough : Bool := true

/-- Cache key of a group: see `Workers.baseKey`; plus the request and the `.olean` bytes of every
project module in the group's import union, and the Lake manifest. -/
private def groupKey (rootDir : System.FilePath) (headers : Std.HashMap Name ProjectModuleHeader)
    (members : Array Name) (req : GroupRequest) : IO String := do
  let union := members.foldl (fun s m => projectClosure headers m s) {}
  return Workers.hex (← Workers.mixOLeans (← Workers.baseKey (toJson req).compress) rootDir headers union)

private def readPart (file : System.FilePath) : IO Part := do
  match (Json.parse (← IO.FS.readFile file)) >>= fromJson? (α := Part) with
  | .ok p => pure p
  | .error e => throw <| IO.userError s!"cannot read group result {file}: {e}"

def extract (opts : BuildOptions) : IO ProofmapData := do
  let tLast ← IO.mkRef (← IO.monoMsNow)
  let phase (label : String) : IO Unit := do
    if opts.timings then
      let now ← IO.monoMsNow
      IO.eprintln s!"proofmap: {label}: {now - (← tLast.get)} ms"
      tLast.set now
  initSearchPath (← findSysroot)
  let (mods, missing) ← discoverModules opts.rootDir opts.rootModules
  for m in missing do
    IO.eprintln s!"proofmap: warning: {m} has a source file but no built .olean; skipped (run `lake build`)"
  if mods.isEmpty then
    throw <| IO.userError s!"no built modules found under {opts.rootModules.toList}"
  let headers ← readHeaders mods
  let groups := importGroups headers mods
  phase s!"discover {mods.size} modules, {groups.size} import group(s) {groups.map (·.size)}"
  -- Run (or reuse) one worker per group.
  let cacheDir := opts.rootDir / ".lake" / "proofmap" / "groups"
  IO.FS.createDirAll cacheDir
  let mut outs : Array System.FilePath := #[]
  let mut todo : Array (String × String) := #[]
  for g in groups do
    let req : GroupRequest := {
      rootDir := Util.slashes opts.rootDir, members := g.map toString
      projectModules := mods.map toString, glossary := opts.glossary }
    let key ← groupKey opts.rootDir headers g req
    let out := cacheDir / s!"{key}.json"
    outs := outs.push out
    -- A cache entry that cannot be read counts as a miss.
    let cached ← if opts.useCache && (← out.pathExists) then (readPart out).toBaseIO else pure (.error "")
    unless cached matches .ok _ do
      let reqFile := cacheDir / s!"{key}.request.json"
      IO.FS.writeFile reqFile (toJson { req with timings := opts.timings }).compress
      todo := todo.push (reqFile.toString, out.toString)
  let jobs ← Workers.chooseJobs opts.rootDir opts.jobs todo.size
  if opts.timings then
    IO.eprintln s!"proofmap: {groups.size - todo.size} group(s) cached, {todo.size} to extract with {jobs} job(s)"
  Workers.runPool "__extract-group" todo jobs
  phase "group workers"
  let parts ← outs.mapM readPart
  -- Remember the largest memory figures seen, for the next automatic --jobs.
  let freshOuts := todo.map (·.2)
  let fresh := (outs.zip parts).filterMap fun (o, p) => if freshOuts.contains o.toString then some p else none
  Workers.learnEstimate opts.rootDir (fresh.foldl (fun m p => max m (p.peakBytes.getD 0)) 0)
    (fresh.foldl (fun m p => max m (p.privateBytes.getD 0)) 0)
  -- Merge: project declarations come from their own group; externals are deduplicated.
  let mut byKey : Std.HashMap Key PartDecl := {}
  for p in parts do
    for d in p.decls do
      if d.project || !byKey.contains d.key then byKey := byKey.insert d.key d
  let all := byKey.toArray.map (·.2)
  let projectDecls := all.filter (·.project) |>.qsort fun a b =>
    a.userName < b.userName || (a.userName == b.userName &&
      (a.key.m < b.key.m || (a.key.m == b.key.m && a.key.n < b.key.n)))
  let externalDecls := all.filter (!·.project) |>.qsort fun a b =>
    a.key.n < b.key.n || (a.key.n == b.key.n && a.key.m < b.key.m)
  let entries := projectDecls ++ externalDecls
  let ids : Std.HashMap Key Nat := entries.size.fold (init := {}) fun i _ m => m.insert entries[i]!.key i
  let toIds (ks : Array Key) := ks.filterMap (ids[·]?)
  let directIds := entries.map fun d => (toIds d.stmt, toIds d.proof)
  let noisy := entries.map fun d => isNoise d.flags
  let collapsed ← IO.lazyPure fun _ =>
    collapse directIds (fun i => entries[i]!.project && noisy[i]!) (fun i => !entries[i]!.project && noisy[i]!)
  let decls := entries.mapIdx fun i d =>
    let (hasSorry, nonstd) := classifyAxioms opts.standardAxioms (d.axioms.map String.toName)
    let kind := (DeclKind.ofString? d.kind).getD .«def»
    let (cs, cp) := collapsed[i]!
    let (ds, dp) := directIds[i]!
    ({ id := i, name := d.userName, title := d.title, kind
       module := if d.key.m.isEmpty then none else some d.key.m, external := !d.project
       range := d.range.map fun r => { start := ⟨r.sl, r.sc⟩, stop := ⟨r.el, r.ec⟩ }
       signature := d.signature
       signatureHover := d.hover.filterMap fun h => (ids[h.k]?).bind fun id =>
         if id == i then none else some { start := h.s, stop := h.e, decl := id }
       docstring := d.docstring, code := d.code, flags := d.flags
       status := { hasSorry, axioms := d.axioms, nonstandardAxioms := nonstd }
       deps := { statement := cs, proof := cp }, directDeps := { statement := ds, proof := dp }
       lines := d.lines, exprNodes := d.exprNodes
       tags := { step := d.tagStep, summary := d.tagSummary, rank := d.tagRank.bind Rank.ofString? }
       rank := if kind == .«theorem» then .«theorem» else .«def» } : Decl)
  let modules := (parts.flatMap (·.modules)).qsort (·.name < ·.name) |>.map fun m =>
    ({ name := m.name, path := m.path, imports := m.imports, doc := m.doc } : Schema.Module)
  phase s!"merge ({decls.size} declarations)"
  let dividers ← opts.dividerPatterns.mapM fun p => match Regex.compile p with
    | .ok r => pure r
    | .error e => throw <| IO.userError s!"invalid divider pattern {p}: {e}"
  let (decls, modules, roots, unmatched) ← enrich opts.rootDir dividers opts.banners opts.overrides decls modules
  for n in unmatched do
    IO.eprintln s!"proofmap: warning: root '{n}' from the config matches no project declaration"
  phase s!"sections, comments, summaries, ranks ({roots.size} root(s))"
  let title := opts.title.getD (", ".intercalate (opts.rootModules.toList.map toString))
  -- With a repository URL, source links point at the commit that was mapped (when it is a git
  -- checkout; otherwise at HEAD), inside the project's folder in the repository.
  let repo ← if opts.repoUrl.isNone then pure {} else Repo.info opts.rootDir
  let repoRef := repo.ref
  let repoPathPrefix := if repo.pathPrefix.isEmpty then none else some repo.pathPrefix
  let data : ProofmapData := {
    generator := { version := version, lean := Lean.versionString }
    project := {
      title, rootModules := opts.rootModules.map toString, repoUrl := opts.repoUrl, repoRef, repoPathPrefix
      builtAt := ← Util.nowIsoUtc, roots
      standardAxioms := opts.standardAxioms, preset := opts.preset, footer := opts.footer }
    modules, decls, glossary := opts.glossary }
  if !opts.walkthrough then return data
  let (data, errors) ← Walkthrough.addWalkthroughs
    { rootDir := opts.rootDir, headers, jobs := opts.jobs, useCache := opts.useCache, timings := opts.timings } data
  for e in errors.extract 0 20 do IO.eprintln s!"proofmap: warning: walkthrough: {e}"
  if errors.size > 20 then IO.eprintln s!"proofmap: warning: walkthrough: {errors.size - 20} more errors"
  phase s!"walkthroughs ({data.walkthroughs.size} proofs)"
  return data

/-- Worker entry point: `__extract-group REQUEST.json OUT.json`. -/
def runGroupWorker (reqFile outFile : System.FilePath) : IO UInt32 := do
  match (Json.parse (← IO.FS.readFile reqFile)) >>= fromJson? (α := GroupRequest) with
  | .error e =>
    IO.eprintln s!"proofmap: bad group request {reqFile}: {e}"
    return 1
  | .ok req =>
    let part ← extractGroup req
    let part := match ← Resources.selfMemory? with
      | some (peak, priv) => { part with peakBytes := some peak, privateBytes := some priv }
      | none => part
    -- Write to a temporary file first, so an interrupted worker never leaves a bad cache entry.
    let tmp := outFile.toString ++ ".tmp"
    IO.FS.writeFile tmp (toJson part).compress
    IO.FS.rename tmp outFile
    return 0

end Proofmap
