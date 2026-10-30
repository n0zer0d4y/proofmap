import Lake.Toml
import Proofmap.Schema
import Proofmap.Source.Regex

/-!
# `proofmap.toml`

Read with Lake's own TOML parser, so no dependency is added. Every problem is reported as
`file:line: message`, and all problems are reported at once:

```toml
[project]
title = "Sums of squares"
roots = ["Nat.sum_four_squares"]
rootModules = ["Mathlib.NumberTheory.SumFourSquares"]   # each: the module and all its built submodules
repoUrl = "https://github.com/..."
[display]
preset = "reader"            # reader | mathematician | developer | auditor
footer = true
[axioms]
standard = ["propext", "Classical.choice", "Quot.sound"]
[walkthrough]
enabled = false              # true records tactic steps (slow: about as long as `lake build`)
[sections]
dividerPatterns = ["^--\\s*[─=]{2,}\\s*(.+?)\\s*[─=]*$"]
banners = true               # framed comment banners count as section headings
[summaries]
"Nat.euler_four_squares" = "Euler's four-square identity, for natural numbers"
[steps]
"Nat.Prime.sum_four_squares" = "The prime case"
[ranks]
"Nat.Prime.sum_four_squares" = "theorem"   # result | theorem | lemma | def
[glossary]
sq = "square"
```
-/

namespace Proofmap.Config

open Lean Lake Toml

structure Config where
  title : Option String := none
  roots : Array String := #[]
  rootModules : Array String := #[]
  repoUrl : Option String := none
  preset : Option String := none
  footer : Bool := true
  standardAxioms : Option (Array String) := none
  walkthrough : Bool := false
  dividerPatterns : Option (Array String) := none
  banners : Bool := true
  summaries : Array (String × String) := #[]
  steps : Array (String × String) := #[]
  ranks : Array (String × Schema.Rank) := #[]
  glossary : Array (String × String) := #[]
  deriving Inhabited

private structure Ctx where
  file : String
  fileMap : FileMap

private abbrev DecodeM := ReaderT Ctx (StateM (Array String))

private def lineOf (v : Value) : DecodeM Nat := do
  match v.ref.getPos? with
  | some p => return ((← read).fileMap.toPosition p).line
  | none => return 0

private def err (v : Value) (msg : String) : DecodeM Unit := do
  let line ← lineOf v
  let file := (← read).file
  modify (·.push (if line == 0 then s!"{file}: {msg}" else s!"{file}:{line}: {msg}"))

private def keyName (k : Name) : String := k.toString (escape := false)

private def typeName : Value → String
  | .string .. => "a string" | .integer .. => "an integer" | .float .. => "a number"
  | .boolean .. => "a boolean" | .dateTime .. => "a date" | .array .. => "an array"
  | .table .. => "a table"

private def str? (path : String) (v : Value) : DecodeM (Option String) := do
  match v with
  | .string _ s => return some s
  | _ => err v s!"{path} must be a string, not {typeName v}"; return none

private def bool? (path : String) (v : Value) : DecodeM (Option Bool) := do
  match v with
  | .boolean _ b => return some b
  | _ => err v s!"{path} must be true or false, not {typeName v}"; return none

private def strArray? (path : String) (v : Value) : DecodeM (Option (Array String)) := do
  match v with
  | .array _ xs =>
    let mut out := #[]
    for x in xs do
      match x with
      | .string _ s => out := out.push s
      | _ => err x s!"{path} must contain only strings, found {typeName x}"; return none
    return some out
  | _ => err v s!"{path} must be an array of strings, not {typeName v}"; return none

/-- A table of `name = "text"` entries. -/
private def strTable (path : String) (v : Value) : DecodeM (Array (String × String)) := do
  match v with
  | .table _ t =>
    let mut out := #[]
    for (k, x) in t.items do
      if let some s ← str? s!"{path}.{keyName k}" x then out := out.push (keyName k, s)
    return out
  | _ => err v s!"[{path}] must be a table, not {typeName v}"; return #[]

/-- Edit distance, for "did you mean" hints. -/
def distance (a b : String) : Nat := Id.run do
  let a := a.toList.toArray; let b := b.toList.toArray
  let mut prev := (List.range (b.size + 1)).toArray
  for h : i in [0:a.size] do
    let mut cur := #[i + 1]
    for h' : j in [0:b.size] do
      let cost := if a[i] == b[j] then 0 else 1
      cur := cur.push (min (min (prev[j + 1]! + 1) (cur[j]! + 1)) (prev[j]! + cost))
    prev := cur
  return prev[b.size]!

private def unknown (v : Value) (what : String) (name : String) (known : List String) : DecodeM Unit := do
  let close := known.filter fun k => distance k name ≤ 2
  let hint := match close with
    | [] => s!"; known: {", ".intercalate known}"
    | k :: _ => s!"; did you mean '{k}'?"
  err v s!"unknown {what} '{name}'{hint}"

private def presets : List String := ["reader", "mathematician", "developer", "auditor"]

private def tables : List String :=
  ["project", "display", "axioms", "walkthrough", "sections", "summaries", "steps", "ranks", "glossary"]

private def decode (t : Table) : DecodeM Config := do
  let mut c : Config := {}
  for (k, v) in t.items do
    let sect := keyName k
    let entries ← match v with
      | .table _ entries => pure (some entries)
      | _ =>
        if tables.contains sect then err v s!"[{sect}] must be a table, not {typeName v}"
        else unknown v "table" sect tables
        pure none
    let some entries := entries | continue
    if !tables.contains sect then
      unknown v "table" sect tables
      continue
    match sect with
    | "summaries" => c := { c with summaries := ← strTable sect v }
    | "steps" => c := { c with steps := ← strTable sect v }
    | "glossary" => c := { c with glossary := ← strTable sect v }
    | "ranks" =>
      for (name, r) in ← strTable sect v do
        match Schema.Rank.ofString? r with
        | some rank => c := { c with ranks := c.ranks.push (name, rank) }
        | none =>
          let x := (entries.items.find? fun (k', _) => keyName k' == name).map (·.2) |>.getD v
          err x s!"ranks.{name}: unknown rank '{r}'; expected result, theorem, lemma or def"
    | _ =>
      for (k2, x) in entries.items do
        let key := keyName k2
        let path := s!"{sect}.{key}"
        match sect, key with
        | "project", "title" => c := { c with title := ← str? path x }
        | "project", "roots" => c := { c with roots := (← strArray? path x).getD #[] }
        | "project", "rootModules" => c := { c with rootModules := (← strArray? path x).getD #[] }
        | "project", "repoUrl" => c := { c with repoUrl := ← str? path x }
        | "display", "preset" =>
          if let some p ← str? path x then
            if presets.contains p then c := { c with preset := some p }
            else err x s!"{path}: unknown preset '{p}'; expected {", ".intercalate presets}"
        | "display", "footer" => c := { c with footer := (← bool? path x).getD false }
        | "axioms", "standard" => c := { c with standardAxioms := ← strArray? path x }
        | "walkthrough", "enabled" => c := { c with walkthrough := (← bool? path x).getD false }
        | "sections", "dividerPatterns" =>
          if let some ps ← strArray? path x then
            for p in ps do
              if let .error e := Regex.compile p then err x s!"{path}: invalid pattern {repr p}: {e}"
            c := { c with dividerPatterns := some ps }
        | "sections", "banners" => c := { c with banners := (← bool? path x).getD false }
        | _, _ =>
          let known := match sect with
            | "project" => ["title", "roots", "rootModules", "repoUrl"]
            | "display" => ["preset", "footer"]
            | "axioms" => ["standard"]
            | "walkthrough" => ["enabled"]
            | _ => ["dividerPatterns", "banners"]
          unknown x s!"key in [{sect}]" key known
  return c

/-- Parse and validate config text. `Except.error` holds every problem, one per line. -/
def parse (src : String) (fileName : String) : IO (Except (Array String) Config) := do
  let ictx := Parser.mkInputContext src fileName
  match ← (loadToml ictx).toBaseIO with
  | .error log =>
    let msgs ← log.toList.mapM fun m => do
      -- The parser quotes the offending character, which may be a line break.
      let text := ((← m.data.toString).trimAscii.toString.replace "'\n'" "end of line").replace "\n" " "
      return s!"{fileName}:{m.pos.line}: {text}"
    return .error msgs.toArray
  | .ok table =>
    let (c, errors) := ((decode table).run { file := fileName, fileMap := ictx.fileMap }).run #[]
    return if errors.isEmpty then .ok c else .error errors

/-- Load a config file. -/
def load (path : System.FilePath) : IO (Except (Array String) Config) := do
  parse (← IO.FS.readFile path) path.fileName.get!

end Proofmap.Config
