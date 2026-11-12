import Proofmap.Source.Sections
import Proofmap.Source.Comments
import Proofmap.Enrich
import ProofmapTests.Harness

/-! Leading comments and section trees. -/

namespace ProofmapTests

open Proofmap.Source Proofmap.Schema

private def dividers := defaultDividerPatterns.filterMap fun p => (Proofmap.Regex.compile p).toOption

/-- Titles of the tree, nested with `>`, one entry per section in document order. -/
private partial def outline (tree : Array Section) (pre : String := "") : Array String :=
  tree.flatMap fun s =>
    let here := pre ++ s.title
    #[s!"{here} [{s.range.start.line}-{s.range.stop.line}]"] ++ outline s.children (here ++ " > ")

private def lead (src : String) (line : Nat) : Option String :=
  let lx := lex src
  let byLine := commentsByLine lx
  leadingComment? lx byLine (headingLines (headings lx byLine dividers)) line

private def tree (src : String) : Array Section :=
  let lx := lex src
  sectionTree lx (headings lx (commentsByLine lx) dividers)

def sectionTests : TestM Unit := do
  -- Main statements (Mathlib's module docstring convention): leading backticked names only.
  let mathlibDoc := "# Diophantine functions\n\nIntro mentioning `ignored_here`.\n\n## Main statements\n\n" ++
    "* `pell_dioph` states that solutions to Pell's equation form a Diophantine set.\n" ++
    "* `pow_dioph` states that the power function is Diophantine, unlike `not_this`.\n\n## References\n\n* `not_a_result`\n"
  checkEq "main statements: leading names, up to the next section" (mainStatementNames mathlibDoc) #["pell_dioph", "pow_dioph"]
  checkEq "main statements: Main results, several names, numbered items"
    (mainStatementNames "## Main results\n1. `A.x`, `A.y` and `@B.z`: the three.\n2. `C.w` / `C.v`\n") #["A.x", "A.y", "B.z", "C.w", "C.v"]
  checkEq "main statements: a file titled # Main results is not the section"
    (mainStatementNames "# Main results\n\n## Doubling\n\n* `double_eq` here\n") #[]
  checkEq "main statements: prose and expressions are not names"
    (mainStatementNames "## Main statements\nSee `Other.File` for more.\n* ℕ is a `GCDMonoid`\n* `a ↔ b` holds\n") #[]
  checkEq "main statements: a heading with more words after the name still counts"
    (mainStatementNames "## Main results (this file)\n* `r1`: one.\n## Main statements of part two\n* `r2`\n") #["r1", "r2"]
  checkEq "main statements: other headings do not"
    (mainStatementNames "## Key lemmas\n* `k1`\n## The main results\n* `k2`\n") #[]
  checkEq "main statements: a subsection stays inside, a sibling ends it"
    (mainStatementNames "## Main theorems\n### Part one\n- `p1`\n## Notation\n- `n1`\n") #["p1"]
  -- Resolution against the project's declarations (full name, same module, or the only one).
  let decl (i : Nat) (n m : String) : Decl :=
    { id := i, name := n, title := n, kind := .«theorem», module := some m, external := false }
  let decls := #[decl 0 "Dioph.pell_dioph" "M.Dioph", decl 1 "Other.pell_dioph" "M.Other",
    decl 2 "Top.unique" "M.Other", decl 3 "A.dup" "M.A", decl 4 "B.dup" "M.B"]
  let listing := "## Main statements\n* `pell_dioph`: in this file\n* `unique`: elsewhere, the only one\n" ++
    "* `dup`: two others\n* `missing`\n* `Other.pell_dioph`: by full name\n"
  let mods : Array Proofmap.Schema.Module := #[{ name := "M.Dioph", path := none, imports := #[], doc := some listing }]
  checkEq "main statements: resolved in the file first, else the only one, else by full name"
    (Proofmap.listedRoots decls mods) (#[0, 2, 1], #[("M.Dioph", "dup"), ("M.Dioph", "missing")])
  -- `#print axioms` / `#check` / `#eval` on their own lines, with code; not in comments.
  let cmdSrc := "theorem a : True := trivial\n#print axioms a\n  #check @Foo.b\n#check (a : True)\n#eval c 3\n" ++
    "-- #print axioms in_a_line_comment\n/- #check in_a_block\n#print axioms still_in_block -/\n#check 1 + 1\n#printaxioms x\n"
  checkEq "commands: audits, checks and evals named on their own lines"
    (checkCommands (lex cmdSrc)) #[("print axioms", "a", 2), ("check", "Foo.b", 3), ("eval", "c", 5)]
  -- The same full name in two modules: the one in the module that names it.
  let twins := #[decl 0 "swap_symm" "M.Left", decl 1 "swap_symm" "M.Right", decl 2 "N.only_here" "M.Other"]
  let idx := Proofmap.nameIndex twins
  checkEq "resolve: a name two modules share, from one of them" (Proofmap.resolveIn twins idx "swap_symm" "M.Right") (some 1)
  checkEq "resolve: a name two modules share, from a third module" (Proofmap.resolveIn twins idx "swap_symm" "M.Other") none
  checkEq "resolve: the only one, from anywhere" (Proofmap.resolveIn twins idx "only_here" "M.Left") (some 2)
  let cmdMods : Array Proofmap.Schema.Module := #[{ name := "M.Right", path := none, imports := #[] }]
  let checked := Proofmap.addCheckRefs twins cmdMods fun _ => #[("print axioms", "swap_symm", 930), ("check", "nothing", 9)]
  checkEq "check refs: recorded on the declaration the command names"
    (checked.map (·.checkedBy.size), checked[1]!.checkedBy[0]!.line, checked[1]!.checkedBy[0]!.command) (#[0, 1, 0], 930, "print axioms")
  -- Summaries: the first paragraph, after any headings.
  checkEq "summary: first paragraph" (firstParagraph "One line\nand more.\n\nSecond.") "One line and more."
  checkEq "summary: a leading heading is skipped" (firstParagraph "## The four-square theorem\n\nEvery natural number is a sum of four squares.") "Every natural number is a sum of four squares."
  checkEq "summary: a heading right above the text" (firstParagraph "# Title\nThe text.") "The text."
  checkEq "summary: only a heading gives its words" (firstParagraph "## The four-square theorem") "The four-square theorem"
  checkEq "summary: a heading ends the paragraph" (firstParagraph "The text.\n## Next") "The text."
  checkEq "summary: #eval is not a heading" (firstParagraph "#eval f 3\nshows 9.") "#eval f 3 shows 9."
  -- Leading comments.
  checkEq "line comments above" (lead "-- one\n-- two\ndef x := 1" 3) (some "one\ntwo")
  checkEq "one blank line allowed" (lead "-- c\n\ndef x := 1" 3) (some "c")
  checkEq "two blank lines stop" (lead "-- c\n\n\ndef x := 1" 4) none
  checkEq "code stops" (lead "-- c\ndef y := 2\ndef x := 1" 3) none
  checkEq "trailing comment is not leading" (lead "def y := 2 -- c\ndef x := 1" 2) none
  checkEq "command prefix `... in` is looked past" (lead "-- c\ninclude h in\nomit [I] in\nlemma x : True := trivial" 4) (some "c")
  checkEq "other code still stops" (lead "-- c\ninclude h\nlemma x : True := trivial" 3) none
  checkEq "divider is not leading" (lead "-- ── Facts ──\ndef x := 1" 2) none
  checkEq "doc comment of something else stops" (lead "/-- doc -/\n-- c\ndef x := 1" 3) (some "c")
  checkEq "block comment, nested, indented" (lead "/- a /- b -/\n   c -/\ndef x := 1" 3) (some "a /- b -/\nc")
  checkEq "decoration stripped, markdown kept" (lead "-- note:\n-- - item\n-- ====\ndef x := 1" 4) (some "note:\n- item")
  -- Section tree.
  let src := "/-!\n# Top\nAbout the file.\n## Sub\n-/\nnamespace A\n-- ── One ──\ndef a := 1\n" ++
    "-- ── Two ──\nsection S\ndef b := 2\nend S\ndef c := 3\nend A\nsection\ndef d := 4\nend\n"
  let t1 := tree src
  -- `## Sub` nests inside `# Top`; the file has 18 lines (the last one empty).
  checkEq "outline" (outline t1)
    #["Top [2-18]", "Top > Sub [4-18]", "Top > Sub > A [6-14]", "Top > Sub > A > One [7-8]",
      "Top > Sub > A > Two [9-14]", "Top > Sub > A > Two > S [10-12]"]
  checkEq "heading description" ((t1[0]?).bind (·.description)) (some "About the file.")
  checkEq "path of b" (sectionPath t1 11) #[0, 0, 0, 1, 0]
  checkEq "path of c (divider Two still open)" (sectionPath t1 13) #[0, 0, 0, 1]
  checkEq "path of d (unnamed section is transparent)" (sectionPath t1 16) #[0, 0]
  checkEq "frame line alone is not a divider or a comment" (lead "-- ====\ndef x := 1" 2) none
  -- `end` without a name does not close a named section.
  let tree2 := tree "section S\nsection\nend\ndef x := 1\nend S\n"
  checkEq "bare end closes unnamed section only" (outline tree2) #["S [1-5]"]
  -- Fenced code in module docs is not a heading.
  let tree3 := tree "/-!\n# Real\n```\n# not a heading\n```\n-/\n"
  checkEq "fenced code skipped" ((outline tree3).size) 1
  -- A Markdown heading made only of box-drawing characters is decoration, not a section.
  let tree4 := tree "/-!
# ═══════════
# Definitions
-/
"
  checkEq "decorative heading skipped" ((outline tree4).map fun s => (s.splitOn " ")[0]!) #["Definitions"]
  -- Banners (frame, title, frame) are headings, not leading comments.
  let banner := "-- ════════\n-- 1. DEFINITIONS\n-- More words.\n-- ════════\n\ndef x := 1\n"
  checkEq "banner is not a leading comment" (lead banner 6) none
  checkEq "banner is a section" (outline (tree banner)) #["1. DEFINITIONS [1-7]"]
  checkEq "banner description" ((tree banner)[0]?.bind (·.description)) (some "More words.")
  -- Comment lines right under a divider describe the section, not the next declaration.
  let under := "-- ── Wrappers ──\n-- Explains the section.\n\n/-- Doc. -/\ndef x := 1\n"
  checkEq "comment under divider is not leading" (lead under 4) none
  checkEq "comment under divider is the description" ((tree under)[0]?.bind (·.description))
    (some "Explains the section.")
  -- With a blank line in between, the comment belongs to the declaration.
  checkEq "comment after a blank line is leading" (lead "-- ── W ──\n\n-- About x.\ndef x := 1" 4) (some "About x.")

end ProofmapTests
