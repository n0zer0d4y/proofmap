import Std.Time

namespace Proofmap.Util

private def pad2 (n : Nat) : String :=
  if n < 10 then s!"0{n}" else toString n

/-- ISO 8601 UTC timestamp for seconds since the Unix epoch (civil-date algorithm by
Howard Hinnant). Avoids `Std.Time` formatting, whose API differs between toolchains. -/
def isoUtc (secs : Nat) : String :=
  let days := secs / 86400
  let rem := secs % 86400
  let z := days + 719468
  let era := z / 146097
  let doe := z - era * 146097
  let yoe := (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  let doy := doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp := (5 * doy + 2) / 153
  let d := doy - (153 * mp + 2) / 5 + 1
  let m := if mp < 10 then mp + 3 else mp - 9
  let y := yoe + era * 400 + (if m ≤ 2 then 1 else 0)
  s!"{y}-{pad2 m}-{pad2 d}T{pad2 (rem / 3600)}:{pad2 (rem % 3600 / 60)}:{pad2 (rem % 60)}Z"

def nowIsoUtc : IO String := do
  let t ← Std.Time.Timestamp.now
  return isoUtc t.toSecondsSinceUnixEpoch.val.toNat

/-- Path with forward slashes, for JSON output. -/
def slashes (p : System.FilePath) : String :=
  p.toString.map fun c => if c == '\\' then '/' else c

/-- The path from folder `fromDir` to folder `toDir` (both absolute), with forward slashes:
`""` for the same folder, `"../.."` for two levels up. `none` when there is no relative path
(different drives). Pages record where the project is relative to themselves this way, never
the absolute path. -/
def relativeDir (fromDir toDir : System.FilePath) : Option String :=
  let parts (p : System.FilePath) := ((slashes p).splitOn "/").filter fun s => s != "" && s != "."
  let a := parts fromDir
  let b := parts toDir
  let same (x y : String) := if System.Platform.isWindows then x.toLower == y.toLower else x == y
  let common := ((a.zip b).takeWhile fun (x, y) => same x y).length
  if common == 0 && !(a.isEmpty && b.isEmpty) && (slashes fromDir).take 1 != "/" then none
  else some ("/".intercalate (List.replicate (a.length - common) ".." ++ b.drop common))

/-- `rel` (from `relativeDir`) when it only climbs (`""`, `".."`, `"../.."`), that is when the page is
in the project folder or below it. A path that climbs out and then names folders (`../../me/proj`)
would reveal the folders around the project, so it is not recorded. -/
def upOnly (rel : String) : Option String :=
  if (rel.splitOn "/").all fun s => s == ".." || s == "" then some rel else none

/-- `file` relative to `root` with forward slashes, if it is inside it (compared without case
where the file system ignores case). -/
def relativeTo? (root file : System.FilePath) : Option String :=
  let norm (s : String) := if System.Platform.isWindows || System.Platform.isOSX then s.toLower else s
  -- List operations: the String API differs between the supported toolchains.
  let r := String.ofList ((slashes root).toList.reverse.dropWhile (· == '/')).reverse
  let f := slashes file
  if norm f == norm r then some ""
  else if (norm f).startsWith (norm r ++ "/") then some (String.ofList (f.toList.drop (r.length + 1)))
  else none

/-- Folders, relative to the project root, that hold module sources: the project itself (`""`),
then the source folders of packages inside it (from `LEAN_SRC_PATH`, set by `lake env`), so
modules of a dependency such as Mathlib can be mapped too. -/
def sourceDirs (rootDir : System.FilePath) : IO (Array String) := do
  let mut out := #[""]
  if let some sp ← IO.getEnv "LEAN_SRC_PATH" then
    for e in System.SearchPath.parse sp do
      if let some rel := relativeTo? rootDir e then
        unless rel == "" || out.contains rel do out := out.push rel
  return out

end Proofmap.Util
