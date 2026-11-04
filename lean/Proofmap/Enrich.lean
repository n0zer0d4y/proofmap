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
  summaries : Std.HashMap String String := {}
  steps : Std.HashMap String String := {}
  ranks : Std.HashMap String Rank := {}
  /-- Root declarations by name; empty means "detect automatically". -/
  roots : Array String := #[]

private def isVisibleProject (d : Decl) : Bool :=
  !d.external && !d.flags.any (·.startsWith "noise:")

/-- Fill in sections, leading comments, summaries, steps, ranks and roots. Returns the updated
declarations and modules, the root ids, and the root names that matched nothing. -/
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
    out := out.set! i { d with sectionPath := path, leadingComment := leading, summary, step }
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
  let (roots, unmatched) ←
    if ov.roots.isEmpty then
      let documented (k : Nat) := (out[visible[k]!]!.docstring.getD "").trimAscii.toString != ""
      let headline (k : Nat) := Extract.Rank.statesResult (toString out[visible[k]!]!.name) out[visible[k]!]!.docstring
      pure ((Extract.Rank.autoRoots deps isThm nameOf (documented := documented) (headline := headline)).map (visible[·]!), #[])
    else
      let found := ov.roots.map fun n => (n, visible.filter fun i => out[i]!.name == n)
      pure (found.flatMap (·.2), (found.filter (·.2.isEmpty)).map (·.1))
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
