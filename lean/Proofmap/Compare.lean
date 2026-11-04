import Lean.Data.Json
import Proofmap.Package.Template

/-!
# `compare`

`proofmap compare OLD.json NEW.json [--out FILE]` prints what changed between two snapshots and
writes a page with the newer data and the older one embedded, so its compare view and map
badges work offline. The rules mirror `viewer/src/graph/compare.ts`: project declarations are
matched by name (with the module when a name repeats; generated helpers are left out), and one counts as changed when its
signature, code, status or dependencies differ.
-/

namespace Proofmap.Compare

open Lean

private def str (j : Json) (k : String) : String := (j.getObjValAs? String k).toOption.getD ""
private def arr (j : Json) (k : String) : Array Json := ((j.getObjVal? k).toOption.bind (·.getArr?.toOption)).getD #[]
private def bool (j : Json) (k : String) : Bool := (j.getObjValAs? Bool k).toOption.getD false
private def nat? (j : Json) : Option Nat := j.getNat?.toOption

/-- One snapshot's project declarations by match key, and every declaration's name by id. -/
structure Snapshot where
  json : Json
  names : Array String
  byKey : Std.HashMap String Json
  keys : Array String

def Snapshot.of (json : Json) : Snapshot := Id.run do
  let decls := arr json "decls"
  let names := decls.map (str · "name")
  -- Generated helpers (`noise:*` flags) come and go with every proof edit; they are not compared.
  let isNoise (d : Json) := (arr d "flags").any fun f => (f.getStr?.toOption.getD "").startsWith "noise:"
  let project := decls.filter fun d => !bool d "external" && !isNoise d
  let mut count : Std.HashMap String Nat := {}
  for d in project do count := count.insert (str d "name") (count.getD (str d "name") 0 + 1)
  let mut byKey := {}
  let mut keys := #[]
  for d in project do
    let n := str d "name"
    let k := if count.getD n 0 > 1 then s!"{n}~{(d.getObjValAs? String "module").toOption.getD ""}" else n
    byKey := byKey.insert k d
    keys := keys.push k
  return { json, names, byKey, keys }

private def depKey (s : Snapshot) (d : Json) : String :=
  let deps := (d.getObjVal? "deps").toOption.getD .null
  let names (k p : String) := (arr deps k).filterMap nat? |>.map fun i => p ++ s.names.getD i ""
  "\n".intercalate ((names "statement" "s:" ++ names "proof" "p:").qsort (· < ·)).toList

private def statusKey (d : Json) : String :=
  let st := (d.getObjVal? "status").toOption.getD .null
  let axs := (arr st "nonstandardAxioms").filterMap (·.getStr?.toOption)
  s!"{bool st "sorry"}|{",".intercalate (axs.qsort (· < ·)).toList}"

private def code (d : Json) : String := ((d.getObjValAs? String "code").toOption.getD "").trimAscii.toString

/-- A statement in a form that does not depend on how proofmap printed it: every linked name is
written in full, the declaration's own name is left out, and runs of white space are one space.
Versions of proofmap print names differently (0.2 prints them relative to the namespace), and that
must not count as a change. -/
private def statementKey (s : Snapshot) (d : Json) : String := Id.run do
  let cps := (str d "signature").toList.toArray
  let spans := (arr d "signatureHover").filterMap (fun h => do
      pure ((← nat? (← (h.getObjVal? "start").toOption)), (← nat? (← (h.getObjVal? "end").toOption)),
        (← nat? (← (h.getObjVal? "decl").toOption))))
    |>.qsort (fun a b => a.1 < b.1)
  let mut out := ""
  let mut pos := 0
  for (a, b, i) in spans do
    if a < pos then continue
    out := out ++ String.ofList (cps.extract pos a).toList ++ s.names.getD i (String.ofList (cps.extract a b).toList)
    pos := b
  out := out ++ String.ofList (cps.extract pos cps.size).toList
  -- Drop the head (the declaration's own name), then normalise white space.
  let words := ((out.map fun c => if c.isWhitespace then ' ' else c).splitOn " ").filter (· != "")
  return " ".intercalate (words.drop 1)

structure Diff where
  added : Array String := #[]
  removed : Array String := #[]
  /-- Name and what changed. -/
  changed : Array (String × Array String) := #[]
  nowSorryFree : Array String := #[]
  nowSorry : Array String := #[]

def diff (old new : Snapshot) : Diff := Id.run do
  let mut r : Diff := {}
  for k in new.keys do
    let d := new.byKey.get! k
    let n := str d "name"
    match old.byKey.get? k with
    | none => r := { r with added := r.added.push n }
    | some o =>
      let mut what := #[]
      if statementKey old o != statementKey new d then what := what.push "statement"
      if code o != code d then what := what.push "code"
      if statusKey o != statusKey d then what := what.push "status"
      if depKey old o != depKey new d then what := what.push "dependencies"
      unless what.isEmpty do r := { r with changed := r.changed.push (n, what) }
      let s0 := bool ((o.getObjVal? "status").toOption.getD .null) "sorry"
      let s1 := bool ((d.getObjVal? "status").toOption.getD .null) "sorry"
      if s0 && !s1 then r := { r with nowSorryFree := r.nowSorryFree.push n }
      if !s0 && s1 then r := { r with nowSorry := r.nowSorry.push n }
  for k in old.keys do
    unless new.byKey.contains k do r := { r with removed := r.removed.push (str (old.byKey.get! k) "name") }
  return r

def Diff.render (d : Diff) : String := Id.run do
  let mut out := #[s!"proofmap compare: {d.added.size} added, {d.removed.size} removed, {d.changed.size} changed; " ++
    s!"now sorry-free: {d.nowSorryFree.size}, newly depending on sorry: {d.nowSorry.size}"]
  for n in d.added do out := out.push s!"  + {n}"
  for n in d.removed do out := out.push s!"  - {n}"
  for (n, what) in d.changed do out := out.push s!"  ~ {n} ({", ".intercalate what.toList})"
  return "\n".intercalate out.toList

/-- The page: the newer snapshot as the data, the older one in a second script element. -/
def page (oldJson newJson : String) (tmpl : String := Package.template) : Except String String := do
  let close := "</script>"
  match tmpl.splitOn Package.placeholder with
  | [before, after] =>
    unless after.startsWith close do throw "viewer template: the data placeholder must end its script element"
    return before ++ Package.escapeJson newJson ++ close ++
      "\n<script id=\"proofmap-baseline\" type=\"application/json\">" ++ Package.escapeJson oldJson ++ after
  | _ => throw "viewer template must contain the data placeholder exactly once"

end Proofmap.Compare
