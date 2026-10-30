import Proofmap.Source.Sections
import Proofmap.Source.Comments
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
