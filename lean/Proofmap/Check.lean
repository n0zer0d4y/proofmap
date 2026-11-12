import Proofmap.Schema
import Proofmap.Config

/-!
# `check`

Validates the config and reports what an auditor would flag: declarations that depend on
`sorry` (with the declarations the `sorry` is written in), non-standard axioms and what uses
them, and config entries that name no declaration (usually typos). With `--strict`, any of
these fails the run with exit code 3, for use in CI.
-/

namespace Proofmap.Check

open Proofmap.Schema

structure Report where
  projectDecls : Nat
  modules : Nat
  /-- Project declarations that depend on `sorry`. -/
  sorryCount : Nat
  /-- Where the `sorry` is written: affected declarations none of whose dependencies is affected. -/
  sorrySources : Array Decl
  /-- Each non-standard axiom and how many project declarations use it. -/
  axioms : Array (String × Nat)
  /-- (config table, name, closest project declaration name) for config entries that match no
  project declaration. Entries usually go stale through renames, hence the suggestion. -/
  unmatched : Array (String × String × Option String)

def Report.problems (r : Report) : Nat :=
  (if r.sorryCount > 0 then 1 else 0) + (if r.axioms.isEmpty then 0 else 1) + (if r.unmatched.isEmpty then 0 else 1)

/-- The project name closest to `name`: same last component in another namespace (a move), or a
small edit distance (a rename or typo). -/
def closest (names : Array String) (name : String) : Option String := Id.run do
  let last (n : String) := (n.splitOn ".").getLast?.getD n
  if let some n := names.find? (last · == last name) then return some n
  let limit := max 3 (name.length / 4)
  let mut best : Option (Nat × String) := none
  for n in names do
    -- Cheap length bound first: the distance is at least the length difference.
    if (n.length : Int) - name.length > limit || (name.length : Int) - n.length > limit then continue
    let d := Config.distance n name
    if d ≤ limit && best.all (d < ·.1) then best := some (d, n)
  return best.map (·.2)

def report (data : ProofmapData) (cfg : Config.Config) : Report := Id.run do
  let project := data.decls.filter (!·.external)
  -- `sorryAx` itself is an (external) declaration marked sorry; only project ones count here.
  let affected (id : Nat) := (data.decls[id]?.map fun d => !d.external && d.status.hasSorry).getD false
  let sorryDecls := project.filter (·.status.hasSorry)
  let sources := sorryDecls.filter fun d => !(d.deps.statement ++ d.deps.proof).any affected
  let mut axioms : Array (String × Nat) := #[]
  for d in project do
    for a in d.status.nonstandardAxioms do
      axioms := match axioms.findIdx? (·.1 == a) with
        | some i => axioms.modify i fun (n, k) => (n, k + 1)
        | none => axioms.push (a, 1)
  let names : Std.HashSet String := project.foldl (fun s d => s.insert d.name) {}
  let entries := cfg.roots.map (("project.roots", ·)) ++ cfg.titles.map (("titles", ·.1)) ++ cfg.summaries.map (("summaries", ·.1)) ++
    cfg.steps.map (("steps", ·.1)) ++ cfg.ranks.map (("ranks", ·.1))
  return {
    projectDecls := project.size, modules := data.modules.size, sorryCount := sorryDecls.size
    sorrySources := sources, axioms := axioms.qsort (·.1 < ·.1)
    unmatched := entries.filterMap fun (t, n) =>
      if names.contains n then none else some (t, n, closest (project.map (·.name)) n) }

private def location (d : Decl) (modules : Array Module) : String :=
  let path := (d.module.bind fun m => (modules.find? (·.name == m)).bind (·.path)).getD (d.module.getD "?")
  match d.range with
  | some r => s!"{path}:{r.start.line}"
  | none => path

def Report.render (r : Report) (data : ProofmapData) (configFile : Option System.FilePath) : String := Id.run do
  let mut out := #[s!"proofmap check: {r.projectDecls} project declarations in {r.modules} modules"]
  out := out.push s!"  config: {(configFile.map fun f => s!"{f} is valid").getD "none (proofmap.toml not present)"}"
  if r.sorryCount == 0 then out := out.push "  sorry: none"
  else
    out := out.push s!"  sorry: {r.sorryCount} declarations depend on sorry; it is written in:"
    for d in r.sorrySources do out := out.push s!"    {d.name}  ({location d data.modules})"
  if r.axioms.isEmpty then out := out.push "  non-standard axioms: none"
  else
    out := out.push "  non-standard axioms:"
    for (a, n) in r.axioms do out := out.push s!"    {a}  (used by {n} declarations)"
  unless r.unmatched.isEmpty do
    out := out.push "  warning: config entries that match no project declaration:"
    for (t, n, near) in r.unmatched do
      out := out.push s!"    [{t}] {n}{(near.map fun m => s!"  (did you mean {m}?)").getD ""}"
  out := out.push (if r.problems == 0 then "result: OK" else s!"result: {r.problems} kinds of problem (--strict fails on these)")
  return "\n".intercalate out.toList

end Proofmap.Check
