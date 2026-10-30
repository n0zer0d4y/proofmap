import Lean

namespace Proofmap.Extract

open Lean

/-- Import modules from their built `.olean` files, using the search path from `LEAN_PATH`
(set by `lake env` / `lake exe`). Environment extensions are loaded (as Lake does), because
instance, docstring and other attribute data live there. -/
unsafe def loadEnvUnsafe (mods : Array Name) : IO Environment := do
  initSearchPath (← findSysroot)
  enableInitializersExecution
  importModules (mods.map fun m => { module := m }) {} (trustLevel := 1024)
    (leakEnv := true) (loadExts := true)

@[implemented_by loadEnvUnsafe]
opaque loadEnv (mods : Array Name) : IO Environment

/--
Module names of an environment, materialized once. `EnvironmentHeader.moduleNames` builds a
new array on every call (over 10,000 entries for a Mathlib project), so it must never be called
per declaration: doing so made extraction of a 130-module Mathlib project take minutes.
-/
structure ModIndex where
  names : Array Name
  /-- `project[i]` says whether module `i` is a project module. -/
  project : Array Bool

def ModIndex.build (env : Environment) (projectSet : NameSet) : ModIndex :=
  let names := env.header.moduleNames
  { names, project := names.map projectSet.contains }

def ModIndex.moduleOf? (ix : ModIndex) (env : Environment) (n : Name) : Option Name := do
  let idx ← env.getModuleIdxFor? n
  ix.names[idx.toNat]?

def ModIndex.isProject (ix : ModIndex) (env : Environment) (n : Name) : Bool :=
  match env.getModuleIdxFor? n with
  | some idx => ix.project[idx.toNat]?.getD false
  | none => false

end Proofmap.Extract
