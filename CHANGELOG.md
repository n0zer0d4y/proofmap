# Changelog

All notable changes to proofmap are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - unreleased

### Added

- **Main result switcher** on the map when a project has several main results.
- **Needed for:** the details panel says how many of the main results rest on the selected declaration ("Needed for 2 of 5 main results"), with a small meter; hover it for their names.
- **Path finder choices depend on each other:** clicking a box lists its choices without typing; once one end is chosen, the other box offers only ends that connect to it, so every pair it offers has a path. The project's own declarations come first, Lean core last.
- **Outline: Expand all and Collapse all.** On very large projects Expand all stops before the outline passes 2,000 rows, and says so.
- **Health counts open their lists:** complete declarations, those that have `sorry` or use extra axioms, deprecated and unsafe ones, and the results using each axiom.
- **Standalone results** in the health view: documented theorems that nothing else uses are listed apart from possibly unused declarations.
- **Comparison details:** selecting a changed result shows what it was in the older version (status, statement, code).
- **Walkthrough case labels:** the step list shows the case a step works on where it changes.
- **Missing names:** a link to a name that is not in the build says so and offers the closest matches.
- **Lean core switch** on the map (Init, Std, Lean as one library card).
- **Build messages:** `proofmap build` names the main results and page title it chose, and how to set them in `proofmap.toml`.
- A folding legend, feedback for `copy` and for `p` on the map, arrowheads on edges, and an inline favicon.
- **Highlighted chains** (a tour step, a "Why?" chain) draw their lines in the highlight colour as moving dashes, still for readers who ask for less motion.

### Changed

- **Status words are the same everywhere:** **Proved** for a theorem and **Complete** for other kinds (and in counts and the legend), **Has sorry**, **Extra axiom** and **Other library**. The details panel names where a `sorry` or an extra axiom comes from ("Rests on sorry in X", "Uses the axiom X", "Trusts compiled code" for `native_decide`). Health lists "Where the sorry is"; Compare counts "No longer has sorry" and "Now has sorry".
- **Data format version 2:** `project.rootDir` (an absolute path) is removed. Single-file pages record `project.pageToRoot`, the project folder relative to the page, and "Open in VS Code" works it out from where the page is opened. Pages, `--site` folders and `proofmap.json` contain no absolute local path. The viewer still reads version 1 files, for comparisons.
- **Map cards:** the statement is shown without the declaration's own name and universe list, up to 8 lines high, and a longer one scrolls inside the card; opening what a card rests on no longer changes its size. With "Code in cards", opened and selected cards show their code in a scrolling block. The map toolbar labels its main result control "Main result".
- **Map camera:** the map opens at a readable zoom and pans to cards as they appear; tour steps and "Find selected" are centred.
- **Libraries:** one card per library (Mathlib, Lean core) instead of one per module area. Lean core is hidden for the reader and mathematician presets.
- **"Show more around this"** opens one ring at a time (first the selection, then what it rests on), and is disabled when nothing is left.
- **Layout:** balanced placement, so cards sit level with the cards they connect to.
- **Statements** are printed as inside the declaration's own namespace.
- **Titles:** `mul` reads "times", `sq` reads "square", a capital letter after a lower-case part stays (`inP` is "In P"), and a single letter keeps its digits (`f3Enc` is "F3 enc").
- **Main results:** documented theorems come first, then size, weighted towards names and docstrings that state a result.
- **Outline:** keeps what is open and its scroll position across views, opens down to the selection, lists theorems before definitions, renders summaries as Markdown, and always shows the Lean name next to the title.
- **Path finder:** chains are listed shortest first, and the shortest chain is always found.
- **Compare** compares statements by their meaning (names written in full), so a snapshot from proofmap 0.1, which printed names differently, does not show statements as changed.
- **Search** finds words inside Markdown and hyphenated phrases, and ranks main results, then the project's declarations, before other libraries. When several declarations share a name, each result names its module.
- **Details panel:** "Uses" and "Used by" are grouped by library (Lean core folded), generated helpers are left out of "Used by", and the rank badge appears only when it differs from the kind.
- **Export:** SVG and PNG are in the map toolbar and contain the whole map; the SVG is shapes and text (no HTML inside), so it works in papers and vector editors.
- **Theme** is remembered by the browser instead of travelling in links.
- **Presets** keep the current view when changed; their view applies when the page opens.
- **Guided tour** runs on the map; its panel sits in the map's lower left corner, above the legend, without repeating the details panel.
- **Health:** steps are grouped by file in source order.
- **Walkthrough:** a bullet with a single tactic is one step, source lines wrap, and the exit names the view it returns to.
- **Sections:** Markdown headings made only of box-drawing characters are decoration, not sections.
- **`proofmap serve`** reports the project folder to the page (on 127.0.0.1 only), for source links.

### Fixed

- Adding several cards at once (such as "Show on map" for a "Why?" chain) could draw the map backwards, with a foundation to the right of what uses it; a layout that would point an arrow backwards is now redone from scratch.
- The view could leave the selected card or the cards just added outside the map after the layout settled.
- Opening rows in the outline of a large project was slow: every row carried a hidden statement for printing. Statements are now made only when printing, so Expand all on a 13,759-declaration page takes well under a second.
- On narrower windows, long names in lists (health, the details panel) showed only an ellipsis; they wrap now.
- Printing the outline (or saving it as PDF) gave only the part on screen, squeezed into the left of the page beside an empty column for the details panel; it now prints the whole outline across as many pages as it needs, at full width.
- The view tabs did nothing while a walkthrough was open.
- A link or a click that selected a declaration not on the map left the map unchanged.
- Enter, Escape, the arrow keys, `f` and `p` on a map toolbar control acted on the map instead of the control.
- The guided tour drove an open walkthrough, or ran out of sight on the health and outline views; Escape did not end it.
- The guided tour's panel stayed on screen on every view and covered the map's legend. It now belongs to the map: it sits above the legend, is hidden on other views, and is back at the same step when you return to the map.
- Escape on the About dialog also closed an open walkthrough.
- Back after opening a walkthrough dropped the selection.
- Display settings such as "Code in cards" reset to the preset's defaults on every navigation.
- After the first case of an induction, the walkthrough said "No goals left"; it now says the case is done, and that the proof is complete only at its end.
- Collapsing a compound tactic that held the current step left the walkthrough inconsistent.
- The path finder could report a longer chain than the shortest one when there were more than 200 chains.
- Path-finder parameters stayed in the address of every other view.
- Cards showed scroll bars even when their content fitted.
- Screen readers read edges by internal ids; every edge was a Tab stop.
- A page on a static web host requested the live-reload address and logged a 404.
- The minimap kept a light frame in dark mode.

## [0.1.0] - 2026-10-31

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
