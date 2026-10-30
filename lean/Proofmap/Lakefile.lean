import Lake.Toml

/-!
# Default root modules from the project's lakefile

Without `--root` or `rootModules` in `proofmap.toml`, proofmap maps the project's own libraries:
every `lean_lib` in the lakefile, each with its `roots` (default: the library's name). Each root
then brings in all its built submodules, as `--root` does. A `lakefile.lean` is a Lean program,
so it is read as text rather than run: `lean_lib` declarations and literal `roots := #[...]` or
`globs := #[...]` lists are recognised, which covers the usual forms. Anything unusual can be
set explicitly in `proofmap.toml`.
-/

namespace Proofmap.Lakefile

open Lean Lake Toml

/-- `«Foo».Bar` → `Foo.Bar`. -/
def cleanName (s : String) : String :=
  (s.trimAscii.toString.replace "«" "").replace "»" ""

/-- Library roots from a `lakefile.toml`. -/
def fromToml (src : String) : IO (Array String) := do
  let ictx := Parser.mkInputContext src "lakefile.toml"
  let .ok table ← (loadToml ictx).toBaseIO | return #[]
  let mut out := #[]
  for (k, v) in table.items do
    unless k.toString == "lean_lib" do continue
    let .array _ libs := v | continue
    for lib in libs do
      let .table _ t := lib | continue
      let get (key : String) := t.items.find? (fun (k', _) => k'.toString == key) |>.map (·.2)
      let strs : Option Value → Array String
        | some (.array _ xs) => xs.filterMap fun | .string _ s => some s | _ => none
        | _ => #[]
      let name := match get "name" with | some (.string _ s) => some s | _ => none
      -- `globs = ["A.*"]` or `["A.+"]` or `["A"]` all start at module `A`.
      let globs := (strs (get "globs")).map fun g => (g.replace ".*" "").replace ".+" ""
      let roots := strs (get "roots") ++ globs
      out := out ++ (if roots.isEmpty then name.toArray else roots)
  return out.map cleanName

/-- The names inside a literal `#[...]` after `key :=` in `block`: backticked names, or
`.andSubmodules `X` / `.submodules `X` / `.one `X` globs. -/
private def listAfter (block key : String) : Array String := Id.run do
  let some rest := (block.splitOn (key ++ " :=")).tail.head? | return #[]
  let list := ((rest.splitOn "]").headD "")
  let mut out := #[]
  -- Every piece after a backtick starts with a name.
  for piece in (list.splitOn "`").tail do
    let n := piece.takeWhile fun c => c.isAlphanum || c == '.' || c == '_' || c == '«' || c == '»' || c == '\''
    if !n.isEmpty then out := out.push (cleanName n.toString)
  return out

/-- Library roots from a `lakefile.lean`, read as text. -/
def fromLean (src : String) : Array String := Id.run do
  -- Drop line comments, so commented-out libraries do not count.
  let lines := (src.splitOn "\n").map fun l => (l.splitOn "--").headD ""
  let text := "\n".intercalate lines
  let mut out := #[]
  for chunk in (text.splitOn "lean_lib ").tail do
    let name := chunk.takeWhile fun c => !(c.isWhitespace || c == '(' || c == ':')
    if name.isEmpty then continue
    -- The library's block runs to the next top-level declaration.
    let block := ((chunk.splitOn "\n@[").headD chunk).splitOn "\nlean_exe" |>.headD chunk
    let roots := listAfter block "roots" ++ listAfter block "globs"
    out := out ++ (if roots.isEmpty then #[cleanName name.toString] else roots)
  return out

/-- Default root modules for the project in `rootDir`, deduplicated, in lakefile order. -/
def defaultRoots (rootDir : System.FilePath) : IO (Array String) := do
  let toml := rootDir / "lakefile.toml"
  let lean := rootDir / "lakefile.lean"
  let found ← if ← lean.pathExists then pure (fromLean (← IO.FS.readFile lean))
    else if ← toml.pathExists then fromToml (← IO.FS.readFile toml)
    else pure #[]
  return found.foldl (fun acc n => if acc.contains n then acc else acc.push n) #[]

end Proofmap.Lakefile
