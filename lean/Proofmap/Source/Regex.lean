/-!
# A small regular-expression engine

Divider patterns in `proofmap.toml` are regular expressions, and Lean has no
regex library, so this is a small backtracking matcher. Supported syntax:

- literals and `.`; escapes `\s \S \d \D \w \W \t \n` and escaped punctuation (`\.`, `\(`, ...);
- character classes `[...]` and `[^...]` with ranges (`a-z`) and the escapes above;
- anchors `^` and `$`;
- groups `(...)` (capturing) and `(?:...)` (non-capturing), alternation `|`;
- quantifiers `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`, each optionally lazy (`*?`, `+?`, ...).

Anything else is rejected with an error that says what and where, so a bad config pattern fails
loudly instead of silently matching nothing.
-/

namespace Proofmap.Regex

inductive ClassItem where
  | single (c : Char)
  | range (lo hi : Char)
  | space | notSpace | digit | notDigit | word | notWord
  deriving Repr, Inhabited

inductive Node where
  | lit (c : Char)
  | any
  | cls (negated : Bool) (items : Array ClassItem)
  | bol
  | eol
  /-- `index` is `none` for a non-capturing group. -/
  | group (index : Option Nat) (alternatives : Array (Array Node))
  | rep (node : Node) (min : Nat) (max : Option Nat) (lazy : Bool)
  deriving Repr, Inhabited

structure Regex where
  source : String
  root : Array (Array Node)
  groups : Nat
  deriving Inhabited

private def isWordChar (c : Char) : Bool := c.isAlphanum || c == '_'

private def ClassItem.matches (c : Char) : ClassItem → Bool
  | .single d => c == d
  | .range lo hi => lo ≤ c && c ≤ hi
  | .space => c.isWhitespace
  | .notSpace => !c.isWhitespace
  | .digit => c.isDigit
  | .notDigit => !c.isDigit
  | .word => isWordChar c
  | .notWord => !isWordChar c

/-! ## Parser -/

private structure P where
  chars : Array Char
  pos : Nat := 0
  groups : Nat := 0

private abbrev PM := StateT P (Except String)

private def peek? : PM (Option Char) := do
  let s ← get
  return s.chars[s.pos]?

private def advance : PM Unit := modify fun s => { s with pos := s.pos + 1 }

private def fail (msg : String) : PM α := do
  let s ← get
  throw s!"{msg} at position {s.pos + 1}"

private def next : PM Char := do
  match ← peek? with
  | some c => advance; return c
  | none => fail "unexpected end of pattern"

private def escapeItem (c : Char) : PM ClassItem :=
  match c with
  | 's' => pure .space | 'S' => pure .notSpace
  | 'd' => pure .digit | 'D' => pure .notDigit
  | 'w' => pure .word | 'W' => pure .notWord
  | 't' => pure (.single '\t') | 'n' => pure (.single '\n')
  | c => if c.isAlphanum then fail s!"unsupported escape '\\{c}'" else pure (.single c)

private def parseNat : PM (Option Nat) := do
  let mut n : Option Nat := none
  repeat
    match ← peek? with
    | some c => if c.isDigit then advance; n := some ((n.getD 0) * 10 + (c.toNat - '0'.toNat)) else break
    | none => break
  return n

private def parseClass : PM Node := do
  -- The opening `[` has been consumed.
  let negated ← do
    if (← peek?) == some '^' then advance; pure true else pure false
  let mut items : Array ClassItem := #[]
  let mut first := true
  repeat
    let c ← next
    if c == ']' && !first then break
    first := false
    let item ← if c == '\\' then escapeItem (← next) else pure (.single c)
    -- A range `a-z` (a `-` before `]` is a literal).
    if let .single lo := item then
      if (← peek?) == some '-' then
        let s ← get
        if s.chars[s.pos + 1]? != some ']' && s.chars[s.pos + 1]?.isSome then
          advance
          let hc ← next
          let hi ← if hc == '\\' then escapeItem (← next) else pure (.single hc)
          match hi with
          | .single h => items := items.push (.range lo h); continue
          | _ => fail "invalid range in character class"
    items := items.push item
  return .cls negated items

mutual
  private partial def parseAlternatives : PM (Array (Array Node)) := do
    let mut alts := #[← parseSequence]
    while (← peek?) == some '|' do
      advance
      alts := alts.push (← parseSequence)
    return alts

  private partial def parseSequence : PM (Array Node) := do
    let mut seq : Array Node := #[]
    repeat
      match ← peek? with
      | none | some '|' | some ')' => break
      | some _ =>
        let atom ← parseAtom
        seq := seq.push (← parseQuantifier atom)
    return seq

  private partial def parseAtom : PM Node := do
    let c ← next
    match c with
    | '.' => return .any
    | '^' => return .bol
    | '$' => return .eol
    | '[' => parseClass
    | '\\' =>
      match ← escapeItem (← next) with
      | .single d => return .lit d
      | item => return .cls false #[item]
    | '(' =>
      let index ← do
        let s ← get
        if s.chars[s.pos]? == some '?' && s.chars[s.pos + 1]? == some ':' then
          advance; advance; pure none
        else
          set { s with groups := s.groups + 1 }
          pure (some (s.groups + 1))
      let alts ← parseAlternatives
      if (← next) != ')' then fail "expected ')'"
      return .group index alts
    | '*' | '+' | '?' | '{' => fail s!"nothing to repeat before '{c}'"
    | ')' => fail "unmatched ')'"
    | c => return .lit c

  private partial def parseQuantifier (atom : Node) : PM Node := do
    let bounds ← match ← peek? with
      | some '*' => advance; pure (some (0, none))
      | some '+' => advance; pure (some (1, none))
      | some '?' => advance; pure (some (0, some 1))
      | some '{' =>
        advance
        let some lo ← parseNat | fail "expected a number after '{'"
        if (← peek?) == some ',' then
          advance
          let hi ← parseNat
          if (← next) != '}' then fail "expected '}'"
          pure (some (lo, hi))
        else
          if (← next) != '}' then fail "expected '}'"
          pure (some (lo, some lo))
      | _ => pure none
    match bounds with
    | none => return atom
    | some (lo, hi) =>
      let lazy ← do
        if (← peek?) == some '?' then advance; pure true else pure false
      return .rep atom lo hi lazy
end

def compile (pattern : String) : Except String Regex := do
  let (alts, s) ← (parseAlternatives : PM _).run { chars := pattern.toList.toArray }
  if s.pos < s.chars.size then
    throw s!"unexpected '{s.chars[s.pos]!}' at position {s.pos + 1}"
  return { source := pattern, root := alts, groups := s.groups }

/-! ## Matcher (backtracking, continuation-passing) -/

abbrev Captures := Array (Option (Nat × Nat))

mutual
  private partial def matchSeq (s : Array Char) (nodes : List Node) (i : Nat) (caps : Captures)
      (k : Nat → Captures → Option Captures) : Option Captures :=
    match nodes with
    | [] => k i caps
    | n :: rest => matchNode s n i caps fun j c => matchSeq s rest j c k

  private partial def matchNode (s : Array Char) (n : Node) (i : Nat) (caps : Captures)
      (k : Nat → Captures → Option Captures) : Option Captures :=
    match n with
    | .lit c => if s[i]? == some c then k (i + 1) caps else none
    | .any => match s[i]? with
      | some c => if c != '\n' then k (i + 1) caps else none
      | none => none
    | .cls neg items => match s[i]? with
      | some c => if items.any (·.matches c) != neg then k (i + 1) caps else none
      | none => none
    | .bol => if i == 0 then k i caps else none
    | .eol => if i == s.size then k i caps else none
    | .group idx alts =>
      alts.findSome? fun alt => matchSeq s alt.toList i caps fun j c =>
        k j (match idx with | some g => c.set! g (some (i, j)) | none => c)
    | .rep node lo hi lazy => matchRep s node lo hi lazy 0 i caps k

  private partial def matchRep (s : Array Char) (node : Node) (lo : Nat) (hi : Option Nat) (lazy : Bool)
      (count : Nat) (i : Nat) (caps : Captures) (k : Nat → Captures → Option Captures) : Option Captures :=
    let canStop := count ≥ lo
    let canMore := hi.all (count < ·)
    let more : Unit → Option Captures := fun _ =>
      if canMore then
        matchNode s node i caps fun j c =>
          -- An empty iteration cannot make progress; stop it to avoid looping forever.
          if j == i then none else matchRep s node lo hi lazy (count + 1) j c k
      else none
    let stop : Unit → Option Captures := fun _ => if canStop then k i caps else none
    if lazy then (stop ()).orElse more else (more ()).orElse stop
end

/-- Search for the first match anywhere in `text` (anchors make it a full-line match).
Returns the capture groups, with group 0 the whole match. -/
def Regex.find? (r : Regex) (text : String) : Option (Array (Option String)) := do
  let s := text.toList.toArray
  let caps0 : Captures := Array.replicate (r.groups + 1) none
  let found ← (List.range (s.size + 1)).findSome? fun start =>
    matchSeq s [.group none r.root] start caps0 fun j c => some (c.set! 0 (some (start, j)))
  return found.map fun g? => g?.map fun (a, b) => String.ofList (s.extract a b).toList

def Regex.matches (r : Regex) (text : String) : Bool := (r.find? text).isSome

end Proofmap.Regex
