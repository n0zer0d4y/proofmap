import Proofmap.Extract.Decls
import ProofmapTests.Harness

/-! Generated declarations without a source range (`noise:generated`). -/

namespace ProofmapTests

open Proofmap.Extract

def noiseTests : TestM Unit := do
  checkEq "no range, no other flag: generated" (generatedFlag #[] false) #["noise:generated"]
  checkEq "with a range: shown" (generatedFlag #[] true) #[]
  -- An existing noise flag is kept as it is, with or without a range.
  checkEq "matcher stays a matcher" (generatedFlag #["noise:matcher"] false) #["noise:matcher"]
  checkEq "instance with a range" (generatedFlag #["noise:instance"] true) #["noise:instance"]

end ProofmapTests
