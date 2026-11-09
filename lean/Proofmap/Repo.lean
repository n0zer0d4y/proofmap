/-!
# The project's git repository and default title

What proofmap reads from the project's surroundings, never anything outside the project's own
repository: the commit and the project's folder inside the repository (for source links), the
`origin` remote as a web address (when no `repoUrl` is configured), whether the commit is pushed
and the Lean files committed (links to an unpushed commit lead nowhere), and a default page title.
-/

namespace Proofmap.Repo

/-- `git -C dir args`, trimmed output, or `none` when git is missing or fails. -/
def git (dir : System.FilePath) (args : Array String) : IO (Option String) := do
  try
    let out ← IO.Process.output { cmd := "git", args := #["-C", dir.toString] ++ args, stdin := .null }
    return if out.exitCode == 0 then some out.stdout.trimAscii.toString else none
  catch _ => return none

private def dropSuffix (s suffix : String) : String :=
  if s.endsWith suffix then (s.dropEnd suffix.length).toString else s

/-- A git remote as a web address: `https://github.com/me/repo` for
`https://github.com/me/repo.git`, `git@github.com:me/repo.git` or
`ssh://git@github.com/me/repo`. Credentials in an https remote are dropped. `none` for anything
else (a local path, an unknown scheme). -/
def webUrl (remote : String) : Option String := do
  let r := dropSuffix (dropSuffix (dropSuffix remote.trimAscii.toString "/") ".git") "/"
  let hostPath ← if r.startsWith "https://" || r.startsWith "http://" then
      let rest := (r.splitOn "://").tail.headD ""
      -- `user:token@host/path`: keep only `host/path`.
      let host := (rest.splitOn "/").headD ""
      let path := "/".intercalate (rest.splitOn "/").tail
      some ((host.splitOn "@").getLast?.getD host, path)
    else if r.startsWith "ssh://" then
      let rest := (r.drop 6).toString
      let host := ((rest.splitOn "/").headD "")
      let host := ((host.splitOn "@").getLast?.getD host).splitOn ":" |>.headD host
      some (host, "/".intercalate (rest.splitOn "/").tail)
    else
      -- scp-like `user@host:path`; a Windows path (`C:\...`) or a plain path is not a remote.
      match r.splitOn ":" with
      | [hostPart, path] =>
        if hostPart.contains '@' && !hostPart.contains '/' && !path.startsWith "\\" then
          some ((hostPart.splitOn "@").getLast?.getD hostPart, path)
        else none
      | _ => none
  let (host, path) := hostPath
  if host.isEmpty || path.isEmpty || !host.contains '.' then none
  else some s!"https://{host}/{path}"

/-- What the repository says about the project in `dir`. -/
structure Info where
  /-- The commit that was mapped. -/
  ref : Option String := none
  /-- The project's folder inside the repository, with a trailing `/` (`lean/`); empty at the top. -/
  pathPrefix : String := ""
  /-- The `origin` remote as a web address. -/
  remote : Option String := none
  /-- Lean files with changes that are not committed. -/
  uncommitted : Bool := false
  /-- The commit is on no remote branch, so links to it lead nowhere. -/
  unpushed : Bool := false

/-- Reads `Info` for the project in `dir`; all defaults when it is not a git checkout. -/
def info (dir : System.FilePath) : IO Info := do
  let some ref ← git dir #["rev-parse", "HEAD"] | return {}
  let pathPrefix := (← git dir #["rev-parse", "--show-prefix"]).getD ""
  let remote := (← git dir #["remote", "get-url", "origin"]).bind webUrl
  -- Only tracked Lean files count: a rebuilt proofmap.html or other output is not a reason to warn.
  let status := (← git dir #["status", "--porcelain", "--untracked-files=no", "--", "*.lean"]).getD ""
  let remotes := (← git dir #["remote"]).getD ""
  let containing := (← git dir #["branch", "-r", "--contains", "HEAD"]).getD ""
  return { ref, pathPrefix, remote, uncommitted := !status.isEmpty,
           unpushed := !remotes.isEmpty && containing.isEmpty }

/-- `title:` at the top level of a CITATION.cff, without quotes. -/
def citationTitle (src : String) : Option String :=
  (src.splitOn "\n").findSome? fun line =>
    if line.startsWith "title:" then
      let v := ((line.drop 6).trimAscii.toString)
      let v := if (v.startsWith "\"" && v.endsWith "\"") || (v.startsWith "'" && v.endsWith "'")
        then ((v.drop 1).dropEnd 1).toString else v
      if v.isEmpty then none else some v
    else none

/-- Text without HTML tags (`<a href=...>`, `<img ...>`), with runs of spaces made one. -/
private def stripTags (s : String) : String := Id.run do
  let mut out := ""
  let mut inTag := false
  for c in s.toList do
    if c == '<' then inTag := true
    else if c == '>' then inTag := false
    else if !inTag then out := out.push c
  return " ".intercalate ((out.splitOn " ").filter (· != ""))

/-- The README's title: its first level-one heading, as Markdown (`# Title`) or HTML
(`<h1 align="center">Title</h1>`), without Markdown emphasis, code marks or tags. Lines inside
fenced code blocks are skipped, so a shell comment (`# Fetch the cache`) is not taken for one. -/
def readmeTitle (src : String) : Option String := Id.run do
  let mut fence : Option String := none
  for line in src.splitOn "\n" do
    let l := line.trimAscii.toString
    -- A fence opens and closes with the same marker.
    let marker := if l.startsWith "```" then some "```" else if l.startsWith "~~~" then some "~~~" else none
    match fence, marker with
    | none, some m => fence := some m; continue
    | some f, some m => if f == m then fence := none
                        continue
    | some _, none => continue
    | none, none => pure ()
    let heading :=
      if l.startsWith "# " then some (l.drop 2).toString
      else if l.toLower.startsWith "<h1" && (l.toLower.splitOn "</h1>").length > 1 then
        some (stripTags ((l.splitOn ">").drop 1 |> ">".intercalate |>.splitOn "</h1>" |>.headD ""))
      else none
    if let some h := heading then
      let t := (stripTags h).replace "**" "" |>.replace "`" ""
      let t := (t.trimAscii.toString.dropEndWhile (· == '#')).trimAscii.toString
      if !t.isEmpty then return some t
  return none

/-- The package name in a `lakefile.toml` (`name = "..."` before the first table) or a
`lakefile.lean` (`package «name»`). -/
def packageName (lakefile : String) (isToml : Bool) : Option String :=
  let lines := lakefile.splitOn "\n"
  if isToml then
    let top := lines.takeWhile fun l => !l.trimAscii.toString.startsWith "["
    top.findSome? fun l =>
      let l := l.trimAscii.toString
      if l.startsWith "name" && (l.drop 4).trimAscii.toString.startsWith "=" then
        let v := ((l.splitOn "=").tail.headD "").trimAscii.toString
        let v := (v.replace "\"" "").replace "'" ""
        if v.isEmpty then none else some v
      else none
  else
    lines.findSome? fun l =>
      if l.startsWith "package " then
        let n := ((l.drop 8).toString.takeWhile fun c => !(c.isWhitespace || c == '(' || c == ':')).toString
        let n := ((n.replace "«" "").replace "»" "").replace "\"" ""
        if n.isEmpty then none else some n
      else none

/-- `my-repo: Four results on X` → `Four results on X`. Titles often lead with the repository's
slug (one word, no spaces) before a colon; the description after it reads better, and is what a
narrow header keeps. Titles without such a slug are unchanged. -/
def dropSlug (t : String) : String :=
  match t.splitOn ": " with
  | slug :: rest@(_ :: _) =>
    let desc := (": ".intercalate rest).trimAscii.toString
    if slug.isEmpty || slug.contains ' ' || desc.isEmpty then t
    else (desc.take 1).toString.toUpper ++ (desc.drop 1).toString
  | _ => t

/-- A default page title and where it came from: the project's CITATION.cff, its README's first
heading, or the lakefile's package name, looked for in the project folder and then at the top of
its repository. -/
def defaultTitle (dir : System.FilePath) : IO (Option (String × String)) := do
  let top := (← git dir #["rev-parse", "--show-toplevel"]).map System.FilePath.mk
  let dirs := #[dir] ++ (top.filter (·.toString != dir.toString)).toArray
  let read (f : System.FilePath) : IO (Option String) := do
    if ← f.pathExists then return some (← IO.FS.readFile f) else return none
  for d in dirs do
    if let some src ← read (d / "CITATION.cff") then
      if let some t := citationTitle src then return some (dropSlug t, "CITATION.cff")
  for d in dirs do
    if let some src ← read (d / "README.md") then
      if let some t := readmeTitle src then return some (dropSlug t, "README.md")
  if let some src ← read (dir / "lakefile.toml") then
    if let some t := packageName src true then return some (t, "lakefile.toml")
  if let some src ← read (dir / "lakefile.lean") then
    if let some t := packageName src false then return some (t, "lakefile.lean")
  return none

end Proofmap.Repo
