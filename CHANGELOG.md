# Changelog

All notable changes to proofmap are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased

First release.

### Extraction (Lean)

- **What it reads.** A built Lean 4 project on v4.28.0 to v4.35.0; newer versions are tried with a warning. For every declaration of the root modules it records:
  - kind and statement (pretty-printed, with links to the names in it);
  - source range and code, docstring, and the comment above it;
  - section, from `namespace` and `section` blocks, Markdown headings and comment dividers.
- **Dependencies** are split into "used in the statement" and "used in the proof". Edges through generated helpers are collapsed, and redundant edges are left out of the map.
- **Status is transitive.** Every declaration lists all the axioms it rests on, using Lean's own `collectAxioms` rule. `sorry` and axioms outside `[axioms] standard` are flagged along the whole chain.
- **Root modules** default to the lakefile's libraries, and each root brings in all its built submodules. Modules of dependencies, Mathlib included, can be mapped too (`--root Mathlib.Data.List`). Modules that cannot be imported together are extracted in separate groups and merged.
- **Generated declarations** (instances, auxiliary lemmas, matchers, equations, projections) are kept but marked, so the viewer can hide them. A project declaration without a source range (match splitters, congruence lemmas, `deriving` helpers) counts as generated, which holds across Lean versions whatever the helpers are named.
- **Readable titles** from Lean names, with a glossary that `proofmap.toml` can extend. For example, `isSquare_neg_one_iff` becomes "Is square negative one if and only if".
- **Summaries** come from the `@[proofmap ...]` attribute, `proofmap.toml`, docstrings or comments, each labelled with its source.
- **Main results** are detected automatically or set in the config. Ranks (result, theorem, lemma, def) are computed from the code.
- **Tactic walkthroughs** (the goals before and after every tactic step) are optional: `--walkthrough` or `[walkthrough] enabled = true`. They elaborate every proof again, so they take about as long as `lake build`.
- **Workers and caches.** Parallel worker processes, their number chosen from CPUs and the memory workers were seen to use; `--jobs N` overrides it. Per-group and per-file caches in `.lake/proofmap/` make an unchanged rebuild take seconds.
- **GitHub links** point at the commit that was mapped when `repoUrl` is set.

### Output

- **`proofmap.json`** (`--json`), format version 1, with a JSON Schema in `schema/proofmap.schema.json`.
- **Pages carry the same data in a compact internal form.** Each distinct goal line is stored once, and generated helpers carry no hover spans or code.
- **Large single pages are split.** A page that would exceed 15 MB moves its walkthroughs, and if needed the details of generated helpers, into `<name>_files/` next to it, and loads them on demand, also from disk. proofmap prints a hint when a page is still large.
- **`--site DIR`** writes `index.html` and a `data/` folder for any static host, under any sub-path.

### Viewer

- **One offline HTML file**, with map, outline, walkthrough, path finder, health and compare views.
- **Detail panel:** linked statements, highlighted source with the file's line numbers, links to VS Code and GitHub, and a "Why?" chain for `sorry` and extra axioms.
- **Map:** opens from the main results one step at a time. More than 9 dependencies are grouped by step, section or module, and other libraries collapse into one card per library, with at most 150 cards on screen.
- **Presentation:** persona presets (reader, mathematician, developer, auditor), guided tour, glossary hover cards, light and dark themes, export as SVG or PNG, and shareable links.
- **Accessibility:** keyboard navigation throughout; status always shown by icon and text as well as colour; WCAG 2.1 AA checked with axe-core.
- **Performance budgets**, checked on a 13,759-declaration page: interactive within 2 s, layouts within 500 ms, search within 50 ms.

### Commands

- **`build`:** single file, `--site` folder, `--json` data.
- **`open`.**
- **`serve`:** 127.0.0.1 only, with a host check and path checks, and the open page reloads after each build.
- **`check`:** reports `sorry`, extra axioms and config entries naming missing declarations, with "did you mean" suggestions. `--strict` exits with code 3 for CI.
- **`compare`:** declarations added, removed and changed between two snapshots, and status changes. Generated helpers are left out.
- **Exit codes:** 0 OK, 1 usage or configuration error, 2 build failure, 3 `check --strict` found problems.

### Install

- **Global install** (`install.ps1`, `install.sh`). The launcher builds one engine per Lean toolchain on first use and reuses it after that. Includes `doctor`, `engines [--prune]`, `self-update` and `uninstall`.
- **Project install** with `require proofmap`, which also enables the `@[proofmap ...]` attribute.
