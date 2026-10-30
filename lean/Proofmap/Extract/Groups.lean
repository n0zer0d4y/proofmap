import Lean
import Proofmap.Util

/-!
# Project modules and clash-free import groups

A library is every module its lakefile globs build, and a library may contain modules that
are never imported together (for example two modules declaring the same top-level name).
So the project modules are found on disk (`.andSubmodules` reading of each root), and they
are split into groups that can each be imported into one environment.

Only `.olean` headers are read here: each module's imports and constants. The duplicate rule
follows `importModules` (`subsumesInfo` in `Lean/Environment.lean`): the same name may come
from two modules only when both are theorems with identical statements. Lean also accepts a
few axiom cases; treating those as clashes can only split groups further, never merge
modules that cannot be imported together.
-/

namespace Proofmap.Extract

open Lean

partial def leanFilesUnder (dir : System.FilePath) : IO (Array System.FilePath) := do
  let mut out := #[]
  for e in ← dir.readDir do
    if ← e.path.isDir then out := out ++ (← leanFilesUnder e.path)
    else if e.path.extension == some "lean" then out := out.push e.path
  return out

/-- Module name of a source file below `base` (`A/B/C.lean` → `A.B.C`). -/
def moduleOfPath (base file : System.FilePath) : Name :=
  let rel := (file.toString.drop (base.toString.length + 1)).toString
  let rel := rel.map fun c => if c == '\\' then '/' else c
  let rel := if rel.endsWith ".lean" then (rel.dropEnd 5).toString else rel
  (rel.splitOn "/").foldl Name.str .anonymous

/-- The `.olean` of a module, if it has been built. -/
def builtOLean? (mod : Name) : IO (Option System.FilePath) := do
  try
    let p ← findOLean mod
    return if ← p.pathExists then some p else none
  catch _ => return none

/-- Each root module and all its submodules that have a source file under `rootDir` (or a package source folder inside it, see `Util.sourceDirs`) and a
built `.olean`. Returns `(found, sourceFilesWithoutOLean)`. -/
def discoverModules (rootDir : System.FilePath) (roots : Array Name) : IO (Array Name × Array Name) := do
  let mut candidates : Array Name := #[]
  let dirs ← Util.sourceDirs rootDir
  for r in roots do
    let rel := "/".intercalate (r.components.map (·.toString (escape := false)))
    -- The project first, then packages' source folders (for roots such as `Mathlib.Data.List`).
    for dir in dirs do
      let base := if dir == "" then rootDir else rootDir / dir
      let file ← (base / (rel ++ ".lean")).pathExists
      let folder ← (base / rel).isDir
      if file then candidates := candidates.push r
      if folder then
        for f in ← leanFilesUnder (base / rel) do
          candidates := candidates.push (moduleOfPath base f)
      if file || folder then break
  let unique := candidates.foldl (fun acc m => if acc.contains m then acc else acc.push m) #[]
  let mut found := #[]
  let mut missing := #[]
  for m in unique do
    if (← builtOLean? m).isSome then found := found.push m else missing := missing.push m
  let byName (a b : Name) : Bool := a.toString < b.toString
  return (found.qsort byName, missing.qsort byName)

structure ProjectModuleHeader where
  olean : System.FilePath
  /-- Imports that are project modules. -/
  projectImports : Array Name
  constants : Array ConstantInfo

def readHeaders (mods : Array Name) : IO (Std.HashMap Name ProjectModuleHeader) := do
  let projectSet : NameSet := mods.foldl (·.insert ·) {}
  let mut out := {}
  for m in mods do
    let olean ← findOLean m
    let (d, _) ← readModuleData olean
    out := out.insert m {
      olean, constants := d.constants
      projectImports := d.imports.map (·.module) |>.filter projectSet.contains }
  return out

/-- Whether `importModules` accepts both constants under one name. -/
def compatibleDuplicates (a b : ConstantInfo) : Bool :=
  a.type == b.type && a.levelParams == b.levelParams &&
    match a, b with
    | .thmInfo x, .thmInfo y => x.all == y.all
    | _, _ => false

/-- Project modules imported (transitively) by `m`, including `m`. -/
partial def projectClosure (headers : Std.HashMap Name ProjectModuleHeader) (m : Name) (seen : NameSet := {}) : NameSet := Id.run do
  if seen.contains m then return seen
  let mut s := seen.insert m
  for i in (headers[m]?.map (·.projectImports)).getD #[] do
    s := projectClosure headers i s
  return s

private structure Group where
  members : Array Name := #[]
  union : NameSet := {}
  table : Std.HashMap Name ConstantInfo := {}

/-- Split the modules into the fewest groups the greedy rule finds (largest import closure
first), such that each group's import union has no clashing names. Deterministic. -/
def importGroups (headers : Std.HashMap Name ProjectModuleHeader) (mods : Array Name) : Array (Array Name) := Id.run do
  let closures : Std.HashMap Name (Array Name) :=
    mods.foldl (fun acc m => acc.insert m (projectClosure headers m).toArray) {}
  let size (m : Name) := (closures[m]?.map (·.size)).getD 0
  let order := mods.qsort fun a b => size a > size b || (size a == size b && a.toString < b.toString)
  let mut groups : Array Group := #[]
  for m in order do
    let cl := closures[m]?.getD #[m]
    let fits (g : Group) : Bool := Id.run do
      for x in cl do
        if g.union.contains x then continue
        for c in (headers[x]?.map (·.constants)).getD #[] do
          if let some prev := g.table[c.name]? then
            if !compatibleDuplicates prev c then return false
      return true
    let add (g : Group) : Group := Id.run do
      let mut g := { g with members := g.members.push m }
      for x in cl do
        if g.union.contains x then continue
        g := { g with union := g.union.insert x }
        for c in (headers[x]?.map (·.constants)).getD #[] do
          g := { g with table := g.table.insert c.name c }
      return g
    match groups.findIdx? fits with
    | some i => groups := groups.modify i add
    | none => groups := groups.push (add {})
  return groups.map fun g => g.members.qsort (·.toString < ·.toString)

end Proofmap.Extract
