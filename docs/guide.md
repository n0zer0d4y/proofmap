# User guide

A proofmap page is one HTML file (or one folder, for a site). It needs no server and no network: open it in any current browser. Everything you do on the page is kept in its address, so the back button works, and a copied link opens the same view, selection and settings for whoever you send it to.

## The page at a glance

- **Header:** the project title, the search box (press `/` to jump to it), the views (Map, Outline, Path finder, Health, Compare), the persona preset, the theme switch (system, light, dark), **Walk me through it**, and export as SVG or PNG.
- **Main area:** the current view.
- **Detail panel** (right, resizable): everything about the selected declaration.

Every status is shown by colour **and** by an icon and words, so it reads without colour too:

| Mark    | Meaning                                                            |
| ------- | ------------------------------------------------------------------ |
| ✓ green | Proved, using only the standard axioms.                            |
| ✗ red   | Contains `sorry`: an unfinished proof, here or somewhere below it. |
| ! amber | Uses a non-standard axiom (an extra assumption).                   |
| ○ grey  | From another library (Mathlib, core); not checked by this page.    |

## Views

### Map

The map starts at the main result and shows what it rests on, laid out left to right with the result on the right. It shows a readable amount at a time: helpers that Lean generates (instances, auxiliary lemmas, matchers) are hidden, and declarations from other libraries (Mathlib, core) are gathered into one card per library.

- **Cards** show a declaration's status, title, Lean name, one-line summary (with a chip saying where the summary came from), and how many results it rests on and how many use it. Click a card to select it; click again (or press Enter) to expand it, which shows the statement with linked names and, with code shown, the source.
- **Edges** read as sentences (hover one): a solid line means "is used in the proof of", a dashed line "appears in the statement of", a dotted line "is used through hidden helpers".
- **Group cards** ("+12 in The prime case") open in place.
- **Toolbar:** _Fit_, _Find selected_, _Focus map here_ (rebuild the map around the selection), _Show more around this_, _Back to main result_, and the _Other libraries_ / _Generated helpers_ switches.
- **Keyboard:** arrow keys move between cards, Enter expands, Escape collapses, `f` focuses the map on the selection, `p` sends it to the path finder.
- Nothing moves on its own: the layout changes only when you open or close something.

### Outline

The proof as a table of contents: each main result, then what it rests on, indented, each with its summary. A declaration used in several places appears in full the first time and as "also used here" afterwards. The outline prints well (the print layout drops the controls).

![The outline view](images/outline.png)

### Detail panel

For the selected declaration: where it lives (module and section), its title and Lean name (with a copy button), badges explaining its kind, its summary and docstring (Markdown, with maths), the comment above it in the source, its statement with linked names (hover a name for its statement, click to go there), the source with the file's line numbers, links to open the line in VS Code or on GitHub, and the lists of what it uses and what uses it.

When a result depends on `sorry` or an extra axiom, **Why?** names the chain down to where it comes from, and **Show on map** highlights that chain.

### Walkthrough

For a proof written with tactics, **▶ Walk through the proof** shows the source with the current step highlighted, next to the goals before and after that step. Changed lines are highlighted; a finished goal shows "✓ goal closed".

Walkthroughs are in the page only when it was built with `proofmap build --walkthrough` (or `[walkthrough] enabled = true`). Recording them means elaborating every proof again, which takes about as long as `lake build`, so they are off by default.

- ← and → step back and forward; the slider jumps anywhere; the step list jumps to a step.
- A compound step (such as `constructor` followed by its cases) can be collapsed to one step.
- A proof written as a single term has no steps; the view says so and shows the code.

![A walkthrough of a tactic proof](images/walkthrough.png)

### Path finder

Pick a **from** and a **to** (search boxes, or `p` on the map). The page shows every chain between them up to a length limit as a small map, and the shortest one as a numbered list in plain words: "`Int.lt_of_sum_four_squares_eq_mul` is used in the proof of `Int.exists_sq_add_sq_add_one_eq_mul`, which is used in the proof of ...".

### Health

Counts of proved, unfinished and extra-axiom results; each `sorry` with how many results rest on it; which axioms are used and by how much; the longest proofs; declarations that no other declaration uses (a refactoring aid; scripts and documents outside Lean are not read, so a result checked only there appears too); and progress per module and per step. Declarations that Lean generated without a source location, such as match splitters and congruence lemmas, are left out of these lists, and the page says how many there are.

![The health view](images/health.png)

### Compare

Shows what changed since an older version: results added, removed and changed (statement, code, status or dependencies), and status changes such as "now sorry-free: 12". Open it on a page made by `proofmap compare OLD.json NEW.json`, or choose an older `proofmap.json` (from `proofmap build --json`) right in the view. While a comparison is loaded, new and changed results carry a badge on the map.

### Walk me through it

A guided tour: it starts at the main result and walks down the outline, one card at a time, narrated by the summaries. _Next_ and _Back_ move through it; _End the tour_ stops it.

## Presets: where to start

The preset (header) changes what the page opens with; you can switch at any time.

**Reader** (you want the story of the proof). Start in the outline. Read the main result's summary, then the summaries of the steps beneath it. Expand only what you want to read in full; Lean names stay in the background. _Walk me through it_ reads the outline to you, one result at a time.

**Mathematician** (you want the statements). Start on the map, where statements are expanded. Hover names in a statement to see what they mean. Open a tactic proof's walkthrough to see the goals change. Use the path finder to see how a definition feeds a theorem.

**Developer** (you work on the code). Code is shown and the switches for generated helpers are visible. _Open in VS Code_ jumps to the line. The health view lists declarations that no other declaration uses, and the largest proofs. Run `proofmap serve` while you work: each `proofmap build` reloads the open page.

**Auditor** (you check what is actually proved). Start in the health view: it should say 0 `sorry` and list only the standard axioms. For anything flagged, _Why?_ names the declaration responsible. In CI, `proofmap check --strict` fails the build when anything depends on `sorry` or an extra axiom.

## Sharing

- **One file:** send `proofmap.html`. It opens by double-click, offline.
- **A website:** `proofmap build --site public/` writes `index.html` and a `data/` folder that work under any sub-path, for example on GitHub Pages. Walkthroughs then load only when opened.
- **A link to a view:** copy the address; it carries the view, selection and settings.
- **A picture:** _SVG_ or _PNG_ in the header saves the current view as you see it.
