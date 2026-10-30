/-!
# Comment- and string-aware scanner

Lean keeps docstrings and module docs, but drops plain comments, so proofmap reads them from
the source. This scanner finds every comment and literal in a file:

- line comments (two dashes to the end of the line);
- block comments, which nest: an opener inside a block comment needs its own closer, exactly as
  in Lean (the openers are slash-dash, slash-dash-dash for doc comments and slash-dash-bang for
  module docs; the closer is dash-slash);
- string literals (with escapes), raw strings `r"..."` / `r#"..."#`, char literals `'c'`, and
  guillemet names, so comment delimiters inside them are not mistaken for comments.

A `'` only starts a char literal when it does not follow an identifier character, because `h'`
and `foo''` are names. Inside a block comment only the openers and the closer are special, as in
Lean. Positions are 1-based lines and 0-based columns in code points.

(This text avoids writing the delimiters themselves: Lean nests comments, so an opener in a
comment would need a closer.)
-/

namespace Proofmap.Source

inductive TokenKind where
  | line | block | doc | moduleDoc | string | char
  deriving BEq, Repr, Inhabited

structure Token where
  kind : TokenKind
  startLine : Nat
  startCol : Nat
  endLine : Nat
  endCol : Nat
  /-- The raw source text of the token, delimiters included. -/
  text : String
  deriving Repr, Inhabited

def Token.isComment (t : Token) : Bool :=
  t.kind == .line || t.kind == .block || t.kind == .doc || t.kind == .moduleDoc

structure Lexed where
  tokens : Array Token
  /-- `hasCode[l]` (1-based) says whether line `l` has anything outside comments. -/
  hasCode : Array Bool
  /-- The source lines (without line terminators), `lines[l - 1]` is line `l`. -/
  lines : Array String
  deriving Inhabited

private def isIdentChar (c : Char) : Bool :=
  c.isAlphanum || c == '_' || c == '\'' || c == '!' || c == '?' ||
    -- subscripts and other letter-like Unicode used in Lean names
    (c.val ≥ 0x80 && !c.isWhitespace && c != '«' && c != '»')

private structure S where
  cs : Array Char
  i : Nat := 0
  line : Nat := 1
  col : Nat := 0
  tokens : Array Token := #[]
  codeLines : Array Nat := #[]

private abbrev M := StateM S

private def cur? (k : Nat := 0) : M (Option Char) := do
  let s ← get
  return s.cs[s.i + k]?

private def step : M Unit := modify fun s =>
  match s.cs[s.i]? with
  | some '\n' => { s with i := s.i + 1, line := s.line + 1, col := 0 }
  | some _ => { s with i := s.i + 1, col := s.col + 1 }
  | none => s

private def markCode : M Unit := modify fun s => { s with codeLines := s.codeLines.push s.line }

/-- Consume characters while `p` holds on the current one. -/
private partial def skipWhile (p : Char → Bool) : M Unit := do
  match ← cur? with
  | some c => if p c then step; skipWhile p else pure ()
  | none => pure ()

private def emit (kind : TokenKind) (startI startLine startCol : Nat) : M Unit := modify fun s =>
  let text := String.ofList (s.cs.extract startI s.i).toList
  { s with tokens := s.tokens.push { kind, startLine, startCol, endLine := s.line, endCol := s.col, text } }

/-- The rest of a block comment: openers raise the nesting depth, closers lower it. -/
private partial def blockBody (depth : Nat) : M Unit := do
  match ← cur?, ← cur? 1 with
  | some '/', some '-' => step; step; blockBody (depth + 1)
  | some '-', some '/' => step; step; if depth > 1 then blockBody (depth - 1)
  | some _, _ => step; blockBody depth
  | none, _ => pure ()

private partial def stringBody : M Unit := do
  match ← cur? with
  | some '\\' => step; step; stringBody
  | some '"' => step
  | some _ => step; stringBody
  | none => pure ()

/-- Raw string after `r`: `#`* then `"`, closed by `"` followed by the same number of `#`. -/
private partial def rawStringBody (hashes : Nat) : M Unit := do
  match ← cur? with
  | some '"' =>
    step
    let s ← get
    if (List.range hashes).all fun k => s.cs[s.i + k]? == some '#' then
      for _ in [0:hashes] do step
    else rawStringBody hashes
  | some _ => step; rawStringBody hashes
  | none => pure ()

/-- Length of a char literal starting at the current `'`, if there is one. -/
private def charLiteralLength? : M (Option Nat) := do
  let s ← get
  let at? (k : Nat) := s.cs[s.i + k]?
  match at? 1 with
  | some '\\' =>
    -- Escapes: '\n', '\'', '\\', '\xHH', '\u{H...}'.
    match at? 2 with
    | some 'x' => if at? 5 == some '\'' then return some 6 else return none
    | some 'u' =>
      let close := (List.range 12).find? fun k => at? (3 + k) == some '}'
      match close with
      | some k => if at? (4 + k) == some '\'' then return some (5 + k) else return none
      | none => return none
    | some _ => if at? 3 == some '\'' then return some 4 else return none
    | none => return none
  | some c => if c != '\n' && at? 2 == some '\'' then return some 3 else return none
  | none => return none

private partial def go (prev : Char) : M Unit := do
  let some c ← cur? | return
  let s ← get
  let (i, line, col) := (s.i, s.line, s.col)
  match c, ← cur? 1, ← cur? 2 with
  | '-', some '-', _ =>
    skipWhile (· != '\n')
    emit .line i line col
    go ' '
  | '/', some '-', third =>
    step; step
    let fourth ← cur? 1
    let kind := match third with
      -- slash-dash-dash-slash is a plain block comment, not a doc comment
      | some '-' => if fourth == some '/' then TokenKind.block else .doc
      | some '!' => .moduleDoc
      | _ => .block
    blockBody 1
    emit kind i line col
    go ' '
  | '"', _, _ =>
    markCode; step; stringBody
    emit .string i line col
    go '"'
  | 'r', next, _ =>
    if !isIdentChar prev && (next == some '"' || next == some '#') then
      -- Possibly a raw string: r"...", r#"..."#.
      let st ← get
      let hashes := ((List.range 8).takeWhile fun k => st.cs[st.i + 1 + k]? == some '#').length
      if st.cs[st.i + 1 + hashes]? == some '"' then
        markCode
        for _ in [0:hashes + 2] do step
        rawStringBody hashes
        emit .string i line col
        go '"'
        return
    markCode; step; go 'r'
  | '\'', _, _ =>
    if !isIdentChar prev then
      if let some n ← charLiteralLength? then
        markCode
        for _ in [0:n] do step
        emit .char i line col
        go '\''
        return
    markCode; step; go '\''
  | '«', _, _ =>
    markCode; skipWhile (· != '»'); step; go 'x'
  | c, _, _ =>
    if !c.isWhitespace then markCode
    step; go c

def lex (src : String) : Lexed :=
  let cs := src.toList.toArray
  let ((), s) := (go ' ').run { cs }
  let lines := (src.splitOn "\n").toArray.map fun l => if l.endsWith "\r" then (l.dropEnd 1).toString else l
  let hasCode := s.codeLines.foldl (init := Array.replicate (lines.size + 2) false) fun acc l => acc.set! l true
  { tokens := s.tokens, hasCode, lines }

end Proofmap.Source
