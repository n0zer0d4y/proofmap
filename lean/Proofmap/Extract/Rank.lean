/-!
# Roots, importance and ranks

All functions work on the visible project declarations only (noise and externals excluded),
given as dense indices `0..n` with their collapsed dependencies (statement and proof together).

- Roots: from the config when set; otherwise project theorems that no project declaration uses,
  sorted by the number of project declarations they rest on (transitively), top 5.
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

/-- Automatic roots: theorems no one uses, by number of transitive dependencies, top `k`. -/
def autoRoots (deps : Array (Array Nat)) (isTheorem : Nat → Bool) (name : Nat → String)
    (k : Nat := 5) : Array Nat := Id.run do
  let n := deps.size
  let mut used : Array Bool := Array.replicate n false
  for u in [0:n] do
    for v in deps[u]! do
      if v < n && v != u then used := used.set! v true
  let below := transitiveDependencies deps
  let candidates := (List.range n).toArray.filter fun i => isTheorem i && !used[i]!
  let sorted := candidates.qsort fun a b =>
    below[a]! > below[b]! || (below[a]! == below[b]! && name a < name b)
  return sorted.extract 0 k

/-- The dependents count at the 90th percentile among theorems (the top-10% threshold). -/
def topTenPercentThreshold (dependents : Array Nat) (isTheorem : Nat → Bool) : Nat :=
  let counts := ((List.range dependents.size).toArray.filter isTheorem).map (dependents[·]!)
    |>.qsort (· > ·)
  if counts.isEmpty then 0
  else
    let k := max 1 (counts.size / 10)
    max 1 counts[k - 1]!

end Proofmap.Extract.Rank
