/-!
# Machine resources, for choosing the number of parallel group workers

Lean has no portable API for CPU count or memory, so these ask the operating system. Every
probe falls back to a conservative value when it fails.

Memory model (measured on a Mathlib project): a worker's working
set is mostly memory-mapped `.olean` pages that all workers share; its own (private) memory is
small, about 0.4 GB. So the shared part is counted once and the private part once per worker:

  jobs = clamp(1 .. min(groups, CPUs), (available - reserve - shared) / private)
-/

namespace Proofmap.Resources

def GB : Nat := 1024 * 1024 * 1024

/-- Memory kept free for the rest of the machine. -/
def reserveBytes : Nat := 3 * GB / 2
/-- Defaults when no worker has been measured yet on this project. -/
def defaultSharedBytes : Nat := 7 * GB / 2
def defaultPrivateBytes : Nat := 4 * GB / 5

private def run? (cmd : String) (args : Array String) : IO (Option String) := do
  try
    let out ← IO.Process.output { cmd, args, stdin := .null }
    return if out.exitCode == 0 then some out.stdout.trimAscii.toString else none
  catch _ => return none

private def powershell? (script : String) : IO (Option String) :=
  run? "powershell" #["-NoProfile", "-NonInteractive", "-Command", script]

def cpuCount : IO Nat := do
  if System.Platform.isWindows then
    if let some n := (← IO.getEnv "NUMBER_OF_PROCESSORS").bind String.toNat? then return n
  else if let some s ← run? "getconf" #["_NPROCESSORS_ONLN"] then
    if let some n := s.toNat? then return n
  return 2

/-- Value in kB of a `Key:   123 kB` line of a /proc file. -/
private def procKb? (text key : String) : Option Nat := do
  let line ← (text.splitOn "\n").find? (·.startsWith key)
  ((line.drop key.length).toString.trimAscii.toString.splitOn " ").head!.toNat?

/-- Physical memory available to new processes, in bytes (includes reclaimable caches). -/
def availableMemory : IO Nat := do
  let fallback := 8 * GB
  if System.Platform.isWindows then
    -- `AvailablePhysicalMemory` wraps GlobalMemoryStatusEx.ullAvailPhys (standby cache included).
    let script := "Add-Type -AssemblyName Microsoft.VisualBasic; " ++
      "(New-Object Microsoft.VisualBasic.Devices.ComputerInfo).AvailablePhysicalMemory"
    if let some s ← powershell? script then
      if let some b := s.toNat? then return b
  else if System.Platform.isOSX then
    -- Free plus inactive pages, from vm_stat.
    if let some s ← run? "vm_stat" #[] then
      let pageSize := ((s.splitOn "page size of ").getD 1 "").splitOn " " |>.head!.toNat? |>.getD 4096
      let pages (key : String) : Nat :=
        (((s.splitOn "\n").find? (·.startsWith key)).bind fun l =>
          ((l.drop key.length).toString.trimAscii.toString.dropEnd 1).toString.toNat?).getD 0
      let total := (pages "Pages free:" + pages "Pages inactive:") * pageSize
      if total > 0 then return total
  else
    try
      if let some kb := procKb? (← IO.FS.readFile "/proc/meminfo") "MemAvailable:" then return kb * 1024
    catch _ => pure ()
  return fallback

/-- This process's peak working set and current private memory, in bytes, if measurable. -/
def selfMemory? : IO (Option (Nat × Nat)) := do
  if System.Platform.isWindows then
    let pid ← IO.Process.getPID
    let script := s!"$p = Get-Process -Id {pid}; \"$($p.PeakWorkingSet64) $($p.PrivateMemorySize64)\""
    match (← powershell? script).map (·.splitOn " ") with
    | some [a, b] => return do some ((← a.toNat?), (← b.toNat?))
    | _ => return none
  else
    try
      let status ← IO.FS.readFile "/proc/self/status"
      match procKb? status "VmHWM:", procKb? status "RssAnon:" with
      | some peak, some anon => return some (peak * 1024, anon * 1024)
      | _, _ => return none
    catch _ => return none

/-- Learned memory figures for a project (largest values observed so far). -/
structure MemoryEstimate where
  /-- Treated as the shared part. It is a worker's whole peak working set, so it also contains
  that worker's private memory, which is then counted twice. That only makes the estimate more
  cautious; it is deliberate, not a bug. -/
  sharedBytes : Nat := defaultSharedBytes
  privateBytes : Nat := defaultPrivateBytes

/-- Workers to run at once for `groups` groups. -/
def autoJobs (groups : Nat) (est : MemoryEstimate) : IO (Nat × Nat) := do
  let available ← availableMemory
  let budget := available - reserveBytes - est.sharedBytes
  let byMemory := budget / max est.privateBytes 1
  return (max 1 (min groups (min (← cpuCount) byMemory)), available)

end Proofmap.Resources
