import Lean

/-!
# Signatures and humanized titles
-/

namespace Proofmap.Extract

open Lean Meta

/-- Built-in glossary: name fragments to plain words. Extended by `[glossary]` in config. -/
def defaultGlossary : Array (String × String) := #[
  ("iff", "if and only if"), ("eq", "equals"), ("ne", "not equal"), ("le", "≤"), ("lt", "<"),
  ("ge", "≥"), ("gt", ">"), ("mul", "times"), ("sq", "square"), ("npComplete", "NP-complete"), ("np", "NP"),
  ("sat", "SAT"), ("pos", "positive"), ("neg", "negative"), ("succ", "successor"),
  ("pred", "predecessor"), ("mem", "membership"), ("inj", "injective"), ("surj", "surjective"),
  ("comm", "commutative"), ("assoc", "associative"), ("aux", "helper"), ("def", "definition"),
  ("mono", "monotone"), ("anti", "antitone"), ("nonneg", "non-negative"), ("nonpos", "non-positive"),
  ("symm", "symmetric"), ("trans", "transitive"), ("refl", "reflexive"), ("card", "cardinality")]

private def lookup (glossary : Array (String × String)) (w : String) : Option String :=
  (glossary.find? (·.1 == w)).map (·.2) <|> (glossary.find? (·.1 == w.toLower)).map (·.2)

/-- Split `fooBarBaz` into `foo`, `Bar`, `Baz`; runs of capitals (`GCD`) stay together. -/
def splitCamel (s : String) : Array String := Id.run do
  let cs := s.toList.toArray
  let mut parts : Array String := #[]
  let mut cur := ""
  for h : i in [0:cs.size] do
    let c := cs[i]
    let prev? := if i > 0 then cs[i - 1]? else none
    let next? := cs[i + 1]?
    let boundary := match prev? with
      | some p =>
        (p.isLower && c.isUpper) || (p.isUpper && c.isUpper && next?.any Char.isLower) ||
        -- A single letter keeps its digits (`f3Enc` → `f3`, `Enc`).
        (p.isAlpha && c.isDigit && cur.length > 1) || (p.isDigit && c.isAlpha)
      | none => false
    if boundary && !cur.isEmpty then
      parts := parts.push cur
      cur := ""
    cur := cur.push c
  if !cur.isEmpty then parts := parts.push cur
  return parts

private def isAcronym (w : String) : Bool :=
  w.length > 1 && w.all Char.isUpper

/-- Humanized title: `double_eq_add'` → "Double equals add (variant)". -/
def humanize (glossary : Array (String × String)) (n : Name) : String :=
  let last := match privateToUserName n with
    | .str _ s => s
    | .num _ k => toString k
    | .anonymous => ""
  let primes := last.toList.reverse.takeWhile (· == '\'') |>.length
  let base := (last.dropEnd primes).toString
  let words := (base.splitOn "_").filter (· != "") |>.toArray.flatMap fun w =>
    match lookup glossary w with
    | some e => #[e]
    | none => (splitCamel w).mapIdx fun i p =>
      match lookup glossary p with
      | some e => e
      | none =>
        -- Acronyms stay, and so does a capital letter after a lower-case part (`inP` → "in P").
        if isAcronym p || (i > 0 && p.length == 1 && p.all Char.isUpper) then p else p.toLower
  let text := " ".intercalate words.toList
  let text := match text.toList with
    | c :: cs => String.ofList (c.toUpper :: cs)
    | [] => toString (privateToUserName n)
  match primes with
  | 0 => text
  | 1 => text ++ " (variant)"
  | k => text ++ s!" (variant {k})"

/-- A constant named inside a signature: `[start, stop)` in code points of the signature text. -/
structure HoverSpan where
  start : Nat
  stop : Nat
  const : Name

/-- Signature text and the spans of constants in it, from the tagged pretty-printer output. -/
private partial def spansOf (infos : PrettyPrinter.InfoPerPos) :
    Widget.TaggedText (Nat × Nat) → StateM (Nat × Array HoverSpan) Unit
  | .text s => modify fun (pos, acc) => (pos + s.length, acc)
  | .append xs => xs.forM (spansOf infos)
  | .tag (i, _) t => do
    let start := (← get).1
    spansOf infos t
    let stop := (← get).1
    if let some (.ofTermInfo ti) := infos[i]? then
      if let .const c _ := ti.expr.consumeMData then
        -- Keep the span only when its text is the constant's name (or a dotted suffix of it):
        -- with `pp.tagAppFns`, notation heads such as `=` tag the whole `a = b` as `Eq`.
        let text := t.stripTags
        let text := if text.endsWith "✝" then (text.dropEnd 1).toString else text
        let full := toString (privateToUserName c)
        if text == full || full.endsWith ("." ++ text) then
          modify fun (pos, acc) => (pos, acc.push { start, stop, const := c })

/-- Pretty-printed signature at width 100, with hover spans for the constants it names. Names
are printed as inside the declaration's own namespace (as `namespace X` would show them), so a
statement about `Foo.Bar` does not repeat `Foo.` on every name. Falls back to the bare name if
printing fails. -/
def signatureOf (n : Name) : MetaM (String × Array HoverSpan) := do
  try
    let f ← withTheReader Core.Context (fun ctx => { ctx with currNamespace := n.getPrefix, openDecls := [] })
      (PrettyPrinter.ppSignature n)
    let tagged := Widget.TaggedText.prettyTagged f.fmt 0 100
    let ((), (_, spans)) := (spansOf f.infos tagged).run (0, #[])
    return (tagged.stripTags, spans.qsort fun a b => a.start < b.start)
  catch _ =>
    return (toString (privateToUserName n), #[])

end Proofmap.Extract
