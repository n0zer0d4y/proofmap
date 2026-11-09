# FAQ

### Which Lean versions does proofmap support?

Lean v4.28.0 and newer. proofmap is tested on v4.28.0 and the latest stable release, and each new stable Lean release gets a proofmap release. With the global install, proofmap builds a matching engine for each Lean version it meets, so projects on different versions all work. If a project is older than v4.28.0, proofmap says so and suggests bumping `lean-toolchain`. `proofmap doctor` shows the version proofmap detected and whether it is supported.

### Does proofmap run my code? Is it safe on code I don't trust?

proofmap loads the project the way `lake build` and documentation tools such as doc-gen4 do: it imports the compiled modules, which runs their initializers, and elaborates the source files again to record tactic steps. Run it only on code you would also build. The page itself runs no Lean code; it only shows data.

### Does anything leave my machine? Can I use it on private code?

Nothing leaves your machine, so yes. proofmap makes no network requests, and the generated page loads nothing from the network (no fonts, scripts or analytics). `proofmap serve` listens on 127.0.0.1 only and answers only requests addressed to it. The page does contain your declarations' source code, statements and comments, so share it only as you would share the code. It contains no folder of your computer: file paths are relative to the project, and a page written outside the project does not record where the project is.

### `proofmap build` says it is "using 1 worker". Can it go faster?

proofmap extracts the project in parallel worker processes and chooses how many from your CPU count and the memory currently available. Each worker loads the project's dependencies: for a Mathlib project, several GB shared between workers plus about 1 GB of its own. When memory is short it uses one worker and says so. `--jobs N` sets the number yourself; more workers than your memory allows will make the machine swap. Later builds are much faster: results are cached per group of modules and per file in `.lake/proofmap/`, so only what changed is extracted again.

### My project is big. How long does a build take?

On a 130-module project that depends on Mathlib (13,759 declarations; 16 GB, 4 cores), a build takes about 2.5 minutes from scratch, most of it spent loading Mathlib, and about 10 seconds when nothing changed. A slice of Mathlib itself (`Mathlib.Data.List`, 64 modules) takes under a minute.

Walkthroughs are the exception, which is why they are off by default. Lean does not keep the goals of each tactic step in its compiled files, so `--walkthrough` makes proofmap elaborate every proof again: on the same project that took 55 minutes with `--jobs 3`, compared with 45 minutes for `lake build`. After that, only changed files and the files that import them are processed again. proofmap picks the number of walkthrough workers from the memory it has seen them use; on a busy machine it may pick one and says so, and `--jobs N` overrides it if you know you have the memory.

### Some of my files are missing from the map.

proofmap maps the modules that have a compiled `.olean`. `proofmap build` runs `lake build` first, so a missing module is usually not part of any library target, or failed to build. proofmap prints a warning for each source file it skipped. To choose modules explicitly, set `rootModules` in `proofmap.toml` or pass `--root`.

### The page is large. Can I make it smaller?

On big projects built with `--walkthrough`, walkthroughs are most of the size. When a page would be over 15 MB, proofmap moves the walkthroughs (and, if needed, the details of generated helpers) into a folder next to it, `proofmap_files/`, and the page loads them from there when you open them; keep the folder next to the page when you move or send it. Without `--walkthrough` they are left out altogether, and `--site DIR` writes a folder for a web server, which loads fastest. If a page is still large, proofmap says so; it still works, just more slowly.

### Can I map part of Mathlib, or of another dependency?

Yes: name its modules as roots, for example `proofmap build --root Mathlib.Data.List`. proofmap finds the sources of packages in the project's `.lake/packages`, so any built module of a dependency can be mapped.

### How do I use proofmap in CI?

Run `proofmap check --strict` after `lake build`. It exits with code 3 when anything depends on `sorry` or on an axiom outside `[axioms] standard`, or when `proofmap.toml` names a declaration that no longer exists. To publish the page, run `proofmap build --site public/` and deploy the folder, for example with GitHub Pages. Saving `proofmap build --json snapshot.json` for each release lets `proofmap compare` show what changed between releases.

### How do I publish the page on GitHub Pages?

For one page, commit `proofmap.html` to the repository, then in the repository's **Settings → Pages** choose **Deploy from a branch**, the branch (for example `main`) and the folder (`/ (root)` or `/docs`). The page is then at `https://<user>.github.io/<repository>/<path>/proofmap.html`, where `<path>` is its folder in the repository. GitHub's own file view shows an HTML file as source code, which is why Pages is needed for a link people can click. A `.nojekyll` file is not needed for a single page. For a large page, `proofmap build --site public/` writes a folder that loads faster, which you deploy the same way.

To link to the page from your README, a badge works well:

```markdown
[![proofmap](https://img.shields.io/badge/proofmap-browse_the_Lean_proofs-1e7b45)](https://<user>.github.io/<repository>/<path>/proofmap.html)
```

### The "View on GitHub" links lead to a 404.

Source links point at the exact commit that was mapped. They work once that commit is pushed: `proofmap build` warns when it is not, or when Lean files have changes that are not committed. Without `repoUrl` in `proofmap.toml`, the links go to the repository's `origin` remote; set `repoUrl` to choose another address, or `repoUrl = ""` to leave the links out. A project in a folder of its repository (such as `repo/lean/`) is handled: the links include that folder.

### How do I update or remove the global install?

`proofmap self-update` installs the latest release. `proofmap engines --prune` removes engines left over from older versions. `proofmap uninstall --yes` removes everything (without `--yes` it only says what it would remove). Your projects and their pages are not touched.

### Where does the global install keep its files?

In `~/.proofmap` (on Windows, `%USERPROFILE%\.proofmap`), or in `PROOFMAP_HOME` if that is set: `bin/` (the `proofmap` command), `launcher/`, `src/` (the source that engines are built from), `engines/` (one per Lean version) and `repo/` (the downloaded release).
