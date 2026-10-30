import Lean
import Proofmap.Schema
import Proofmap.Util

/-!
# Module import graph and module docs
-/

namespace Proofmap.Extract

open Lean

/-- Source path of a module relative to the project root (`A.B` → `A/B.lean`, or under a
package's source folder such as `.lake/packages/mathlib/`), if it exists. -/
def modulePath? (rootDir : System.FilePath) (mod : Name) : IO (Option String) := do
  let rel := "/".intercalate (mod.components.map (·.toString (escape := false))) ++ ".lean"
  for dir in ← Util.sourceDirs rootDir do
    let path := if dir == "" then rel else s!"{dir}/{rel}"
    if ← (rootDir / path).pathExists then return some path
  return none

/-- Direct imports, deduplicated (a module can import the same module more than once,
for example as both a regular and a `meta` import). -/
def moduleImports (env : Environment) (idx : ModuleIdx) : Array String :=
  match env.header.moduleData[idx.toNat]? with
  | some d => d.imports.foldl (init := #[]) fun acc i =>
    let m := toString i.module
    if acc.contains m then acc else acc.push m
  | none => #[]

/-- Module docs (`/-! ... -/`) joined as Markdown, in source order. -/
def moduleDoc? (env : Environment) (mod : Name) : Option String :=
  match getModuleDoc? env mod with
  | some docs =>
    if docs.isEmpty then none
    else some ("\n\n".intercalate (docs.toList.map (·.doc.trimAscii.toString)))
  | none => none

end Proofmap.Extract
