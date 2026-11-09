# Configuration

proofmap works without any configuration. Two optional ways let you adjust what it shows:

- a **`proofmap.toml`** file next to the lakefile, which works with both install modes, and
- the **`@[proofmap ...]` attribute** in the code, which needs the [project install](../README.md#project-install-pinned-for-everyone-working-on-the-project).

Both can set the same things per declaration. When both do, the attribute wins.

## `proofmap.toml`

Every key is optional. proofmap checks the whole file before building and reports every problem with its line, for example `proofmap.toml:7: unknown key in [project] 'rootModule'; did you mean 'rootModules'?`. `proofmap check` validates the file without writing a page. `proofmap build --config FILE` reads another file.

```toml
[project]
title = "Sums of squares"                              # page title (default: the root module names)
rootModules = ["Mathlib.NumberTheory.SumFourSquares"]  # what to map (see below)
roots = ["Nat.sum_four_squares"]                       # the main results the page starts from
repoUrl = "https://github.com/me/my-project"           # adds "View on GitHub" links

[display]
preset = "reader"      # reader | mathematician | developer | auditor
footer = true          # the "Made with proofmap" footer (the About dialog always stays)

[axioms]
standard = ["propext", "Classical.choice", "Quot.sound"]

[walkthrough]
enabled = false        # true: record tactic steps (same as build --walkthrough; slow)

[sections]
dividerPatterns = ['^--\s*[─━=#*-]{2,}\s*(.+?)\s*[─━=#*-]*$', '^-- (§|#)\s*(.+)$']
banners = true

[summaries]
"Nat.euler_four_squares" = "Euler's four-square identity, for natural numbers"

[steps]
"Nat.Prime.sum_four_squares" = "The prime case"

[ranks]
"Nat.Prime.sum_four_squares" = "theorem"

[glossary]
sq = "square"
```

### `[project]`

| Key | Meaning |
|---|---|
| `title` | The page title. Default: the root module names. `--title` overrides it. |
| `rootModules` | The modules to map. Each one brings in itself and **all its built submodules**, so `["Mathlib.NumberTheory"]` maps `Mathlib.NumberTheory.SumFourSquares` too. Default: the libraries in the lakefile (each `lean_lib`, its `roots` or `globs`, else its name). `--root MODULE` overrides it. Modules without a built `.olean` are skipped with a warning; run `lake build` first, which `proofmap build` does unless you pass `--no-lake-build`. |
| `roots` | Full names of the main results. The page opens on them, the outline starts from them, and they get the rank `result`. Default: up to five theorems that nothing else in the project uses, documented ones first, then by how much they rest on; a name or docstring that states a result ("iff", "reduces", "complete", "theorem" and similar words) counts double. `proofmap build` prints the ones it chose. A name that matches nothing is reported, with the closest name proofmap knows. |
| `repoUrl` | A GitHub (or similar) URL. Declarations get links to their lines, at the commit that was mapped when the project is a git checkout. |

### `[display]`

| Key | Meaning |
|---|---|
| `preset` | The view the page opens with. **reader**: the outline first, code folded, plain titles before Lean names. **mathematician**: the map first, statements expanded. **developer**: code shown, controls for generated declarations visible. **auditor**: the health view first. Readers can switch presets in the header. Default: `mathematician`. |
| `footer` | `false` hides the "Made with proofmap" footer. The About dialog, with the license, stays. |

### `[axioms]`

`standard` lists the axioms that do not count as extra axioms. Any other axiom a result depends on is flagged in amber, with a "Why?" chain that names where it comes from. `sorry` is always flagged, in red.

### `[walkthrough]`

Walkthroughs are off by default. `enabled = true` (or `proofmap build --walkthrough`) records the goals before and after every tactic step. Lean does not keep those goals in its compiled files, so proofmap has to elaborate every proof again, which takes about as long as `lake build` of the project and makes the page larger. Later builds only redo the files that changed and the files that import them. `--no-walkthrough` turns them off for one build when the config turns them on.

### `[sections]`

proofmap groups declarations by the sections of their file: `namespace` and `section` blocks, Markdown headings in module docs (`/-! # Heading -/`), and comment dividers. `dividerPatterns` are the regular expressions that recognise a divider line; the first capture group, or the last one if there are several, is the section title. `banners = false` stops framed comment banners from counting as section headings.

### `[summaries]`, `[steps]`, `[ranks]`

Keyed by a declaration's full name.

- **summaries:** the one-line description shown on cards and in the outline. Without one, proofmap uses the first paragraph of the docstring, else of the comment just above the declaration. As a last resort it shows the title of the enclosing section, marked "In section: ...", never presented as the declaration's own description. Every summary carries a chip that says where it came from.
- **steps:** names the big steps of the proof. The map's group cards, the outline's order and the health view's progress bars use them; without a step, a declaration is grouped by its section.
- **ranks:** `result`, `theorem`, `lemma` or `def`. proofmap computes a rank from the code (roots are results; theorems with a docstring, or that much else rests on, are theorems; other theorems are lemmas) and this overrides it.

### `[glossary]`

proofmap turns Lean names into readable titles, so `isSquare_neg_one_iff` becomes "Is square negative one if and only if". The glossary maps name fragments to words. Your entries are added to the built-in ones and win over them.

## The `@[proofmap ...]` attribute

With the project install, any file can `import Proofmap.Attr` and tag declarations:

```lean
import Proofmap.Attr

@[proofmap summary "Every natural number is a sum of four squares", step "Lagrange's theorem", rank result]
theorem sum_four_squares (n : ℕ) : ∃ a b c d : ℕ, a ^ 2 + b ^ 2 + c ^ 2 + d ^ 2 = n := ...
```

| Item | Same as |
|---|---|
| `summary "text"` | `[summaries]` |
| `step "name"` | `[steps]` |
| `rank result` (or `theorem`, `lemma`, `def`) | `[ranks]` |

The words `summary`, `step`, `rank` and `proofmap` stay usable as ordinary names in your project. The attribute changes nothing about the declaration itself; Lean only records the tag.
