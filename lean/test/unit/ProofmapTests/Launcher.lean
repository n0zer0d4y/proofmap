import Proofmap.Launcher
import Proofmap.Check
import Proofmap.Lakefile
import ProofmapTests.Harness

/-! Global install: toolchain parsing and the supported range, engine folder
names, and `check`'s suggestions for stale config names. -/

namespace ProofmapTests

open Proofmap.Launcher

def launcherTests : TestM Unit := do
  checkEq "full toolchain" (parseToolchain "leanprover/lean4:v4.29.0") (some { major := 4, minor := 29, patch := 0 })
  checkEq "rc" (parseToolchain "leanprover/lean4:v4.36.0-rc1") (some { major := 4, minor := 36, patch := 0, rc := some 1 })
  checkEq "bare" (parseToolchain "4.35.0") (some { major := 4, minor := 35, patch := 0 })
  checkEq "nightly" (parseToolchain "leanprover/lean4:nightly-2026-10-01") none
  check "rc before release" ((LeanVersion.mk 4 36 0 (some 1)).lt (LeanVersion.mk 4 36 0 none))
  check "older minor" ((LeanVersion.mk 4 29 0 none).lt (LeanVersion.mk 4 35 0 none))
  check "4.27 unsupported" (match support "leanprover/lean4:v4.27.0" with | .error _ => true | _ => false)
  check "4.28 supported" (match support "leanprover/lean4:v4.28.0" with | .ok none => true | _ => false)
  check "4.29 supported" (match support "leanprover/lean4:v4.29.0" with | .ok none => true | _ => false)
  check "4.35 supported" (match support "leanprover/lean4:v4.35.0" with | .ok none => true | _ => false)
  check "4.37 warns" (match support "leanprover/lean4:v4.37.0" with | .ok (some _) => true | _ => false)
  check "nightly warns" (match support "leanprover/lean4:nightly-2026-10-01" with | .ok (some _) => true | _ => false)
  checkEq "engine folder" (toolchainDir "leanprover/lean4:v4.29.0") "leanprover-lean4-v4.29.0"
  let names := #["Nat.sum_four_squares", "Nat.euler_four_squares", "Fixture.unfinished"]
  checkEq "typo" (Proofmap.Check.closest names "Nat.sum_four_squars") (some "Nat.sum_four_squares")
  checkEq "moved" (Proofmap.Check.closest names "Old.euler_four_squares") (some "Nat.euler_four_squares")
  checkEq "unrelated" (Proofmap.Check.closest names "Totally.Different.Thing") none
  -- Default roots from lakefiles.
  let lakefile := "package «squares» where\n\n@[default_target]\nlean_lib «Squares» where\n  globs := #[.andSubmodules `Squares]\n\n" ++
    "-- lean_lib Commented where\n@[default_target]\nlean_lib «Extras» where\n  globs := #[.andSubmodules `Extras]\n"
  checkEq "lakefile.lean globs" (Proofmap.Lakefile.fromLean lakefile) #["Squares", "Extras"]
  checkEq "lakefile.lean plain and roots"
    (Proofmap.Lakefile.fromLean "lean_lib Foo\n\nlean_lib Bar where\n  roots := #[`Bar.Main, `Bar.Extra]\n\nlean_exe tool where\n  root := `Main\n")
    #["Foo", "Bar.Main", "Bar.Extra"]
  let toml ← Proofmap.Lakefile.fromToml "name = \"fixture\"\n[[lean_lib]]\nname = \"Fixture\"\nglobs = [\"Fixture.*\"]\n[[lean_lib]]\nname = \"Other\"\n"
  checkEq "lakefile.toml" toml #["Fixture", "Other"]

end ProofmapTests
