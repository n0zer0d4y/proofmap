import Lean.Data.Json

/-!
# proofmap.json, schema v1

Lean mirror of `schema/proofmap.schema.json`, which is the source of truth.
`ToJson` instances are written by hand where the schema requires a field to be
present as `null` (derived instances omit `none` fields).
-/

namespace Proofmap.Schema

open Lean (Json ToJson toJson)

def schemaVersion : Nat := 2

private def nullable [ToJson α] : Option α → Json
  | some a => toJson a
  | none => Json.null

/-- `[line, column]`: 1-based line, 0-based column in code points. -/
structure Position where
  line : Nat
  column : Nat
  deriving Inhabited, BEq, Repr

instance : ToJson Position where
  toJson p := Json.arr #[toJson p.line, toJson p.column]

structure Range where
  start : Position
  stop : Position
  deriving Inhabited, BEq, Repr

instance : ToJson Range where
  toJson r := Json.mkObj [("start", toJson r.start), ("end", toJson r.stop)]

structure Generator where
  version : String
  lean : String

instance : ToJson Generator where
  toJson g := Json.mkObj [("name", "proofmap"), ("version", toJson g.version), ("lean", toJson g.lean)]

structure Project where
  title : String
  rootModules : Array String
  repoUrl : Option String := none
  repoRef : Option String := none
  /-- The project's folder inside its git repository (`lean/`), so source links reach a project
  that is not at the top of its repository. Absent when the project is at the top. -/
  repoPathPrefix : Option String := none
  /-- The project folder relative to the page (single-file pages only). Pages never record an
  absolute path; the viewer finds the project from the page's own location. -/
  pageToRoot : Option String := none
  builtAt : String
  roots : Array Nat
  standardAxioms : Array String
  preset : Option String := none
  footer : Bool := true

instance : ToJson Project where
  toJson p := Json.mkObj <|
    [("title", toJson p.title), ("rootModules", toJson p.rootModules),
     ("repoUrl", nullable p.repoUrl), ("repoRef", nullable p.repoRef),
     ("repoPathPrefix", nullable p.repoPathPrefix),
     ("pageToRoot", nullable p.pageToRoot), ("builtAt", toJson p.builtAt), ("roots", toJson p.roots),
     ("standardAxioms", toJson p.standardAxioms), ("footer", toJson p.footer)] ++
    (match p.preset with | some s => [("preset", toJson s)] | none => [])

inductive SectionSource where
  | doc | divider | «section» | «namespace»
  deriving Inhabited, BEq, Repr

def SectionSource.toString : SectionSource → String
  | .doc => "doc" | .divider => "divider" | .«section» => "section" | .«namespace» => "namespace"

structure Section where
  title : String
  source : SectionSource
  description : Option String := none
  range : Range
  children : Array Section := #[]
  deriving Inhabited, Repr

partial def Section.toJson (s : Section) : Json :=
  Json.mkObj [("title", Lean.toJson s.title), ("source", Lean.toJson s.source.toString),
    ("description", nullable s.description), ("range", Lean.toJson s.range),
    ("children", Json.arr (s.children.map Section.toJson))]

instance : ToJson Section := ⟨Section.toJson⟩

structure Module where
  name : String
  path : Option String
  imports : Array String
  doc : Option String := none
  sections : Array Section := #[]

instance : ToJson Module where
  toJson m := Json.mkObj [("name", toJson m.name), ("path", nullable m.path),
    ("imports", toJson m.imports), ("doc", nullable m.doc), ("sections", toJson m.sections)]

inductive DeclKind where
  | «theorem» | «def» | «abbrev» | «structure» | «inductive» | ctor | recursor | «instance» | «axiom» | «opaque» | quot
  deriving Inhabited, BEq, Repr

def DeclKind.toString : DeclKind → String
  | .«theorem» => "theorem" | .«def» => "def" | .«abbrev» => "abbrev" | .«structure» => "structure"
  | .«inductive» => "inductive" | .ctor => "ctor" | .recursor => "recursor" | .«instance» => "instance"
  | .«axiom» => "axiom" | .«opaque» => "opaque" | .quot => "quot"

def DeclKind.ofString? : String → Option DeclKind
  | "theorem" => some .«theorem» | "def" => some .«def» | "abbrev" => some .«abbrev»
  | "structure" => some .«structure» | "inductive" => some .«inductive» | "ctor" => some .ctor
  | "recursor" => some .recursor | "instance" => some .«instance» | "axiom" => some .«axiom»
  | "opaque" => some .«opaque» | "quot" => some .quot | _ => none

instance : ToJson DeclKind := ⟨fun k => toJson k.toString⟩

inductive Rank where
  | result | «theorem» | lemma | «def»
  deriving Inhabited, BEq, Repr

def Rank.toString : Rank → String
  | .result => "result" | .«theorem» => "theorem" | .lemma => "lemma" | .«def» => "def"

def Rank.ofString? : String → Option Rank
  | "result" => some .result | "theorem" => some .«theorem» | "lemma" => some .lemma
  | "def" => some .«def» | _ => none

instance : ToJson Rank := ⟨fun r => toJson r.toString⟩

structure Summary where
  text : String
  /-- One of `attr`, `config`, `docstring`, `comment`, `section`, `ai`. -/
  source : String
  deriving Inhabited, Repr

instance : ToJson Summary where
  toJson s := Json.mkObj [("text", toJson s.text), ("source", toJson s.source)]

structure HoverSpan where
  start : Nat
  stop : Nat
  decl : Nat

instance : ToJson HoverSpan where
  toJson h := Json.mkObj [("start", toJson h.start), ("end", toJson h.stop), ("decl", toJson h.decl)]

structure DepLists where
  statement : Array Nat := #[]
  proof : Array Nat := #[]
  deriving Inhabited, BEq

instance : ToJson DepLists where
  toJson d := Json.mkObj [("statement", toJson d.statement), ("proof", toJson d.proof)]

structure Status where
  hasSorry : Bool := false
  axioms : Array String := #[]
  nonstandardAxioms : Array String := #[]
  deriving Inhabited

instance : ToJson Status where
  toJson s := Json.mkObj [("sorry", toJson s.hasSorry), ("axioms", toJson s.axioms),
    ("nonstandardAxioms", toJson s.nonstandardAxioms)]

structure Tags where
  step : Option String := none
  rank : Option Rank := none
  summary : Option String := none
  deriving Inhabited

instance : ToJson Tags where
  toJson t := Json.mkObj <|
    (match t.step with | some s => [("step", toJson s)] | none => []) ++
    (match t.rank with | some r => [("rank", toJson r)] | none => []) ++
    (match t.summary with | some s => [("summary", toJson s)] | none => [])

structure Decl where
  id : Nat
  name : String
  title : String
  kind : DeclKind
  module : Option String
  external : Bool
  range : Option Range := none
  sectionPath : Array Nat := #[]
  signature : String := ""
  signatureHover : Array HoverSpan := #[]
  summary : Option Summary := none
  docstring : Option String := none
  leadingComment : Option String := none
  code : Option String := none
  flags : Array String := #[]
  status : Status := {}
  deps : DepLists := {}
  directDeps : DepLists := {}
  lines : Nat := 0
  exprNodes : Nat := 0
  rank : Rank := .«def»
  step : Option String := none
  tags : Tags := {}
  walkthrough : Option Nat := none
  deriving Inhabited

def Decl.isNoise (d : Decl) : Bool := d.flags.any (·.startsWith "noise:")

instance : ToJson Decl where
  toJson d := Json.mkObj [
    ("id", toJson d.id), ("name", toJson d.name), ("title", toJson d.title), ("kind", toJson d.kind),
    ("module", nullable d.module), ("external", toJson d.external), ("range", nullable d.range),
    ("sectionPath", toJson d.sectionPath), ("signature", toJson d.signature),
    ("signatureHover", toJson d.signatureHover), ("summary", nullable d.summary),
    ("docstring", nullable d.docstring), ("leadingComment", nullable d.leadingComment),
    ("code", nullable d.code), ("flags", toJson d.flags), ("status", toJson d.status),
    ("deps", toJson d.deps), ("directDeps", toJson d.directDeps),
    ("size", Json.mkObj [("lines", toJson d.lines), ("exprNodes", toJson d.exprNodes)]),
    ("rank", toJson d.rank), ("step", nullable d.step), ("tags", toJson d.tags),
    ("walkthrough", nullable d.walkthrough)]

structure Step where
  tactic : String
  range : Range
  depth : Nat
  goalsBefore : Array String
  goalsAfter : Array String
  deriving Inhabited

instance : ToJson Step where
  toJson s := Json.mkObj [("tactic", toJson s.tactic), ("range", toJson s.range), ("depth", toJson s.depth),
    ("goalsBefore", toJson s.goalsBefore), ("goalsAfter", toJson s.goalsAfter)]

structure Walkthrough where
  decl : Nat
  steps : Array Step
  deriving Inhabited

/-- `proofmap.json` always has the steps inline; pages may split them (`Package/Wire.lean`). -/
instance : ToJson Walkthrough where
  toJson w := Json.mkObj [("decl", toJson w.decl), ("stepCount", toJson w.steps.size), ("steps", toJson w.steps)]

structure ProofmapData where
  generator : Generator
  project : Project
  modules : Array Module
  decls : Array Decl
  walkthroughs : Array Walkthrough := #[]
  glossary : Array (String × String) := #[]

instance : ToJson ProofmapData where
  toJson d := Json.mkObj [
    ("schema", toJson schemaVersion), ("generator", toJson d.generator), ("project", toJson d.project),
    ("modules", toJson d.modules), ("decls", toJson d.decls), ("walkthroughs", toJson d.walkthroughs),
    ("glossary", Json.mkObj (d.glossary.toList.map fun (k, v) => (k, toJson v)))]

end Proofmap.Schema
