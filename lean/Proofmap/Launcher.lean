import Proofmap.Version
import Lean.Data.Json

/-!
# The global install's launcher

Reading a project's `.olean` files needs proofmap compiled with exactly the project's Lean
version. The global install therefore keeps the proofmap source in `~/.proofmap/src/<version>/`
and, per toolchain, builds an **engine** from it into
`~/.proofmap/engines/<toolchain>/<version>/` the first time a project with that toolchain is
used. Commands that read the project then run as `lake env <engine> …` in the project, exactly
as `lake exe proofmap` would.

The launcher is the same executable, started through the shim in `~/.proofmap/bin`, which sets
`PROOFMAP_LAUNCHER=1`. Engines are started without it, so they never delegate again.
-/

namespace Proofmap.Launcher

open System

/-- Set by the shim in `~/.proofmap/bin`. -/
def isLauncher : IO Bool := return (← IO.getEnv "PROOFMAP_LAUNCHER") == some "1"

/-- `PROOFMAP_HOME`, or `.proofmap` in the user's home folder. -/
def home : IO FilePath := do
  if let some h ← IO.getEnv "PROOFMAP_HOME" then if h != "" then return h
  let user ← if Platform.isWindows then IO.getEnv "USERPROFILE" else IO.getEnv "HOME"
  return (user.getD ".") / ".proofmap"

/-- The environment for programs the launcher starts. The shim puts the launcher's own Lean
runtime first on the library path (PATH on Windows, LD_LIBRARY_PATH elsewhere) and saves the
original values; children get the originals back, so `lake` is elan's and each toolchain loads
its own runtime. -/
def childEnv : IO (Array (String × Option String)) := do
  let restore (var saved : String) : IO (Array (String × Option String)) := do
    match ← IO.getEnv saved with
    | some v => return #[(var, if v == "" then none else some v), (saved, none)]
    | none => return #[]
  return #[("PROOFMAP_LAUNCHER", none)] ++ (← restore "PATH" "PROOFMAP_SAVED_PATH") ++
    (← restore "LD_LIBRARY_PATH" "PROOFMAP_SAVED_LD_LIBRARY_PATH")

/-- `cmd` as found on the original PATH. Windows looks a program up on the parent's PATH, not the
one passed to the child, and the launcher's PATH starts with its own Lean: by name alone, `lake`
would be that toolchain's lake instead of elan's, which picks the project's toolchain. -/
def resolve (cmd : String) : IO String := do
  let some saved ← IO.getEnv "PROOFMAP_SAVED_PATH" | return cmd
  let names := if Platform.isWindows then [".exe", ".cmd", ".bat"].map (cmd ++ ·) else [cmd]
  for d in SearchPath.parse saved do
    for n in names do
      if ← (d / n).pathExists then return (d / n).toString
  return cmd

def exeName : String := if Platform.isWindows then "proofmap.exe" else "proofmap"

/-- The nearest folder at or above `dir` with a `lean-toolchain` and a lakefile. -/
partial def findProject (dir : FilePath) : IO (Option FilePath) := do
  let isRoot ← do
    let hasLake := (← (dir / "lakefile.lean").pathExists) || (← (dir / "lakefile.toml").pathExists)
    pure (hasLake && (← (dir / "lean-toolchain").pathExists))
  if isRoot then return some dir
  match dir.parent with
  | some p => if p == dir then return none else findProject p
  | none => return none

def readToolchain (project : FilePath) : IO String :=
  return (← IO.FS.readFile (project / "lean-toolchain")).trimAscii.toString

/-- The proofmap a project's `lake-manifest.json` requires (its `inputRev`, such as `v0.3.1`, else
its commit), when the lakefile also requires proofmap; `none` otherwise. -/
def pinnedProofmap (manifest : String) : Option String := do
  let json ← (Lean.Json.parse manifest).toOption
  let packages ← (json.getObjValD "packages").getArr?.toOption
  let p ← packages.find? fun p => (p.getObjValAs? String "name").toOption == some "proofmap"
  (p.getObjValAs? String "inputRev").toOption <|> (p.getObjValAs? String "rev").toOption

/-- The note shown when a project also requires proofmap while the global install runs it. -/
def pinnedNote (rev : String) : String :=
  s!"this project's lakefile also requires proofmap ({rev}); the global install does not need it, and keeping both means two proofmap versions. Keep the require only to pin a version for everyone, or for @[proofmap ...]"

/-- `pinnedProofmap` for a project folder. -/
def projectPin (project : FilePath) : IO (Option String) := do
  let f := project / "lake-manifest.json"
  if !(← f.pathExists) then return none
  return pinnedProofmap (← IO.FS.readFile f)

structure LeanVersion where
  major : Nat
  minor : Nat
  patch : Nat
  /-- Release candidate number, if any. -/
  rc : Option Nat := none
  deriving BEq, Repr

def LeanVersion.lt (a b : LeanVersion) : Bool :=
  if a.major != b.major then a.major < b.major
  else if a.minor != b.minor then a.minor < b.minor
  else if a.patch != b.patch then a.patch < b.patch
  else match a.rc, b.rc with
    | some x, some y => x < y
    | some _, none => true
    | _, _ => false

instance : ToString LeanVersion where
  toString v := s!"v{v.major}.{v.minor}.{v.patch}" ++ (v.rc.map (s!"-rc{·}")).getD ""

/-- `leanprover/lean4:v4.29.0`, `v4.36.0-rc1`, `4.35.0` → the version; `none` for anything else
(nightlies, `stable`, forks). -/
def parseToolchain (tc : String) : Option LeanVersion := do
  let v := (tc.splitOn ":").getLast?.getD tc
  let v := if v.startsWith "v" then (v.drop 1).toString else v
  let (core, rc) ← match v.splitOn "-rc" with
    | [c] => pure (c, none)
    | [c, r] => pure (c, some (← r.toNat?))
    | _ => none
  let [a, b, c] := core.splitOn "." | none
  return { major := ← a.toNat?, minor := ← b.toNat?, patch := ← c.toNat?, rc }

/-- The oldest toolchain proofmap supports, and the newest it was
tested with. -/
def minSupported : LeanVersion := { major := 4, minor := 28, patch := 0 }
def newestTested : LeanVersion := { major := 4, minor := 35, patch := 0 }

/-- `.error` explains why the toolchain cannot be used; `.ok (some w)` is a warning. -/
def support (tc : String) : Except String (Option String) :=
  match parseToolchain tc with
  | none => .ok (some s!"toolchain '{tc}' is not a numbered release; proofmap supports {minSupported} to {newestTested} and will try anyway")
  | some v =>
    if v.lt minSupported then
      .error s!"this project uses Lean {v}, but proofmap supports {minSupported} and newer.
  Options: bump the project's lean-toolchain to {minSupported} or later, or use a proofmap
  release from that Lean's time as a project dependency (`require proofmap` in the lakefile)."
    else if newestTested.lt v then
      .ok (some s!"Lean {v} is newer than the newest toolchain proofmap was tested with ({newestTested}); if the engine fails to build, run `proofmap self-update`")
    else .ok none

/-- A folder name for a toolchain (`leanprover/lean4:v4.29.0` → `leanprover-lean4-v4.29.0`). -/
def toolchainDir (tc : String) : String :=
  tc.map fun c => if c.isAlphanum || c == '.' || c == '-' || c == '_' then c else '-'

def engineDir (h : FilePath) (tc : String) : FilePath := h / "engines" / toolchainDir tc / version
def engineExe (dir : FilePath) : FilePath := dir / ".lake" / "build" / "bin" / exeName
def sourceDir (h : FilePath) : FilePath := h / "src" / version

/-- Copy a folder, skipping `.lake` build output. -/
partial def copyTree (src dst : FilePath) : IO Unit := do
  IO.FS.createDirAll dst
  for e in ← src.readDir do
    if e.fileName == ".lake" then continue
    if ← e.path.isDir then copyTree e.path (dst / e.fileName)
    else IO.FS.writeBinFile (dst / e.fileName) (← IO.FS.readBinFile e.path)

/-- The engine for `tc`, built from the installed source on first use. -/
def ensureEngine (h : FilePath) (tc : String) : IO (Except String FilePath) := do
  let dir := engineDir h tc
  let exe := engineExe dir
  if (← (dir / "engine.ok").pathExists) && (← exe.pathExists) then return .ok exe
  let src := sourceDir h
  unless ← (src / "lakefile.lean").pathExists do
    return .error s!"the proofmap source is missing from {src}; reinstall proofmap"
  IO.println s!"proofmap: building the engine for {tc} (first use of this toolchain; this takes a few minutes and happens once)"
  if ← dir.pathExists then IO.FS.removeDirAll dir
  copyTree src dir
  IO.FS.writeFile (dir / "lean-toolchain") (tc ++ "\n")
  let child ← IO.Process.spawn { cmd := ← resolve "lake", args := #["build", "proofmap"], cwd := dir, env := ← childEnv }
  if (← child.wait) != 0 || !(← exe.pathExists) then
    return .error s!"building the engine for {tc} failed (see the output above).
  The project's Lean version may be one proofmap does not support yet; `proofmap doctor` shows details"
  IO.FS.writeFile (dir / "engine.ok") s!"{version}\n"
  IO.println s!"proofmap: engine ready ({dir})"
  return .ok exe

/-- Run the engine in the project, as `lake exe proofmap` would. -/
def delegate (project : FilePath) (exe : FilePath) (args : Array String) : IO UInt32 := do
  let child ← IO.Process.spawn {
    cmd := ← resolve "lake", args := #["env", exe.toString] ++ args, cwd := project
    env := ← childEnv }
  child.wait

/-- Engines on disk: (toolchain folder, proofmap version, folder). -/
def engines (h : FilePath) : IO (Array (String × String × FilePath)) := do
  let root := h / "engines"
  unless ← root.pathExists do return #[]
  let mut out := #[]
  for t in ← root.readDir do
    if ← t.path.isDir then
      for v in ← t.path.readDir do
        if ← v.path.isDir then out := out.push (t.fileName, v.fileName, v.path)
  return out.qsort fun a b => a.1 < b.1 || (a.1 == b.1 && a.2.1 < b.2.1)

/-- Whether `cmd` runs (for `doctor`). -/
def available (cmd : String) (args : Array String := #["--version"]) : IO (Option String) := do
  try
    let out ← IO.Process.output { cmd := ← resolve cmd, args, stdin := .null, env := ← childEnv }
    return if out.exitCode == 0 then some ((out.stdout.splitOn "\n").headD "").trimAscii.toString else none
  catch _ => return none

end Proofmap.Launcher
