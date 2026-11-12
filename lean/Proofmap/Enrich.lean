import Std.Data.HashMap
import Proofmap.Schema
import Proofmap.Source.Lexer
import Proofmap.Source.Regex
import Proofmap.Source.Comments
import Proofmap.Source.Sections
import Proofmap.Extract.Rank

/-!
# Source reading, summaries, ranks and roots

Runs in the parent after the merge: it reads each project file once and fills in each module's
section tree and each project declaration's leading comment, section path, summary, step and
rank, and picks the roots.

Summary precedence: `@[proofmap summary]`, then `[summaries]` in the config, then the docstring's
first paragraph, then the leading comment's first paragraph. The lowest fallback is the title of
the enclosing section, recorded with `source = "section"` so the viewer presents it as
"In section: ...", never as a description of the declaration.
-/

namespace Proofmap

open Proofmap.Schema Proofmap.Source

/-- Author-provided overrides, from `proofmap.toml` (by declaration name). -/
structure Overrides where
  /-- Titles that replace the one made from the name (`[titles]`). -/
  titles : Std.HashMap String String := {}
  summaries : Std.HashMap String String := {}
  steps : Std.HashMap String String := {}
  ranks : Std.HashMap String Rank := {}
  /-- Root declarations by name; empty means "detect automatically". -/
  roots : Array String := #[]

private def isVisibleProject (d : Decl) : Bool :=
  !d.external && !d.flags.any (·.startsWith "noise:")

private def lastOf (s : String) : String := (s.splitOn ".").getLast?.getD s

/-- The project declarations shown on the page, by the last component of their name. -/
def nameIndex (decls : Array Decl) : Std.HashMap String (Array Nat) := Id.run do
  let mut byLast : Std.HashMap String (Array Nat) := {}
  for h : i in [0:decls.size] do
    let d := decls[i]
    if isVisibleProject d then byLast := byLast.insert (lastOf d.name) ((byLast.getD (lastOf d.name) #[]).push i)
  return byLast

/-- The declaration a name written in module `m` refers to, among those in `nameIndex`: the ones
with that full name, else those whose name ends in `.name` (written inside the module's
namespaces); of these, the one in module `m`, else the only one. `none` when it stays ambiguous
or matches nothing: a name is never guessed. -/
def resolveIn (decls : Array Decl) (byLast : Std.HashMap String (Array Nat)) (n m : String) : Option Nat :=
  let same := (byLast.getD (lastOf n) #[]).filter fun i => decls[i]!.name == n || decls[i]!.name.endsWith ("." ++ n)
  let exact := same.filter (decls[·]!.name == n)
  let cands := if exact.isEmpty then same else exact
  let inModule := cands.filter (decls[·]!.module == some m)
  if inModule.size == 1 then some inModule[0]!
  else if inModule.isEmpty && cands.size == 1 then some cands[0]!
  else none

/-- The main results the project's module docstrings list in their `## Main statements` sections
(`mainStatementNames`), in module and list order, and the listed names that name nothing
(`resolveIn`): a name that stays ambiguous or unmatched is reported, never guessed. -/
def listedRoots (decls : Array Decl) (modules : Array Schema.Module) : Array Nat × Array (String × String) := Id.run do
  let byLast := nameIndex decls
  let mut roots : Array Nat := #[]
  let mut unmatched : Array (String × String) := #[]
  for m in modules do
    let some doc := m.doc | continue
    for n in mainStatementNames doc do
      match resolveIn decls byLast n m.name with
      | some i => if !roots.contains i then roots := roots.push i
      | none => unmatched := unmatched.push (m.name, n)
  return (roots, unmatched)

/-- The `#print axioms`, `#check` and `#eval` commands of each module (`checkCommands`), recorded
on the declarations they name (`checkedBy`), in module and line order. -/
def addCheckRefs (decls : Array Decl) (modules : Array Schema.Module) (commands : String → Array (String × String × Nat)) :
    Array Decl := Id.run do
  let byLast := nameIndex decls
  let mut out := decls
  for m in modules do
    for (command, n, line) in commands m.name do
      if let some i := resolveIn decls byLast n m.name then
        let ref : CheckRef := { command, module := m.name, line }
        if !out[i]!.checkedBy.contains ref then
          out := out.modify i fun d => { d with checkedBy := d.checkedBy.push ref }
  return out

/-- Fill in sections, leading comments, summaries, steps, ranks and roots. Returns the updated
declarations and modules, the root ids, and warnings about main-result names that matched nothing. -/
def enrich (rootDir : System.FilePath) (dividerPatterns : Array Regex.Regex) (banners : Bool) (ov : Overrides)
    (decls : Array Decl) (modules : Array Schema.Module) :
    IO (Array Decl × Array Schema.Module × Array Nat × Array String) := do
  -- Per module: lexed source and section tree.
  let mut lexed : Std.HashMap String (Lexed × Std.HashMap Nat Nat × Std.HashSet Nat) := {}
  let mut mods := modules
  for h : i in [0:modules.size] do
    let m := modules[i]
    let some path := m.path | continue
    let file := rootDir / path
    unless ← file.pathExists do continue
    let lx := lex (← IO.FS.readFile file)
    let byLine := commentsByLine lx
    let heads := headings lx byLine dividerPatterns banners
    lexed := lexed.insert m.name (lx, byLine, headingLines heads)
    mods := mods.set! i { m with sections := sectionTree lx heads }
  let treeOf : Std.HashMap String (Array Section) := mods.foldl (fun acc m => acc.insert m.name m.sections) {}
  -- Per project declaration (noise included, for the "show hidden" toggle): leading comment,
  -- section path, summary, step.
  let mut out := decls
  for h : i in [0:decls.size] do
    let d := decls[i]
    if d.external then continue
    let some mod := d.module | continue
    let some r := d.range | continue
    let tree := treeOf[mod]?.getD #[]
    let path := sectionPath tree r.start.line
    let sectionTitle := (sectionAt? tree path.toList).map (·.title)
    let leading := (lexed[mod]?).bind fun (lx, byLine, structural) => leadingComment? lx byLine structural r.start.line
    let nonEmpty (s : String) := if s.isEmpty then none else some s
    let summary : Option Summary :=
      (d.tags.summary.map ({ text := ·, source := "attr" })) <|>
      ((ov.summaries[d.name]?).map ({ text := ·, source := "config" })) <|>
      ((d.docstring.bind (nonEmpty ∘ firstParagraph)).map ({ text := ·, source := "docstring" })) <|>
      ((leading.bind (nonEmpty ∘ firstParagraph)).map ({ text := ·, source := "comment" })) <|>
      (sectionTitle.map ({ text := ·, source := "section" }))
    let step := d.tags.step <|> ov.steps[d.name]? <|> sectionTitle
    let title := (ov.titles[d.name]?).getD d.title
    out := out.set! i { d with sectionPath := path, leadingComment := leading, summary, step, title }
  -- Ranks and roots over the visible project declarations.
  let visible := (List.range out.size).toArray.filter fun i => isVisibleProject out[i]!
  let dense : Std.HashMap Nat Nat := visible.size.fold (init := {}) fun k _ m => m.insert visible[k]! k
  let deps := visible.map fun i =>
    let d := out[i]!
    (d.deps.statement ++ d.deps.proof).filterMap (dense[·]?)
  let isThm (k : Nat) := out[visible[k]!]!.kind == .«theorem»
  let nameOf (k : Nat) := out[visible[k]!]!.name
  let dependents := Extract.Rank.transitiveDependents deps
  let threshold := Extract.Rank.topTenPercentThreshold dependents isThm
  -- Main results: `roots` in the config; else the `## Main statements` sections of the module
  -- docstrings (Mathlib's convention), when they name any; else chosen automatically.
  -- `#print axioms`, `#check` and `#eval` commands, on the declarations they name.
  out := addCheckRefs out mods fun mn => match lexed[mn]? with
    | some (lx, _, _) => checkCommands lx
    | none => #[]
  let (listed, unlisted) := listedRoots out mods
  let listedWarnings := unlisted.map fun (m, n) =>
    s!"`{n}` in the main statements of {m} names no project declaration (or several)"
  let (roots, unmatched) ←
    if !ov.roots.isEmpty then
      let found := ov.roots.map fun n => (n, visible.filter fun i => out[i]!.name == n)
      pure (found.flatMap (·.2), (found.filter (·.2.isEmpty)).map fun (n, _) => s!"root '{n}' from the config matches no project declaration")
    else if !listed.isEmpty then
      pure (listed, listedWarnings)
    else
      let documented (k : Nat) := (out[visible[k]!]!.docstring.getD "").trimAscii.toString != ""
      let headline (k : Nat) := Extract.Rank.statesResult (toString out[visible[k]!]!.name) out[visible[k]!]!.docstring
      -- A declaration's area is its module's folder (`A.B.C` → `A.B`), so each folder of the
      -- project gets a main result.
      let area (k : Nat) : String :=
        let parts := (out[visible[k]!]!.module.getD "").splitOn "."
        ".".intercalate (if parts.length > 1 then parts.dropLast else parts)
      pure ((Extract.Rank.autoRoots deps isThm nameOf (documented := documented) (headline := headline) (area := area)).map (visible[·]!), listedWarnings)
  for h : k in [0:visible.size] do
    let i := visible[k]
    let d := out[i]!
    let tagged := d.tags.rank <|> ov.ranks[d.name]?
    let rank := match tagged with
      | some r => r
      | none =>
        if roots.contains i then .result
        else if d.kind == .«theorem» then
          if d.docstring.isSome || dependents[k]! ≥ threshold then .«theorem» else .lemma
        else .«def»
    out := out.set! i { d with rank }
  return (out, mods, roots, unmatched)

end Proofmap
