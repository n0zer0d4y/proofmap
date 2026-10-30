import ProofmapTests.Harness
import ProofmapTests.Lexer
import ProofmapTests.Regex
import ProofmapTests.Sections
import ProofmapTests.Rank
import ProofmapTests.Config
import ProofmapTests.Serve
import ProofmapTests.Launcher
import ProofmapTests.Noise

/-! Unit test driver: `lake test`. Exit code 1 when any check fails. -/

open ProofmapTests

def main : IO UInt32 := do
  let ((), r) ← (do
    lexerTests
    regexTests
    sectionTests
    rankTests
    configTests
    serveTests
    launcherTests
    noiseTests : TestM Unit).run {}
  for f in r.failures do IO.eprintln s!"FAIL {f}"
  IO.println s!"unit tests: {r.passed} passed, {r.failures.size} failed"
  return if r.failures.isEmpty then 0 else 1
