import Proofmap.Package.Wire

/-!
# Site output and split walkthroughs

`build --site DIR` writes `index.html` (the template with its placeholder left in, so the viewer
fetches its data), `data/page.json` (the page payload, `Package/Wire.lean`), and the walkthrough
steps split into one script per module under `data/walkthrough/`. The viewer loads a script when
one of its walkthroughs is opened. Scripts rather than JSON, because browsers refuse `fetch`
between files opened from disk but do run sibling scripts, so the same chunks also serve a big
single file.

Every file is written to a temporary name and renamed into place, so `serve`'s live reload never
sees a half-written page.
-/

namespace Proofmap.Package

open Lean Proofmap.Schema Proofmap.Workers

/-- Write `contents` to a temporary file beside `path`, then rename it over `path`. -/
def writeAtomic (path : System.FilePath) (contents : String) : IO Unit := do
  let tmp : System.FilePath := path.toString ++ s!".tmp-{← IO.Process.getPID}"
  IO.FS.writeFile tmp contents
  try IO.FS.rename tmp path
  catch e =>
    try IO.FS.removeFile tmp catch _ => pure ()
    throw e

/-- Write the chunks under `root`, removing chunk scripts left over from earlier builds. -/
def writeChunks (root : System.FilePath) (dir : String) (chunks : Array (String × String)) : IO Unit := do
  let wdir := root / dir
  IO.FS.createDirAll wdir
  for e in ← wdir.readDir do
    if e.fileName.endsWith ".js" && !chunks.any (·.1 == s!"{dir}/{e.fileName}") then
      IO.FS.removeFile e.path
  for (f, c) in chunks do writeAtomic (root / f) c

/-- `build --site DIR`. The page is written last: it is what `serve`'s live reload watches. -/
def writeSite (root : System.FilePath) (data : ProofmapData) : IO Unit := do
  let (wire, chunks) := Wire.encode data (splitDir := some "data/walkthrough")
  writeChunks root "data/walkthrough" chunks
  writeAtomic (root / "data" / "page.json") wire.compress
  writeAtomic (root / "index.html") template

/-- The size above which a single file moves walkthroughs and helper details into a folder next
to it. Not a hard cap: bigger pages still work, with a hint. -/
def singleFileBudget : Nat := 15 * 1000 * 1000

/-- `build --out FILE`: the page with its data inlined. Over budget, the parts a reader opens
on demand move to `<name>_files/` beside it, in this order until the page fits: walkthroughs
(`walkthrough/`), then the details of generated helpers (`helpers-<hash>.js`). Returns a note
for the user, if any. -/
def writeSingleFile (out : System.FilePath) (data : ProofmapData) : IO (Except String (Option String)) := do
  -- Tests lower the budget to exercise the split forms on a small project.
  let singleFileBudget := ((← IO.getEnv "PROOFMAP_PAGE_BUDGET").bind String.toNat?).getD singleFileBudget
  let root := out.parent.getD "."
  let stem := out.fileStem.getD "proofmap"
  let files := s!"{stem}_files"
  let dir := s!"{files}/walkthrough"
  let mb (n : Nat) := s!"{n / 1000000}.{n / 100000 % 10}"
  let render (wire : Json) : Except String String := inject wire.compress
  let attempts : Array (Option String × Option String) :=
    #[(none, none), (some dir, none), (some dir, some s!"{files}/helpers-{hex (hash data.project.builtAt)}.js")]
  let mut chosen : Option (String × Array (String × String) × Nat) := none
  for (split, helpers) in attempts do
    if split.isSome && data.walkthroughs.isEmpty && helpers.isNone then continue
    let (wire, chunks) := Wire.encode data (splitDir := split) (helperFile := helpers)
    let html ← match render wire with
      | .ok h => pure h
      | .error e => return .error e
    chosen := some (html, chunks, if helpers.isSome then 2 else if split.isSome then 1 else 0)
    if html.utf8ByteSize ≤ singleFileBudget then break
  let some (html, chunks, level) := chosen | return .error "nothing to write"
  -- Files from an earlier, bigger build would be stale now.
  if ← (root / files).pathExists then IO.FS.removeDirAll (root / files)
  for (f, c) in chunks do
    if let some parent := (root / f).parent then IO.FS.createDirAll parent
    writeAtomic (root / f) c
  writeAtomic out html
  let moved := match level with
    | 0 => none
    | 1 => some s!"walkthroughs are in {root / files} (keep that folder next to the page)"
    | _ => some s!"walkthroughs and helper details are in {root / files} (keep that folder next to the page)"
  let big := if html.utf8ByteSize > singleFileBudget then
      some s!"{out.fileName.getD "the page"} is {mb html.utf8ByteSize} MB; for large projects `proofmap serve` or `--site` loads faster"
    else none
  return .ok (match moved, big with
    | some m, some b => some (m ++ "; " ++ b)
    | some m, none => some m
    | none, b => b)

end Proofmap.Package
