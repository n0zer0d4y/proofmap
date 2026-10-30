import Lean

/-!
# `@[proofmap ...]` attribute

Optional author tags on a declaration, for projects that `require proofmap` and import this
module:

```lean
@[proofmap summary "Every natural number is a sum of four squares", step "Lagrange's theorem", rank result]
theorem sum_four_squares (n : ℕ) : ∃ a b c d : ℕ, a ^ 2 + b ^ 2 + c ^ 2 + d ^ 2 = n := ...
```

`summary` overrides the summary taken from comments, `step` groups the declaration into a big
step on the map, and `rank` (`result`, `theorem`, `lemma` or `def`) overrides the computed rank.
`proofmap.toml` can set the same things without touching the code.
-/

-- Outside the namespace: an attribute is found by its syntax kind, which must be `proofmap`.
-- The `&"..."` atoms are non-reserved, so `summary`, `step`, `rank` and `proofmap` stay usable
-- as ordinary identifiers in every project that imports this module.
declare_syntax_cat proofmapTagItem (behavior := symbol)
syntax &"summary " str : proofmapTagItem
syntax &"step " str : proofmapTagItem
syntax &"rank " ident : proofmapTagItem

syntax (name := proofmap) &"proofmap " proofmapTagItem,+ : attr

namespace Proofmap

open Lean

structure Tag where
  summary : Option String := none
  step : Option String := none
  rank : Option String := none
  deriving Inhabited, Repr

private def ranks : List String := ["result", "theorem", "lemma", "def"]

private def parseTag (stx : Syntax) : AttrM Tag := do
  let mut tag : Tag := {}
  for item in stx[1].getSepArgs do
    match item with
    | `(proofmapTagItem| summary $s:str) => tag := { tag with summary := s.getString }
    | `(proofmapTagItem| step $s:str) => tag := { tag with step := s.getString }
    | `(proofmapTagItem| rank $r:ident) =>
      let r := r.getId.toString
      unless ranks.contains r do
        throwErrorAt item "proofmap: unknown rank '{r}'; expected one of {ranks}"
      tag := { tag with rank := r }
    | _ => throwErrorAt item "proofmap: expected `summary \"...\"`, `step \"...\"` or `rank <name>`"
  return tag

initialize proofmapAttr : ParametricAttribute Tag ←
  registerParametricAttribute {
    name := `proofmap
    descr := "proofmap tags: summary, step and rank shown in the proof map"
    getParam := fun _ stx => parseTag stx
  }

/-- The tags of a declaration, if it has the attribute. -/
def tagOf? (env : Environment) (n : Name) : Option Tag :=
  proofmapAttr.getParam? env n

end Proofmap
