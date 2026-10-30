import Proofmap.Version
import Proofmap.Build
import Proofmap.Walkthrough.Elab
import Proofmap.Config
import Proofmap.Package.Template
import Proofmap.Package.Site
import Proofmap.Serve
import Proofmap.Check
import Proofmap.Compare
import Proofmap.Launcher
import Proofmap.Lakefile

namespace Proofmap.Cli

open Lean

def usage : String :=
  s!"proofmap {version}

usage: proofmap <command> [options]

commands:
  build     extract the project and write proofmap.html
  serve     serve the viewer on localhost with live reload
  open      open a generated proofmap.html in the browser
  compare   compare two proofmap.json snapshots
  check     validate config and report flagged declarations

build options:
  --root MODULE      a root module: it and all its built submodules (repeatable;
                     default: rootModules in proofmap.toml, else the lakefile's
                     lean_lib roots)
  --config FILE      config file (default: proofmap.toml in the project, if present)
  --out FILE         write the viewer with the data inlined (default: proofmap.html;
                     not written with --site unless given)
  --site DIR         write a static site: index.html, data/page.json and the
                     walkthroughs in data/walkthrough/ (works under any sub-path)
  --json FILE        also write the extracted data as JSON
  --pretty           indent the JSON output
  --title TEXT       project title
  --no-lake-build    skip running `lake build` first
  --jobs N           extract up to N import groups in parallel
                     (default: chosen from CPUs and available memory)
  --no-cache         re-extract every import group and walkthrough
  --walkthrough      also record proof walkthroughs (tactic steps and goals); this
                     elaborates every proof again, about as long as `lake build`
  --no-walkthrough   leave walkthroughs out (the default)
  --timings          print the time spent in each phase

serve options (build options are passed on to the build that runs first):
  --port N           port on 127.0.0.1 (default: 0, a free port)
  --open             open the page in the default browser
  --no-build         serve the existing output without building first
                     (with --site DIR, serves that site)

check options (and --root, --config, --no-lake-build, --jobs, --no-cache from build):
  --strict           exit with code 3 if anything depends on sorry, uses a
                     non-standard axiom, or a config entry names no declaration

compare OLD.json NEW.json [--out FILE]
                     list what was added, removed or changed between two snapshots
                     (from `build --json`) and write a page with the comparison
                     (default: proofmap-compare.html)

open [FILE]          open a generated page in the default browser (default: proofmap.html)

exit codes: 0 OK, 1 usage or config error, 2 build failure, 3 `check --strict` failed
"

structure BuildArgs where
  roots : Array Name := #[]
  out : System.FilePath := "proofmap.html"
  outGiven : Bool := false
  site : Option System.FilePath := none
  pageJson : Option System.FilePath := none
  json : Option System.FilePath := none
  pretty : Bool := false
  title : Option String := none
  lakeBuild : Bool := true
  timings : Bool := false
  jobs : Option Nat := none
  useCache : Bool := true
  config : Option System.FilePath := none
  /-- `--walkthrough` / `--no-walkthrough`; otherwise `[walkthrough] enabled` (off by default). -/
  walkthrough : Option Bool := none

partial def parseBuildArgs (args : List String) (acc : BuildArgs := {}) : Except String BuildArgs :=
  match args with
  | [] => .ok acc
  | "--root" :: m :: rest => parseBuildArgs rest { acc with roots := acc.roots.push m.toName }
  | "--out" :: f :: rest => parseBuildArgs rest { acc with out := f, outGiven := true }
  | "--site" :: d :: rest => parseBuildArgs rest { acc with site := some d }
  -- Undocumented, for tests: the page payload (`Package/Wire.lean`), unsplit.
  | "--page-json" :: f :: rest => parseBuildArgs rest { acc with pageJson := some f }
  | "--json" :: f :: rest => parseBuildArgs rest { acc with json := some f }
  | "--pretty" :: rest => parseBuildArgs rest { acc with pretty := true }
  | "--title" :: t :: rest => parseBuildArgs rest { acc with title := some t }
  | "--no-lake-build" :: rest => parseBuildArgs rest { acc with lakeBuild := false }
  | "--timings" :: rest => parseBuildArgs rest { acc with timings := true }
  | "--no-cache" :: rest => parseBuildArgs rest { acc with useCache := false }
  | "--config" :: f :: rest => parseBuildArgs rest { acc with config := some f }
  | "--walkthrough" :: rest => parseBuildArgs rest { acc with walkthrough := some true }
  | "--no-walkthrough" :: rest => parseBuildArgs rest { acc with walkthrough := some false }
  | "--jobs" :: n :: rest => match n.toNat? with
    | some k => if k > 0 then parseBuildArgs rest { acc with jobs := some k } else .error "--jobs needs a positive number"
    | none => .error s!"--jobs needs a number, got '{n}'"
  | a :: _ => .error s!"unknown or incomplete build option '{a}'"

/-- Config, root modules and the `lake build` step shared by `build` and `check`. Errors are
reported here; the result is then the exit code (1 usage or config error, 2 build failure). -/
def prepareBuild (a : BuildArgs) : IO (Except UInt32 (BuildOptions × Config.Config)) := do
  let rootDir ← IO.currentDir
  -- Config: an explicit --config, or proofmap.toml in the project when present.
  let configFile? ← match a.config with
    | some f => pure (some f)
    | none => do
      let f := rootDir / "proofmap.toml"
      pure (if ← f.pathExists then some f else none)
  let cfg ← match configFile? with
    | none => pure (some ({} : Config.Config))
    | some f =>
      if !(← f.pathExists) then
        IO.eprintln s!"proofmap: config file {f} not found"
        pure none
      else match ← Config.load f with
        | .ok c => pure (some c)
        | .error es =>
          for e in es do IO.eprintln s!"proofmap: {e}"
          pure none
  let some cfg := cfg | return .error 1
  let mut roots := if a.roots.isEmpty then cfg.rootModules.map String.toName else a.roots
  if roots.isEmpty then
    roots := (← Lakefile.defaultRoots rootDir).map String.toName
    unless roots.isEmpty do
      IO.println s!"proofmap: root modules from the lakefile: {", ".intercalate (roots.map toString).toList} (set rootModules in proofmap.toml, or pass --root, to change)"
  if roots.isEmpty then
    IO.eprintln "proofmap: no root modules: the lakefile declares no lean_lib proofmap could read; give --root MODULE or set rootModules in proofmap.toml"
    return .error 1
  if a.lakeBuild then
    let child ← IO.Process.spawn { cmd := "lake", args := #["build"] ++ roots.map toString }
    if (← child.wait) != 0 then
      IO.eprintln "proofmap: `lake build` failed"
      return .error 2
  let configGlossary := cfg.glossary
  return .ok ({
    rootDir, rootModules := roots, title := a.title <|> cfg.title, timings := a.timings
    jobs := a.jobs, useCache := a.useCache, repoUrl := cfg.repoUrl
    standardAxioms := cfg.standardAxioms.getD Extract.defaultStandardAxioms
    -- Config entries come first, so they win over the built-in glossary.
    glossary := configGlossary ++ Extract.defaultGlossary.filter fun (k, _) => !configGlossary.any (·.1 == k)
    dividerPatterns := cfg.dividerPatterns.getD Source.defaultDividerPatterns
    banners := cfg.banners, preset := cfg.preset, footer := cfg.footer
    walkthrough := a.walkthrough.getD cfg.walkthrough
    overrides := {
      summaries := cfg.summaries.foldl (fun m (k, v) => m.insert k v) {}
      steps := cfg.steps.foldl (fun m (k, v) => m.insert k v) {}
      ranks := cfg.ranks.foldl (fun m (k, v) => m.insert k v) {}
      roots := cfg.roots } }, cfg)

/-- Exit codes: 0 OK, 1 usage error, 2 build failure. -/
def runBuild (args : List String) : IO UInt32 := do
  match parseBuildArgs args with
  | .error e =>
    IO.eprintln s!"proofmap: {e}\n\n{usage}"
    return 1
  | .ok a =>
    let opts ← match ← prepareBuild a with
      | .ok (opts, _) => pure opts
      | .error code => return code
    try
      let data ← extract opts
      let t ← IO.monoMsNow
      let json := toJson data
      if let some f := a.json then
        Package.writeAtomic f (if a.pretty then json.pretty else json.compress)
        IO.println s!"proofmap: wrote {f}"
      let counts := s!"{data.decls.size} declarations, {data.modules.size} modules"
      if let some dir := a.site then
        Package.writeSite dir data
        IO.println s!"proofmap: wrote site {dir} ({counts})"
      if let some f := a.pageJson then
        Package.writeAtomic f (Package.Wire.encode data).1.compress
      if a.site.isNone || a.outGiven then
        match ← Package.writeSingleFile a.out data with
        | .error e =>
          IO.eprintln s!"proofmap: {e}"
          return (2 : UInt32)
        | .ok note =>
          IO.println s!"proofmap: wrote {a.out} ({counts})"
          if let some n := note then IO.println s!"proofmap: {n}"
      if a.timings then IO.eprintln s!"proofmap: write output: {(← IO.monoMsNow) - t} ms"
      return (0 : UInt32)
    catch e =>
      IO.eprintln s!"proofmap: extraction failed: {e}"
      return 2

/-- `check`: validate the config, extract (without walkthroughs) and report flagged
declarations. Exit 3 with `--strict` when anything is flagged. -/
def runCheck (args : List String) : IO UInt32 := do
  let strict := args.contains "--strict"
  match parseBuildArgs (args.filter (· != "--strict")) with
  | .error e =>
    IO.eprintln s!"proofmap: {e}\n\n{usage}"
    return 1
  | .ok a =>
    let (opts, cfg) ← match ← prepareBuild { a with walkthrough := some false } with
      | .ok r => pure r
      | .error code => return code
    let configFile? ← match a.config with
      | some f => pure (some f)
      | none => do
        let f := opts.rootDir / "proofmap.toml"
        pure (if ← f.pathExists then some f else none)
    try
      let data ← extract opts
      let r := Check.report data cfg
      IO.println (r.render data configFile?)
      return if strict && r.problems > 0 then 3 else 0
    catch e =>
      IO.eprintln s!"proofmap: extraction failed: {e}"
      return 2

/-- `compare OLD.json NEW.json [--out FILE]`. -/
def runCompare (args : List String) : IO UInt32 := do
  let (files, out) := match args with
    | [a, b] => (some (a, b), "proofmap-compare.html")
    | [a, b, "--out", o] | ["--out", o, a, b] => (some (a, b), o)
    | _ => (none, "")
  let some (oldFile, newFile) := files | do
    IO.eprintln s!"proofmap: compare needs two snapshots: compare OLD.json NEW.json [--out FILE]"
    return 1
  let read (f : String) : IO (Option (String × Json)) := do
    unless ← System.FilePath.pathExists f do
      IO.eprintln s!"proofmap: {f} not found"
      return none
    let text ← IO.FS.readFile f
    match Json.parse text with
    | .error e =>
      IO.eprintln s!"proofmap: {f} is not JSON: {e}"
      return none
    | .ok j =>
      if (j.getObjValAs? Nat "schema").toOption != some 1 then
        IO.eprintln s!"proofmap: {f} is not a proofmap.json (schema 1); write one with `proofmap build --json FILE`"
        return none
      return some (text, j)
  let some (oldText, oldJson) ← read oldFile | return 1
  let some (newText, newJson) ← read newFile | return 1
  IO.println (Compare.diff (.of oldJson) (.of newJson)).render
  match Compare.page oldText.trimAscii.toString newText.trimAscii.toString with
  | .error e =>
    IO.eprintln s!"proofmap: {e}"
    return 2
  | .ok html =>
    Package.writeAtomic out html
    IO.println s!"proofmap: wrote {out}"
    return 0

/-- Open a file or URL with its default handler (`rundll32` / `open` / `xdg-open`). -/
def launch (target : String) : IO UInt32 := do
  let (cmd, args) :=
    -- rundll32 opens the target with its default handler; `cmd /c start` breaks on argument quoting.
    if System.Platform.isWindows then ("rundll32", #["url.dll,FileProtocolHandler", target])
    else if System.Platform.isOSX then ("open", #[target])
    else ("xdg-open", #[target])
  let out ← IO.Process.output { cmd, args, stdin := .null }
  if out.exitCode != 0 then
    IO.eprintln s!"proofmap: could not open a browser: {out.stderr.trimAscii}
open {target} by hand"
    return 1
  IO.println s!"proofmap: opened {target}"
  return 0

/-- Open a generated page in the default browser. -/
def openInBrowser (file : System.FilePath) : IO UInt32 := do
  unless ← file.pathExists do
    IO.eprintln s!"proofmap: {file} not found (run `proofmap build` first)"
    return 1
  launch (← IO.FS.realPath file).toString

structure ServeArgs where
  port : UInt16 := 0
  openBrowser : Bool := false
  build : Bool := true
  buildArgs : Array String := #[]

partial def parseServeArgs (args : List String) (acc : ServeArgs := {}) : Except String ServeArgs :=
  match args with
  | [] => .ok acc
  | "--port" :: n :: rest => match n.toNat? with
    | some p => if p < 65536 then parseServeArgs rest { acc with port := p.toUInt16 } else .error s!"--port {n} is out of range"
    | none => .error s!"--port needs a number, got '{n}'"
  | "--open" :: rest => parseServeArgs rest { acc with openBrowser := true }
  | "--no-build" :: rest => parseServeArgs rest { acc with build := false }
  | a :: rest => parseServeArgs rest { acc with buildArgs := acc.buildArgs.push a }

/-- `serve`: build (unless `--no-build`), then serve the output on 127.0.0.1 until stopped. -/
def runServe (args : List String) : IO UInt32 := do
  let parsed := do
    let s ← parseServeArgs args
    return (s, ← parseBuildArgs s.buildArgs.toList)
  let (s, b) ← match parsed with
    | .ok r => pure r
    | .error e =>
      IO.eprintln s!"proofmap: {e}\n\n{usage}"
      return 1
  if s.build then
    let code ← runBuild s.buildArgs.toList
    if code != 0 then return code
  let site : Serve.Site := match b.site with
    | some dir => { root := dir, index := "index.html" }
    | none => { root := b.out.parent.getD ".", index := b.out.fileName.getD "proofmap.html" }
  unless ← (site.root / site.index).pathExists do
    IO.eprintln s!"proofmap: {site.root / site.index} not found (run `proofmap build` first)"
    return 1
  let l ← try Compat.listenLocal s.port catch e =>
    IO.eprintln s!"proofmap: cannot listen on 127.0.0.1:{s.port}: {e}"
    return (1 : UInt32)
  let url := s!"http://127.0.0.1:{l.port}/"
  IO.println s!"proofmap: serving {site.root / site.index} at {url} (Ctrl+C to stop)"
  IO.println "proofmap: run `proofmap build` again and the open page reloads"
  (← IO.getStdout).flush
  if s.openBrowser then discard <| launch url
  Serve.run l site
  return 0

/-- The commands themselves, run in this process (project install, or an engine). -/
def runLocal (args : List String) : IO UInt32 := do
  match args with
  | ["--version"] =>
    IO.println s!"proofmap {version} (Lean {Lean.versionString}, serve: {Compat.serveBackend})"
    return 0
  | [] | ["--help"] | ["-h"] =>
    IO.println usage
    return 0
  | "build" :: rest => runBuild rest
  | "serve" :: rest => runServe rest
  | "check" :: rest => runCheck rest
  | "compare" :: rest => runCompare rest
  | ["open"] => openInBrowser "proofmap.html"
  | ["open", f] => openInBrowser f
  | ["__extract-group", req, out] => runGroupWorker req out
  | ["__walkthrough", req, out] => Walkthrough.runWalkthroughWorker req out
  | cmd :: _ =>
    IO.eprintln s!"proofmap: unknown command '{cmd}'\n\n{usage}"
    return 1

def globalUsage : String :=
  "global install:
  build, check and serve run in the Lean project in the current folder (or the
  nearest folder above it with a lakefile and lean-toolchain), using an engine
  built once per Lean toolchain. Relative paths in their options are relative
  to the project folder.

  --project DIR      use the Lean project in DIR
  doctor             show the detected project, its toolchain, cached engines,
                     PATH and helper programs
  engines [--prune]  list cached engines; --prune removes those of other
                     proofmap versions
  self-update        update to the latest proofmap release
  uninstall [--yes]  remove the global install and its caches
"

/-- `--project DIR`, wherever it appears. -/
def takeProject : List String → Option String × List String
  | "--project" :: d :: rest => let (_, r) := takeProject rest; (some d, r)
  | a :: rest => let (p, r) := takeProject rest; (p, a :: r)
  | [] => (none, [])

/-- The project for a global command, with its toolchain checked. -/
def locateProject (projectArg : Option String) : IO (Option (System.FilePath × String)) := do
  let start ← match projectArg with
    | some d =>
      unless ← System.FilePath.isDir d do
        IO.eprintln s!"proofmap: --project {d}: no such folder"
        return none
      IO.FS.realPath d
    | none => IO.currentDir
  let some project ← Launcher.findProject start | do
    IO.eprintln s!"proofmap: no Lean project at {start} or above (looked for a lakefile and lean-toolchain).
Run proofmap inside a Lean project, or pass --project DIR."
    return none
  return some (project, ← Launcher.readToolchain project)

def delegateToEngine (projectArg : Option String) (args : List String) : IO UInt32 := do
  let some (project, tc) ← locateProject projectArg | return 1
  match Launcher.support tc with
  | .error e =>
    IO.eprintln s!"proofmap: {e}"
    return 1
  | .ok w => if let some w := w then IO.eprintln s!"proofmap: warning: {w}"
  match ← Launcher.ensureEngine (← Launcher.home) tc with
  | .error e =>
    IO.eprintln s!"proofmap: {e}"
    return 2
  | .ok exe => Launcher.delegate project exe args.toArray

def runDoctor (projectArg : Option String) : IO UInt32 := do
  let h ← Launcher.home
  let mut problems := 0
  IO.println s!"proofmap {version}, global install at {h}"
  IO.println s!"  launcher: Lean {Lean.versionString}"
  let src := Launcher.sourceDir h
  if ← (src / "lakefile.lean").pathExists then IO.println s!"  source for engines: {src}"
  else
    IO.println s!"  source for engines: MISSING ({src}); reinstall proofmap"
    problems := problems + 1
  match ← Launcher.findProject (← match projectArg with | some d => IO.FS.realPath d | none => IO.currentDir) with
  | none => IO.println "  project: none here (run doctor inside a Lean project, or pass --project DIR)"
  | some p =>
    let tc ← Launcher.readToolchain p
    IO.println s!"  project: {p}"
    IO.println s!"  toolchain: {tc}"
    let supported ← match Launcher.support tc with
      | .error e =>
        IO.println s!"  support: NOT SUPPORTED: {e}"
        problems := problems + 1
        pure false
      | .ok (some w) => IO.println s!"  support: warning: {w}"; pure true
      | .ok none => IO.println "  support: supported"; pure true
    let dir := Launcher.engineDir h tc
    if ← (dir / "engine.ok").pathExists then IO.println s!"  engine: ready ({dir})"
    else if supported then
      IO.println "  engine: not built yet; the first `proofmap build` here compiles it (a few minutes, once)"
  let es ← Launcher.engines h
  IO.println s!"  cached engines: {es.size}"
  for (tc, v, _) in es do IO.println s!"    {tc} (proofmap {v})"
  let path := (← IO.getEnv "PATH").getD ""
  let bin := (h / "bin").toString
  let sep := if System.Platform.isWindows then ";" else ":"
  let norm (s : String) := (s.map fun c => if c == '\\' then '/' else c).toLower
  if (path.splitOn sep).any (norm · == norm bin) then IO.println s!"  PATH: {bin} is on PATH"
  else IO.println s!"  PATH: {bin} is NOT on PATH (open a new terminal after installing, or add it)"
  match ← Launcher.available "elan" with
  | some v => IO.println s!"  elan: {v}"
  | none =>
    IO.println "  elan: NOT FOUND (needed to build engines; https://github.com/leanprover/elan)"
    problems := problems + 1
  match ← Launcher.available "git" with
  | some v => IO.println s!"  git: {v}"
  | none => IO.println "  git: not found (needed only for self-update)"
  let xdg ← if System.Platform.isWindows || System.Platform.isOSX then pure true
    else pure (← Launcher.available "which" #["xdg-open"]).isSome
  let opener := if System.Platform.isWindows then "rundll32 (built in)"
    else if System.Platform.isOSX then "open (built in)"
    else if xdg then "xdg-open"
    else "xdg-open NOT FOUND (`proofmap open` and `serve --open` will print the address instead)"
  IO.println s!"  browser: {opener}"
  IO.println (if problems == 0 then "everything looks fine" else s!"{problems} problem(s) found")
  return if problems == 0 then 0 else 1

def runEngines (args : List String) : IO UInt32 := do
  let h ← Launcher.home
  let prune := args == ["--prune"]
  unless args.isEmpty || prune do
    IO.eprintln "proofmap: usage: proofmap engines [--prune]"
    return 1
  let es ← Launcher.engines h
  if es.isEmpty then IO.println "proofmap: no cached engines"
  for (tc, v, dir) in es do
    -- An engine without `engine.ok` failed to build; the next use builds it again.
    let ready ← (dir / "engine.ok").pathExists
    if prune && (v != version || !ready) then
      IO.FS.removeDirAll dir
      IO.println s!"removed {tc} (proofmap {v})"
    else
      let note := if !ready then ", not built (failed or interrupted)" else if v == version then "" else ", unused by this version"
      IO.println s!"{tc} (proofmap {v}){note}  {dir}"
  return 0

def runSelfUpdate : IO UInt32 := do
  let h ← Launcher.home
  let repo := h / "repo"
  unless ← (repo / ".git").pathExists do
    IO.eprintln s!"proofmap: this install was not made from the release repository ({repo} is missing); run the installer again"
    return 1
  let git (args : Array String) : IO (Option String) := do
    let out ← IO.Process.output { cmd := "git", args := #["-C", repo.toString] ++ args, stdin := .null }
    if out.exitCode != 0 then
      IO.eprintln s!"proofmap: git {" ".intercalate args.toList} failed: {out.stderr.trimAscii}"
      return none
    return some out.stdout
  let some _ ← git #["fetch", "--tags", "--force", "--depth", "1", "origin"] | return 1
  let some tags ← git #["tag", "--list", "v*", "--sort=-v:refname"] | return 1
  let some latest := (tags.splitOn "\n").map (·.trimAscii.toString) |>.find? (· != "") | do
    IO.eprintln "proofmap: no releases found"
    return 1
  if latest == s!"v{version}" then
    IO.println s!"proofmap: {version} is the latest release"
    return 0
  IO.println s!"proofmap: updating {version} to {latest}"
  let some _ ← git #["fetch", "--depth", "1", "origin", "tag", latest] | return 1
  let some _ ← git #["checkout", "--force", latest] | return 1
  let (cmd, args) := if System.Platform.isWindows
    then ("powershell", #["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (repo / "install.ps1").toString, "-Source", repo.toString])
    else ("sh", #[(repo / "install.sh").toString, "--source", repo.toString])
  let child ← IO.Process.spawn { cmd, args, env := ← Launcher.childEnv }
  child.wait

def runUninstall (args : List String) : IO UInt32 := do
  let h ← Launcher.home
  unless args == ["--yes"] do
    IO.println s!"This removes {h} (the launcher, its source and every cached engine) and takes
{h / "bin"} off PATH. Projects and their proofmap.html files are not touched.
Run `proofmap uninstall --yes` to go ahead."
    return if args.isEmpty then 0 else 1
  let bin := (h / "bin").toString
  if System.Platform.isWindows then
    -- Take bin off the user PATH, then delete the folder once this process (inside it) has exited.
    -- PowerShell with single-quoted paths: the Windows command line escapes double quotes in a
    -- way cmd does not read.
    let q (s : String) := "'" ++ s.replace "'" "''" ++ "'"
    let ps := s!"$b = {q bin}; $p = [Environment]::GetEnvironmentVariable('Path', 'User'); " ++
      "if ($p -and (($p -split ';') -contains $b)) { [Environment]::SetEnvironmentVariable('Path', (($p -split ';') | Where-Object { $_ -and $_ -ne $b }) -join ';', 'User'); 'removed' }"
    let out ← IO.Process.output { cmd := "powershell", args := #["-NoProfile", "-Command", ps], stdin := .null }
    let rm := s!"Start-Sleep -Seconds 2; Remove-Item -LiteralPath {q h.toString} -Recurse -Force"
    discard <| IO.Process.spawn {
      cmd := "powershell", args := #["-NoProfile", "-WindowStyle", "Hidden", "-Command", rm], cwd := h.parent.getD "."
      stdin := .null, stdout := .null, stderr := .null }
    let removed := if (out.stdout.trimAscii.toString) == "removed" then "removed from PATH; " else ""
    IO.println s!"proofmap: {removed}{h} is deleted in a moment. Open a new terminal."
  else
    IO.FS.removeDirAll h
    -- Remove the lines the installer added to shell profiles (marked `# proofmap`).
    if let some user ← IO.getEnv "HOME" then
      for f in [".profile", ".bashrc", ".zshrc"] do
        let p : System.FilePath := user / f
        if ← p.pathExists then
          let text ← IO.FS.readFile p
          let kept := (text.splitOn "\n").filter (!·.endsWith "# proofmap")
          if kept.length != (text.splitOn "\n").length then IO.FS.writeFile p ("\n".intercalate kept)
    IO.println s!"proofmap: removed {h} and the PATH lines from your shell profile. Open a new terminal."
  return 0

/-- The global install's launcher: its own commands, local ones, and delegation to engines. -/
def runLauncher (args : List String) : IO UInt32 := do
  let (projectArg, args) := takeProject args
  match args with
  | ["--version"] =>
    IO.println s!"proofmap {version} (global launcher, Lean {Lean.versionString})"
    return 0
  | [] | ["--help"] | ["-h"] =>
    IO.println (usage ++ "\n" ++ globalUsage)
    return 0
  | ["doctor"] => runDoctor projectArg
  | "engines" :: rest => runEngines rest
  | ["self-update"] => runSelfUpdate
  | "uninstall" :: rest => runUninstall rest
  -- These do not read the project, so the launcher runs them itself.
  | "open" :: _ | "compare" :: _ => runLocal args
  | "serve" :: rest => if rest.contains "--no-build" then runLocal args else delegateToEngine projectArg args
  | "build" :: _ | "check" :: _ => delegateToEngine projectArg args
  | cmd :: _ =>
    IO.eprintln s!"proofmap: unknown command '{cmd}'\n\n{usage}\n{globalUsage}"
    return 1

/-- Entry point. -/
def main (args : List String) : IO UInt32 := do
  if ← Launcher.isLauncher then runLauncher args else runLocal args

end Proofmap.Cli
