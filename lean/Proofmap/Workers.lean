import Lean
import Proofmap.Version
import Proofmap.Resources
import Proofmap.Extract.Groups

/-!
# Worker processes and their cache keys

Extraction groups and proof walkthroughs both run as worker processes (this executable with a
hidden subcommand), as a pool, and both cache their results by a key. This module holds what
they share.
-/

namespace Proofmap.Workers

open Lean Proofmap.Extract

def hex (x : UInt64) : String :=
  let s := String.ofList (Nat.toDigits 16 x.toNat)
  "".pushn '0' (16 - s.length) ++ s

/-- The start of every cache key: proofmap and Lean versions, and the proofmap executable itself
(size and modification time, so a rebuilt or upgraded binary invalidates every cache entry). -/
def baseKey (extra : String) : IO UInt64 := do
  let exe ← (← IO.appPath).metadata
  let exeStamp := s!"{exe.byteSize}:{exe.modified.sec}:{exe.modified.nsec}"
  return hash (version ++ "|" ++ Lean.versionString ++ "|" ++ exeStamp ++ "|" ++ extra)

/-- Mix in the `.olean` bytes of the given project modules (sorted) and the Lake manifest. -/
def mixOLeans (h : UInt64) (rootDir : System.FilePath) (headers : Std.HashMap Name ProjectModuleHeader)
    (mods : NameSet) : IO UInt64 := do
  let mut h := h
  for m in mods.toArray.qsort (·.toString < ·.toString) do
    if let some hd := headers[m]? then
      h := mixHash h (← IO.FS.readBinFile hd.olean).hash
  let manifest := rootDir / "lake-manifest.json"
  if ← manifest.pathExists then
    h := mixHash h (← IO.FS.readBinFile manifest).hash
  return h

/-- Run `exe <command> REQUEST OUT` for each `(REQUEST, OUT)` as a pool of `jobs` slots: each slot
takes the next job as soon as its previous one finishes (so the order of `cmds` matters: put the
biggest first). Fails if any worker fails. -/
def runPool (command : String) (cmds : Array (String × String)) (jobs : Nat) : IO Unit := do
  let exe ← IO.appPath
  let next ← IO.mkRef 0
  let slot : IO (Option (String × UInt32)) := do
    repeat
      let i ← next.modifyGet fun i => (i, i + 1)
      let some (req, out) := cmds[i]? | return none
      let child ← IO.Process.spawn { cmd := exe.toString, args := #[command, req, out],
                                     stdin := .null, stdout := .inherit, stderr := .inherit }
      let code ← child.wait
      if code != 0 then return some (req, code)
    return none
  let tasks ← (List.range (min (max jobs 1) cmds.size)).mapM fun _ => IO.asTask slot (prio := .dedicated)
  for t in tasks do
    match t.get with
    | .ok none => pure ()
    | .ok (some (req, code)) => throw <| IO.userError s!"worker {command} failed (exit code {code}) for {req}"
    | .error e => throw e

/-- Memory figures learned from earlier workers on this project, per kind of worker
(`.lake/proofmap/memory.json` for extraction, `memory-walkthrough.json` for walkthroughs). -/
def memoryFile (rootDir : System.FilePath) (kind := "extract") : System.FilePath :=
  rootDir / ".lake" / "proofmap" / (if kind == "extract" then "memory.json" else s!"memory-{kind}.json")

def loadEstimate (rootDir : System.FilePath) (kind := "extract") : IO Resources.MemoryEstimate := do
  let f := memoryFile rootDir kind
  unless ← f.pathExists do return {}
  match (Json.parse (← IO.FS.readFile f)) >>= fun j => do
      pure ({ sharedBytes := ← j.getObjValAs? Nat "sharedBytes"
              privateBytes := ← j.getObjValAs? Nat "privateBytes" } : Resources.MemoryEstimate) with
  | .ok e => return e
  | .error _ => return {}

/-- Record the largest figures seen (the first measurement replaces the defaults). -/
def learnEstimate (rootDir : System.FilePath) (peak priv : Nat) (kind := "extract") : IO Unit := do
  if peak == 0 || priv == 0 then return
  let f := memoryFile rootDir kind
  let had ← f.pathExists
  let est ← loadEstimate rootDir kind
  let learned : Resources.MemoryEstimate :=
    if had then { sharedBytes := max peak est.sharedBytes, privateBytes := max priv est.privateBytes }
    else { sharedBytes := peak, privateBytes := priv }
  IO.FS.createDirAll (rootDir / ".lake" / "proofmap")
  IO.FS.writeFile f (Json.mkObj [("sharedBytes", toJson learned.sharedBytes),
    ("privateBytes", toJson learned.privateBytes)]).compress

/-- The number of workers for `n` jobs: the explicit `--jobs`, or chosen from CPUs and available
memory. Says so when it falls back to one worker for several jobs. -/
def chooseJobs (rootDir : System.FilePath) (explicit : Option Nat) (n : Nat) (kind := "extract") : IO Nat := do
  match explicit with
  | some j => return j
  | none =>
    let (j, available) ← Resources.autoJobs n (← loadEstimate rootDir kind)
    if j == 1 && n ≥ 2 then
      let gb := (available * 10 / Resources.GB).toFloat / 10
      IO.eprintln s!"proofmap: using 1 worker ({gb} GB available); pass --jobs N to override"
    return j

end Proofmap.Workers
