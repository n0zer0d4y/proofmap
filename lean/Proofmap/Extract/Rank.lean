import Std.Data.HashSet
/-!
# Roots, importance and ranks

All functions work on the visible project declarations only (noise and externals excluded),
given as dense indices `0..n` with their collapsed dependencies (statement and proof together).

- Roots: from the config when set; otherwise project theorems that no project declaration uses,
  documented ones first, sorted by the number of project declarations they rest on
  (transitively), top 5; a sanity check gives way to the theorem it checks (`autoRoots`).
- Rank: `result` for roots (or when tagged); `theorem` for theorems with a docstring or with a
  number of transitive dependents in the top 10%; otherwise `lemma` (theorems) or `def`.
  Author tags always win.
-/

namespace Proofmap.Extract.Rank

/-- Bitset over `n` elements. -/
private abbrev Bits := Array UInt64

private def Bits.empty (n : Nat) : Bits := Array.replicate ((n + 63) / 64) 0
private def Bits.set (b : Bits) (i : Nat) : Bits := b.modify (i / 64) (· ||| ((1 : UInt64) <<< (i % 64).toUInt64))
private def Bits.union (a b : Bits) : Bits := Id.run do
  let mut out := a
  for h : k in [0:b.size] do out := out.modify k (· ||| b[k])
  return out

private def popcount64 (x : UInt64) : Nat := Id.run do
  let mut x := x
  let mut n := 0
  while x != 0 do
    x := x &&& (x - 1)
    n := n + 1
  return n

private def Bits.count (b : Bits) : Nat := b.foldl (fun acc w => acc + popcount64 w) 0

/-- An order in which every declaration comes after all declarations it depends on
(depth-first post-order; dependency cycles, which Lean rarely allows, are cut). -/
private def depsFirstOrder (deps : Array (Array Nat)) : Array Nat := Id.run do
  let n := deps.size
  let mut state : Array UInt8 := Array.replicate n 0  -- 0 new, 1 on stack, 2 done
  let mut order : Array Nat := #[]
  for root in [0:n] do
    if state[root]! != 0 then continue
    -- Iterative DFS: (node, next child index).
    let mut stack : Array (Nat × Nat) := #[(root, 0)]
    state := state.set! root 1
    while !stack.isEmpty do
      let (v, k) := stack.back!
      match deps[v]![k]? with
      | some w =>
        stack := stack.pop.push (v, k + 1)
        if w < n && state[w]! == 0 then
          state := state.set! w 1
          stack := stack.push (w, 0)
      | none =>
        stack := stack.pop
        state := state.set! v 2
        order := order.push v
  return order

/-- For each declaration, the number of declarations that depend on it, directly or not. -/
def transitiveDependents (deps : Array (Array Nat)) : Array Nat := Id.run do
  let n := deps.size
  -- Users before their dependencies: reverse of the dependencies-first order.
  let order := (depsFirstOrder deps).reverse
  let mut users : Array Bits := Array.replicate n (Bits.empty n)
  for u in order do
    let mine := users[u]!.set u
    for v in deps[u]! do
      if v < n && v != u then users := users.modify v (·.union mine)
  return users.map (·.count)

/-- For each declaration, the number of declarations it depends on, directly or not. -/
def transitiveDependencies (deps : Array (Array Nat)) : Array Nat := Id.run do
  let n := deps.size
  let order := depsFirstOrder deps
  let mut below : Array Bits := Array.replicate n (Bits.empty n)
  for u in order do
    let mut b := below[u]!
    for v in deps[u]! do
      if v < n && v != u then b := (b.union below[v]!).set v
    below := below.set! u b
  return below.map (·.count)

/-- Whether a name or docstring reads like a headline result: an equivalence, a reduction, a
completeness or hardness statement, or a named theorem. -/
def statesResult (name : String) (doc : Option String) : Bool :=
  let words := #["iff", "reduces", "reduction", "complete", "hard", "equiv", "theorem", "characteriz"]
  let text := (name ++ " " ++ doc.getD "").toLower
  words.any fun w => (text.splitOn w).length > 1

/-- Name endings that mark a sanity check rather than a result (`T_hyps_satisfiable`). -/
def checkSuffixes : Array String := #["satisfiable", "witness", "example", "sanity", "test", "check"]

/-- Whether a declaration's name says it is a sanity check: its last component ends in one of
`checkSuffixes` after an underscore (`numeric_hyps_satisfiable`), or is one of them. -/
def looksLikeCheck (name : String) : Bool :=
  let last := ((name.splitOn ".").getLast?.getD name).toLower
  checkSuffixes.any fun s => last == s || last.endsWith ("_" ++ s)

/-- Automatic roots: theorems no one uses, top `k`. Documented theorems come first, so a large
undocumented internal lemma does not push out the documented results; within each group, by
number of transitive dependencies, doubled for theorems whose name or docstring states a result
(`statesResult`).

Sanity checks give way to what they check. A check applies a theorem to concrete values: nothing
uses it, it rests on more than the theorem, and the theorem is used by the check alone. When an
unused theorem is a check (its name says so, `looksLikeCheck`, or it is undocumented while a
theorem it applies is documented), the theorems it applies that only it uses become candidates,
and the check goes to the end of the list.

Every part of the project is represented: the top `k` by rank are kept, and the best candidate of
each `area` (a folder of the project, see `Enrich`) that is not among them is added, up to `maxK`
in all. So a repository with results in several folders shows each of them without losing any of
its strongest ones. The result keeps the ranking order. -/
def autoRoots (deps : Array (Array Nat)) (isTheorem : Nat → Bool) (name : Nat → String)
    (k : Nat := 5) (documented : Nat → Bool := fun _ => false) (headline : Nat → Bool := fun _ => false)
    (area : Nat → String := fun _ => "") (maxK : Nat := 8) :
    Array Nat := Id.run do
  let n := deps.size
  -- Distinct users of each declaration.
  let mut users : Array Nat := Array.replicate n 0
  for u in [0:n] do
    let mut seen : Std.HashSet Nat := {}
    for v in deps[u]! do
      if v < n && v != u && !seen.contains v then
        seen := seen.insert v
        users := users.set! v (users[v]! + 1)
  let below := transitiveDependencies deps
  let unused := (List.range n).toArray.filter fun i => isTheorem i && users[i]! == 0
  let mut candidates : Array Nat := #[]
  let mut demoted : Std.HashSet Nat := {}
  for w in unused do
    let applied := (deps[w]!.filter fun t => t < n && t != w && isTheorem t && users[t]! == 1).toList.eraseDups
    let isCheck := looksLikeCheck (name w) || (!documented w && applied.any documented)
    if isCheck then
      demoted := demoted.insert w
      for t in applied do
        if (looksLikeCheck (name w) || documented t) && !candidates.contains t then candidates := candidates.push t
    if !candidates.contains w then candidates := candidates.push w
  -- Wording that states a result doubles a theorem's weight; it does not let a small lemma
  -- (`foo_iff`) overtake the theorem the project builds up to.
  let weight (i : Nat) : Nat := below[i]! * (if headline i then 2 else 1)
  let checked (i : Nat) : Bool := demoted.contains i
  let sorted := candidates.qsort fun a b =>
    (!checked a && checked b) || (checked a == checked b &&
      ((documented a && !documented b) || (documented a == documented b &&
        (weight a > weight b || (weight a == weight b && name a < name b)))))
  -- The top `k`, then the best of each area not yet represented (checks never stand for an
  -- area), up to `maxK`.
  let top := sorted.extract 0 k
  let mut seen : Std.HashSet String := top.foldl (fun s i => if checked i then s else s.insert (area i)) {}
  let mut chosen := top
  for i in sorted do
    if chosen.size >= maxK then break
    if !checked i && !seen.contains (area i) then
      seen := seen.insert (area i)
      chosen := chosen.push i
  return sorted.filter chosen.contains

/-- The dependents count at the 90th percentile among theorems (the top-10% threshold). -/
def topTenPercentThreshold (dependents : Array Nat) (isTheorem : Nat → Bool) : Nat :=
  let counts := ((List.range dependents.size).toArray.filter isTheorem).map (dependents[·]!)
    |>.qsort (· > ·)
  if counts.isEmpty then 0
  else
    let k := max 1 (counts.size / 10)
    max 1 counts[k - 1]!

end Proofmap.Extract.Rank
