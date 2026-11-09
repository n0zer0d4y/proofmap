import Proofmap.Extract.Pretty
import Proofmap.Util
import ProofmapTests.Harness

/-! Readable titles from Lean names. -/

namespace ProofmapTests

open Lean Proofmap.Extract

private def title (n : Name) : String := humanize defaultGlossary n

def titleTests : TestM Unit := do
  checkEq "glossary words" (title `Nat.eq_sq_add_sq_iff) "Equals square add square if and only if"
  checkEq "mul reads as times" (title `isSquare_neg_one_mul) "Is square negative one times"
  checkEq "capital after lower-case stays" (title `inP) "In P"
  checkEq "capital after lower-case stays (count)" (title `countP) "Count P"
  checkEq "single letter keeps its digits" (title `f3Enc) "F3 enc"
  checkEq "acronym stays" (title `cnfGCDBound) "Cnf GCD bound"
  checkEq "first letter capitalised" (title `sum_four_squares) "Sum four squares"
  checkEq "primes become variants" (title `double_eq_add') "Double equals add (variant)"

open Proofmap.Util in
/-- Pages record the project folder relative to themselves, never an absolute path. -/
def pageToRootTests : TestM Unit := do
  checkEq "same folder" (relativeDir "/home/a/proj" "/home/a/proj") (some "")
  checkEq "page in a subfolder" (relativeDir "/home/a/proj/docs" "/home/a/proj") (some "..")
  checkEq "page two levels down" (relativeDir "/home/a/proj/docs/site" "/home/a/proj") (some "../..")
  checkEq "page beside the project" (relativeDir "/home/a/out" "/home/a/proj") (some "../proj")
  -- Only a path that climbs is recorded: one that names folders would reveal them.
  checkEq "recorded: page in the project folder" (upOnly "") (some "")
  checkEq "recorded: page below the project" (upOnly "../..") (some "../..")
  checkEq "not recorded: page beside the project" (upOnly "../proj") none
  checkEq "not recorded: page far from the project" (upOnly "../../../Users/me/Projects/proj") none
  if System.Platform.isWindows then
    checkEq "different drives" (relativeDir "D:/out" "C:/proj") none
