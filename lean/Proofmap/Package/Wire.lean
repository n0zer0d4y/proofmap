import Proofmap.Schema
import Proofmap.Workers
import Proofmap.Package.Template

/-!
# The page payload

`proofmap.json` (`build --json`) is the public, readable format. Pages carry the same data in a
compact form, decoded by the viewer (`viewer/src/data/wire.ts`) back into exactly the public
shape. Both ship together in one page, so this format is internal and versioned by `wire`.

```
{ "wire": 1, "schema": 2, "generator", "project", "modules", "glossary": as in proofmap.json,
  "kinds": [kind], "moduleNames": [module], "statuses": [status],   -- tables, first-seen order
  "decls": [{ ... short keys, see `encodeDecl` ... }],              -- index = id
  "walkthroughs": [{ "d": decl, "n": stepCount, "s": [step] } | { "d", "n", "f": file, "b": build }],
  "goalLines": { module: [line] } }
```

A step is `[tactic, [startLine, startCol, endLine, endCol], depth, goalsBefore, goalsAfter]`, and
a goal is an array of indices into its module's line table. Tables are filled in first-seen
order, so the same data always gives the same bytes (compare and chunk build ids rely on that).

Generated helpers (`noise:*`) are written without hover spans and code; they keep status,
dependencies, module and range. `directDeps` is left out when it equals `deps`.

Split walkthroughs go to one script per module, each with its own line table:
`window.__proofmapWalkthroughs(file, build, { "lines": [...], "steps": { name: [step] } })`.

For a single file still over budget, generated helpers can be split too: each keeps a stub
(name, kind, status, module, external, range, flags, deps, size, rank), and the rest of its
fields go to one script, `window.__proofmapHelpers(file, build, { "<id>": {...short keys} })`,
named in the payload as `"helpers": { "f": file, "b": build }`.
-/

namespace Proofmap.Package.Wire

open Lean Proofmap.Schema Proofmap.Workers

/-- Strings to indices, in first-seen order. -/
structure Table where
  items : Array String := #[]
  index : Std.HashMap String Nat := {}

def Table.intern (t : Table) (s : String) : Table × Nat :=
  match t.index.get? s with
  | some i => (t, i)
  | none => ({ items := t.items.push s, index := t.index.insert s t.items.size }, t.items.size)

private def range4 (r : Range) : Json :=
  toJson #[r.start.line, r.start.column, r.stop.line, r.stop.column]

private def deps2 (d : DepLists) : Json := toJson #[d.statement, d.proof]

def encodeGoal (t : Table) (goal : String) : Table × Json := Id.run do
  let mut t := t
  let mut out : Array Json := #[]
  for l in goal.splitOn "\n" do
    let (t', i) := t.intern l
    t := t'
    out := out.push (toJson i)
  return (t, .arr out)

def encodeSteps (t : Table) (steps : Array Step) : Table × Json := Id.run do
  let mut t := t
  let mut out : Array Json := #[]
  for s in steps do
    let mut before : Array Json := #[]
    for g in s.goalsBefore do
      let (t', j) := encodeGoal t g
      t := t'
      before := before.push j
    let mut after : Array Json := #[]
    for g in s.goalsAfter do
      let (t', j) := encodeGoal t g
      t := t'
      after := after.push j
    out := out.push (.arr #[toJson s.tactic, range4 s.range, toJson s.depth, .arr before, .arr after])
  return (t, .arr out)

structure Tables where
  kinds : Table := {}
  modules : Table := {}
  statuses : Table := {}
  statusJson : Array Json := #[]

/-- The short keys a split helper keeps in the payload; the others move to the helpers script. -/
def stubKeys : List String := ["n", "k", "s", "m", "x", "r", "f", "d", "e", "z", "a"]

/-- One declaration's fields in short keys; absent keys take their defaults (see `wire.ts`). -/
def encodeDecl (tb : Tables) (d : Decl) : Tables × Array (String × Json) := Id.run do
  let mut tb := tb
  let (kinds, k) := tb.kinds.intern (toJson d.kind).compress
  tb := { tb with kinds }
  let st := (toJson d.status).compress
  let (statuses, s) := tb.statuses.intern st
  if statuses.items.size > tb.statuses.items.size then
    tb := { tb with statusJson := tb.statusJson.push (toJson d.status) }
  tb := { tb with statuses }
  let noise := d.isNoise
  let mut f : Array (String × Json) := #[("n", toJson d.name), ("t", toJson d.title), ("k", toJson k), ("s", toJson s)]
  if let some m := d.module then
    let (modules, mi) := tb.modules.intern m
    tb := { tb with modules }
    f := f.push ("m", toJson mi)
  if d.external then f := f.push ("x", toJson 1)
  if let some r := d.range then f := f.push ("r", range4 r)
  unless d.sectionPath.isEmpty do f := f.push ("p", toJson d.sectionPath)
  f := f.push ("g", toJson d.signature)
  unless noise || d.signatureHover.isEmpty do
    f := f.push ("h", toJson (d.signatureHover.map fun h => #[h.start, h.stop, h.decl]))
  if let some su := d.summary then f := f.push ("u", toJson #[su.text, su.source])
  if let some o := d.docstring then f := f.push ("o", toJson o)
  if let some l := d.leadingComment then f := f.push ("l", toJson l)
  unless noise do if let some c := d.code then f := f.push ("c", toJson c)
  unless d.flags.isEmpty do f := f.push ("f", toJson d.flags)
  f := f.push ("d", deps2 d.deps)
  unless d.directDeps == d.deps do f := f.push ("e", deps2 d.directDeps)
  f := f.push ("z", toJson #[d.lines, d.exprNodes])
  f := f.push ("a", toJson d.rank)
  if let some q := d.step then f := f.push ("q", toJson q)
  let tags := toJson d.tags
  unless tags == Json.mkObj [] do f := f.push ("y", tags)
  if let some w := d.walkthrough then f := f.push ("w", toJson w)
  return (tb, f)

/-- A file name for a module's chunk: the name with anything but ASCII letters, digits, `.`, `-`
and `_` replaced, plus a hash of the exact name, so names differing only in case (equal on
case-insensitive file systems) or in replaced characters still get distinct files. -/
def chunkFileName (module : String) : String :=
  let safe := module.map fun c => if (c.isAlphanum && c.toNat < 128) || c == '.' || c == '-' || c == '_' then c else '_'
  s!"{(safe.take 80).toString}-{(hex (hash module)).drop 8}.js"

/-- The page payload, and with `splitDir` (a folder relative to the page) the walkthrough
chunks to write there: (path relative to the page, script). -/
def encode (data : ProofmapData) (splitDir : Option String := none) (helperFile : Option String := none) :
    Json × Array (String × String) := Id.run do
  let mut tb : Tables := {}
  let mut decls : Array Json := #[]
  let mut details : Array (String × Json) := #[]
  for d in data.decls do
    let (tb', fields) := encodeDecl tb d
    tb := tb'
    if helperFile.isSome && d.isNoise then
      decls := decls.push (Json.mkObj (fields.filter (stubKeys.contains ·.1)).toList)
      details := details.push (toString d.id, Json.mkObj (fields.filter (!stubKeys.contains ·.1)).toList)
    else
      decls := decls.push (Json.mkObj fields.toList)
  let moduleOf (w : Walkthrough) := ((data.decls[w.decl]?).bind (·.module)).getD "_"
  -- Walkthroughs grouped by module, in first-seen order; one line table per module.
  let mut order : Array String := #[]
  let mut byModule : Std.HashMap String (Array Nat) := {}
  for i in [0:data.walkthroughs.size] do
    let m := moduleOf data.walkthroughs[i]!
    unless byModule.contains m do order := order.push m
    byModule := byModule.insert m ((byModule.getD m #[]).push i)
  let mut ws : Array Json := data.walkthroughs.map fun w => Json.mkObj [("d", toJson w.decl), ("n", toJson w.steps.size)]
  let mut goalLines : Array (String × Json) := #[]
  let mut chunks := #[]
  for m in order do
    let idxs := byModule.getD m #[]
    let mut t : Table := {}
    let mut stepsOf : Array (Nat × Json) := #[]
    for i in idxs do
      let (t', j) := encodeSteps t data.walkthroughs[i]!.steps
      t := t'
      stepsOf := stepsOf.push (i, j)
    match splitDir with
    | none =>
      goalLines := goalLines.push (m, toJson t.items)
      for (i, j) in stepsOf do
        let w := data.walkthroughs[i]!
        ws := ws.set! i (Json.mkObj [("d", toJson w.decl), ("n", toJson w.steps.size), ("s", j)])
    | some dir =>
      let payload := (Json.mkObj [("lines", toJson t.items), ("steps", Json.mkObj (stepsOf.toList.map fun (i, j) =>
        ((data.decls[data.walkthroughs[i]!.decl]?.map (·.name)).getD "", j)))]).compress
      let build := hex (hash payload)
      let file := s!"{dir}/{chunkFileName m}"
      chunks := chunks.push (file, s!"window.__proofmapWalkthroughs({(toJson file).compress}, {(toJson build).compress}, {escapeJson payload});\n")
      for i in idxs do
        let w := data.walkthroughs[i]!
        ws := ws.set! i (Json.mkObj [("d", toJson w.decl), ("n", toJson w.steps.size), ("f", toJson file), ("b", toJson build)])
  let mut helpers : List (String × Json) := []
  if let some file := helperFile then
    let payload := (Json.mkObj details.toList).compress
    let build := hex (hash payload)
    chunks := chunks.push (file, s!"window.__proofmapHelpers({(toJson file).compress}, {(toJson build).compress}, {escapeJson payload});\n")
    helpers := [("helpers", Json.mkObj [("f", toJson file), ("b", toJson build)])]
  let pub := toJson data
  let keep (k : String) : Json := (pub.getObjVal? k).toOption.getD .null
  let json := Json.mkObj <| [
    ("wire", toJson 1), ("schema", keep "schema"), ("generator", keep "generator"), ("project", keep "project"),
    ("modules", keep "modules"), ("glossary", keep "glossary"),
    ("kinds", toJson (tb.kinds.items.map fun k => (Json.parse k).toOption.getD (.str k))),
    ("moduleNames", toJson tb.modules.items), ("statuses", .arr tb.statusJson),
    ("decls", .arr decls), ("walkthroughs", .arr ws), ("goalLines", Json.mkObj goalLines.toList)] ++ helpers
  return (json, chunks)

end Proofmap.Package.Wire
