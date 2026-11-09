# Data format: `proofmap.json`

`proofmap build --json FILE` writes the data the page is built from. Other tools can read it: to track progress over time, check a project in CI, or draw their own views. The JSON Schema in [`schema/proofmap.schema.json`](../schema/proofmap.schema.json) is the authoritative definition; this page explains how the pieces fit together.

```jsonc
{
  "schema": 2,
  "generator": { "name": "proofmap", "version": "0.3.1", "lean": "4.29.0" },
  "project": { "title": "...", "rootModules": ["Mathlib.NumberTheory.SumFourSquares"], "roots": [1024], "...": "..." },
  "modules": [ { "name": "Mathlib.NumberTheory.SumFourSquares", "path": ".lake/packages/mathlib/Mathlib/NumberTheory/SumFourSquares.lean", "...": "..." } ],
  "decls": [ { "id": 1024, "name": "Nat.sum_four_squares", "...": "..." } ],
  "walkthroughs": [ { "decl": 1024, "stepCount": 7, "steps": [ "..." ] } ],
  "glossary": { "iff": "if and only if" }
}
```

## Paths

Module `path`s are relative to the project folder. The file records no absolute path of the computer it was built on. A single-file page inside the project folder also records `project.pageToRoot`, the project folder relative to the page (`""`, `".."`, `"../.."`), so the viewer can link to source files when the page is opened from the project. A page outside the project folder records none, since that path would name the folders around the project.

With a repository address (`project.repoUrl`), source links point at `project.repoRef`, the commit that was mapped. When the project is in a folder of its git repository, `project.repoPathPrefix` is that folder with a trailing slash (`lean/`), and goes between the commit and a module's path. It is absent when the project is at the top of its repository; it was added within format 2, so older files simply lack it.

## Versioning

`schema` is the format version, currently `2`. Fields may be added within a version; a reader should ignore fields it does not know. Removing a field or changing its meaning raises the version.

## Declarations

`decls` holds every declaration on the page. A declaration's `id` is its index in the array, and every reference to a declaration elsewhere (dependencies, roots, walkthroughs, hover links) is an id.

- **Project declarations** (`external: false`) come from the root modules and carry everything: source `range` (1-based lines, 0-based columns), `code`, `docstring`, `leadingComment` (the comment just above it), `summary` with its `source` (`attr`, `config`, `docstring`, `comment` or `section`), `sectionPath` into the module's section tree, `size`, `rank`, `step` and `tags`.
- **External declarations** (`external: true`) are from other libraries and appear only when a project declaration uses them directly. They carry their name, kind, module and signature, but no code and no dependencies.
- `flags` that start with `noise:` (such as `noise:instance`, `noise:aux`, `noise:matcher`) mark generated declarations the viewer hides by default. `noise:generated` marks a project declaration that has no source range, which is how Lean's generated helpers (match splitters, congruence lemmas, `deriving` helpers) are recognised across Lean versions. The others (`private`, `deprecated`, `unsafe`, `partial`) are informational.
- `signature` is the pretty-printed statement, with names written as inside the declaration's own namespace; `signatureHover` gives the code-point ranges in it that name other declarations.

## Dependencies

Each declaration has two dependency lists, each split into `statement` (used in the type) and `proof` (used only in the value or proof):

- `directDeps`: what Lean records, including generated helpers.
- `deps`: the same after collapsing through hidden helpers, which is what the map draws. An edge in `deps` that is missing from `directDeps` passes through hidden helpers.

Reverse dependencies ("used by") are not stored; compute them from `deps`.

## Status

`status.axioms` lists every axiom the declaration depends on, transitively, sorted. `status.sorry` is true when that includes `sorryAx`. `status.nonstandardAxioms` lists those outside `project.standardAxioms` (excluding `sorryAx`). Because the lists are transitive, a declaration's status already reflects everything below it.

## Modules and sections

Each module has its `path` relative to the project root, its `imports`, its module documentation as Markdown (`doc`), and a tree of `sections`. Sections come from `namespace` and `section` blocks, Markdown headings in module docs, and comment dividers. A declaration's `sectionPath` is the index path into that tree.

## Walkthroughs

`walkthroughs[i]` belongs to declaration `decl`, and that declaration's `walkthrough` field is `i`. Each step has the `tactic` text, its source `range`, its nesting `depth` (children of a compound tactic follow it with `depth + 1`), and the pretty-printed goals before and after it (`goalsBefore`, `goalsAfter`; an empty `goalsAfter` means the step closed the goal).

`walkthroughs` is empty unless the build ran with `--walkthrough` (or `[walkthrough] enabled = true`). `proofmap build --json` always writes each walkthrough inline, with its `steps` and `stepCount`.

Pages (the HTML file and `--site` folders) carry the same data in a compact internal form, and may move walkthroughs into separate files next to the page. That form changes between proofmap versions and is not part of this format: read `proofmap.json`, not the page.
