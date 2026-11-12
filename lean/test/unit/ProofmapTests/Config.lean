import Proofmap.Config
import ProofmapTests.Harness

/-! Config loading and validation: malformed configs give readable errors that
name the line. -/

namespace ProofmapTests

open Proofmap.Config

private def errors (src : String) : IO (Array String) := do
  match ← parse src "proofmap.toml" with
  | .ok _ => return #[]
  | .error es => return es

private def hasError (es : Array String) (needle : String) : Bool :=
  es.any fun e => (e.splitOn needle).length > 1

def configTests : TestM Unit := do
  -- A full, valid config.
  let good := "[project]\ntitle = \"Squares\"\nroots = [\"A.b\"]\nrootModules = [\"A\", \"C\"]\n" ++
    "[display]\npreset = \"auditor\"\nfooter = false\n[sections]\nbanners = false\n" ++
    "[titles]\n\"A.b\" = \"The b theorem\"\n[summaries]\n\"A.b\" = \"Short\"\n[steps]\n\"A.b\" = \"Final\"\n[ranks]\n\"A.b\" = \"result\"\n" ++
    "[glossary]\nnpComplete = \"NP-complete\"\n"
  match ← parse good "proofmap.toml" with
  | .error es => check "valid config parses" false (toString es.toList)
  | .ok c =>
    checkEq "title" c.title (some "Squares")
    checkEq "roots" c.roots #["A.b"]
    checkEq "rootModules" c.rootModules #["A", "C"]
    checkEq "preset" c.preset (some "auditor")
    checkEq "footer" c.footer false
    checkEq "banners" c.banners false
    checkEq "titles" c.titles #[("A.b", "The b theorem")]
    checkEq "summaries" c.summaries #[("A.b", "Short")]
    checkEq "steps" c.steps #[("A.b", "Final")]
    checkEq "ranks" (c.ranks.map (·.1)) #["A.b"]
    checkEq "glossary" c.glossary #[("npComplete", "NP-complete")]
  -- TOML syntax error: the line is named.
  let es ← errors "[project]\ntitle = \"x\"\n[broken\n"
  check "syntax error names line 3" (hasError es "proofmap.toml:3:") (toString es.toList)
  -- Wrong type.
  let es ← errors "[project]\n\ntitle = 42\n"
  check "wrong type names line and key" (hasError es "proofmap.toml:3: project.title must be a string, not an integer")
    (toString es.toList)
  -- Unknown key with a suggestion.
  let es ← errors "[project]\ntitel = \"x\"\n"
  check "unknown key suggests the right one" (hasError es "proofmap.toml:2: unknown key in [project] 'titel'; did you mean 'title'?")
    (toString es.toList)
  -- Unknown table.
  let es ← errors "[projects]\ntitle = \"x\"\n"
  check "unknown table suggests" (hasError es "unknown table 'projects'; did you mean 'project'?") (toString es.toList)
  -- Bad enum values.
  let es ← errors "[display]\npreset = \"boss\"\n[ranks]\n\"A\" = \"big\"\n"
  check "bad preset" (hasError es "proofmap.toml:2: display.preset: unknown preset 'boss'") (toString es.toList)
  check "bad rank" (hasError es "proofmap.toml:4: ranks.A: unknown rank 'big'") (toString es.toList)
  -- Invalid divider regex.
  let es ← errors "[sections]\ndividerPatterns = [\"^(--\"]\n"
  check "bad divider pattern" (hasError es "proofmap.toml:2: sections.dividerPatterns: invalid pattern") (toString es.toList)
  -- Several problems are all reported.
  let es ← errors "[project]\ntitle = 1\nroots = \"A\"\n[display]\nfooter = \"yes\"\n"
  checkEq "all problems reported" es.size 3

end ProofmapTests
