import Lake
open Lake DSL
open Lean Elab Command

/-
The `serve` command needs TCP sockets, and the module providing them differs by
toolchain: newer toolchains ship `Std.Async.TCP`, older ones (such as v4.29.0) have
the same API as `Std.Internal.IO.Async.TCP`. Lean has no conditional imports, so the
`ProofmapCompat` library takes its sources from `compat/async` or `compat/internal`,
chosen by whether the running toolchain ships `Std/Async/TCP.olean`.
-/
run_cmd do
  let sysroot := (← IO.appDir).parent.getD "."
  let hasAsync ← (sysroot / "lib" / "lean" / "Std" / "Async" / "TCP.olean").pathExists
  let dir := if hasAsync then "compat/async" else "compat/internal"
  elabCommand (← `(def $(mkIdent `compatDir) : System.FilePath := System.FilePath.mk $(quote dir)))

package proofmap where
  version := v!"0.4.1"

lean_lib ProofmapCompat where
  srcDir := compatDir
  roots := #[`ProofmapCompat.Serve]

/-- The prebuilt single-file viewer (built by `viewer/`), embedded with `include_str` in
`Proofmap.Package.Template`. Declared as an input so a new viewer rebuilds the library. -/
input_file viewerTemplate where
  path := "assets/viewer.html"
  text := true

@[default_target]
lean_lib Proofmap where
  needs := #[viewerTemplate]

@[default_target]
lean_exe proofmap where
  root := `Main
  supportInterpreter := true

/-- Unit tests (`lake test`): lexer, regex, section parser, humanizer, config validation. -/
lean_lib ProofmapTests where
  srcDir := "test/unit"

@[test_driver]
lean_exe «proofmap-tests» where
  srcDir := "test/unit"
  root := `ProofmapTests
