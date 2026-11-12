import Std.Data.HashMap
import Proofmap.Source.Lexer
import Proofmap.Source.Regex
import Std.Data.HashSet

/-!
# Leading comments

The leading comment of a declaration is the plain comment written just above it. Starting from
the line above the declaration (whose range already includes its docstring and modifiers), the
search moves upward through comment lines and stops at:

- a line with code, or a comment that trails code on its line;
- a doc comment or module doc (they belong to something else);
- a divider comment (a section heading, not a description of the declaration);
- two consecutive blank lines (one blank line between comment and declaration is allowed).
-/

namespace Proofmap.Source

open Proofmap.Regex

/-- Characters used to draw dividers and frames in comments. -/
private def isDecoration (c : Char) : Bool :=
  c == '─' || c == '━' || c == '=' || c == '#' || c == '*' || c == '-' || c == '═' || c == '~'

/-- Strip a run of two or more decoration characters from both ends of a line. A single
character is kept, so Markdown such as `- item` or `*emphasis*` survives. -/
private def stripDecoration (line : String) : String :=
  let cs := line.trimAscii.toString.toList
  let lead := (cs.takeWhile isDecoration).length
  let cs := if lead ≥ 2 then cs.drop lead else cs
  let trail := (cs.reverse.takeWhile isDecoration).length
  let cs := if trail ≥ 2 then cs.take (cs.length - trail) else cs
  (String.ofList cs).trimAscii.toString

/-- Text of a comment token without its delimiters, one entry per line. Decoration is stripped
from plain comments; module docs are Markdown, so they are only trimmed (`## Title` must stay). -/
def commentLines (t : Token) : Array String :=
  let raw := match t.kind with
    | .line => (t.text.drop 2).toString
    | _ =>
      let open_ := match t.kind with | .doc | .moduleDoc => 3 | _ => 2
      let body := (t.text.drop open_).toString
      if body.endsWith "-/" then (body.dropEnd 2).toString else body
  let clean : String → String :=
    if t.kind == .moduleDoc then fun l => l.trimAscii.toString else stripDecoration
  (raw.splitOn "\n").toArray.map clean

/-- Join comment lines, dropping empty lines at the start and the end. -/
def joinLines (ls : Array String) : String :=
  let ls := ls.toList.dropWhile (·.isEmpty) |>.reverse |>.dropWhile (·.isEmpty) |>.reverse
  "\n".intercalate ls

/-- The text of a divider comment's title, if the line comment is a divider. -/
def dividerTitle? (dividers : Array Regex) (t : Token) : Option String :=
  if t.kind != .line then none else
  dividers.findSome? fun r => do
    let groups ← r.find? t.text.trimAscii.toString
    -- The title is the last non-empty capture group.
    let titles := (groups.extract 1 groups.size).filterMap id |>.filter (!·.trimAscii.isEmpty)
    let title := (← titles.back?).trimAscii.toString
    -- A frame line such as `-- ====` is decoration, not a heading.
    if title.all isDecoration then none else some title

/-- Comment tokens indexed by each line they cover. -/
def commentsByLine (lx : Lexed) : Std.HashMap Nat Nat := Id.run do
  let mut m : Std.HashMap Nat Nat := {}
  for h : i in [0:lx.tokens.size] do
    let t := lx.tokens[i]
    if t.isComment then
      for l in [t.startLine:t.endLine + 1] do m := m.insert l i
  return m

/-- A heading written as comments: a one-line divider (matching a divider pattern) or a banner
(a frame line, title lines, a frame line), plus the comment lines directly below it without a
blank line, which describe the section rather than the next declaration. -/
structure Heading where
  startLine : Nat
  endLine : Nat
  title : String
  description : Option String
  deriving Repr, Inhabited

/-- A frame line: a line comment made only of three or more decoration characters. -/
private def isFrameLine (t : Token) : Bool :=
  let body := (t.text.drop 2).toString.trimAscii.toString
  t.kind == .line && body.length ≥ 3 && body.all isDecoration

/-- All comment headings of a file, in order. Banner detection can be turned off. -/
def headings (lx : Lexed) (byLine : Std.HashMap Nat Nat) (dividers : Array Regex) (banners : Bool := true) :
    Array Heading := Id.run do
  -- A line comment alone on its line, at line `l`.
  let lineComment? (l : Nat) : Option Token := do
    let t := lx.tokens[← byLine[l]?]!
    if t.kind == .line && !(lx.hasCode[l]?.getD false) then some t else none
  let n := lx.lines.size
  let mut out : Array Heading := #[]
  let mut l := 1
  while l ≤ n do
    let some t := lineComment? l | l := l + 1; continue
    -- The title and the line where the heading proper ends.
    let found : Option (String × Nat × Array String) :=
      match dividerTitle? dividers t with
      | some title => some (title, l, #[])
      | none =>
        if banners && isFrameLine t then Id.run do
          -- Look for the closing frame line within the same run of comment lines.
          let mut k := l + 1
          let mut inner : Array String := #[]
          while k ≤ n do
            match lineComment? k with
            | none => return none
            | some u =>
              if isFrameLine u then
                let texts := inner.filter (!·.isEmpty)
                return texts[0]?.map fun title => (title, k, texts.extract 1 texts.size)
              inner := inner.push (joinLines (commentLines u))
              k := k + 1
          return none
        else none
    match found with
    | none => l := l + 1
    | some (title, stop, inner) =>
      -- Comment lines directly below (no blank line) describe the section, up to the next heading.
      let mut k := stop + 1
      let mut desc := inner
      while k ≤ n do
        match lineComment? k with
        | some u =>
          if (dividerTitle? dividers u).isSome || (banners && isFrameLine u) then break
          desc := desc.push (joinLines (commentLines u))
          k := k + 1
        | none => break
      let text := joinLines desc
      out := out.push { startLine := l, endLine := k - 1, title
                        description := if text.isEmpty then none else some text }
      l := k
  return out

/-- Lines that belong to a heading (title, frames and description). -/
def headingLines (hs : Array Heading) : Std.HashSet Nat :=
  hs.foldl (init := {}) fun s h => (List.range (h.endLine - h.startLine + 1)).foldl (fun s k => s.insert (h.startLine + k)) s

/-- Command prefixes that apply to the next declaration only (`... in`). -/
private def commandPrefix : Regex :=
  (compile "^(?:include|omit|open|set_option|variable|unseal)\\s.*\\sin$").toOption.get!

/-- The leading comment of a declaration starting at `startLine`, if any. `structural` holds the
lines of comment headings (see `headings`), which are never part of a leading comment. -/
def leadingComment? (lx : Lexed) (byLine : Std.HashMap Nat Nat) (structural : Std.HashSet Nat)
    (startLine : Nat) : Option String := Id.run do
  let mut l := startLine - 1
  let mut blanks := 0
  let mut found : Array Token := #[]
  while l ≥ 1 do
    if structural.contains l then break
    match byLine[l]? with
    | none =>
      if lx.hasCode[l]?.getD false then
        -- A one-shot command prefix (`include h in`, `omit [Inst] in`, `open Foo in`, ...)
        -- belongs to the declaration below it; look past it.
        if (commandPrefix.find? ((lx.lines[l - 1]?).getD "").trimAscii.toString).isSome then
          l := l - 1
          continue
        break
      blanks := blanks + 1
      if blanks ≥ 2 then break
      l := l - 1
    | some ti =>
      let t := lx.tokens[ti]!
      let isDoc := t.kind == .doc || t.kind == .moduleDoc
      let trailsCode := lx.hasCode[t.startLine]?.getD false
      if isDoc || trailsCode then break
      found := found.push t
      blanks := 0
      l := t.startLine - 1
  if found.isEmpty then return none
  let text := joinLines (found.reverse.flatMap commentLines)
  return if text.isEmpty then none else some text

/-- A Markdown heading line (`## Title`): its level (the number of `#` marks) and its words;
`none` for other lines (`#eval` is not a heading: the marks must be followed by a space or end
the line). -/
def heading? (line : String) : Option (Nat × String) :=
  let cs := line.toList
  let n := (cs.takeWhile (· == '#')).length
  let rest := cs.drop n
  if n == 0 || n > 6 then none
  else match rest with
    | [] => some (n, "")
    | c :: _ => if c == ' ' || c == '\t' then some (n, String.ofList (rest.dropWhile (· == ' '))) else none

/-- The words of a Markdown heading line, without its `#` marks. -/
def headingText? (line : String) : Option String := (heading? line).map (·.2)

private def isBlank (c : Char) : Bool := c == ' ' || c == '\t'

/-- The text of a Markdown list item (`* text`, `- text`, `+ text`, `1. text`), else `none`. -/
private def bulletText? (line : List Char) : Option (List Char) :=
  match line.dropWhile isBlank with
  | c :: s :: r => if (c == '*' || c == '-' || c == '+') && isBlank s then some r else
    let cs := line.dropWhile isBlank
    let ds := cs.takeWhile Char.isDigit
    match cs.drop ds.length with
    | p :: s' :: r' => if !ds.isEmpty && (p == '.' || p == ')') && isBlank s' then some r' else none
    | _ => none
  | _ => none

/-- The backticked names a list item starts with: "`a`, `b` and `c`: …" gives `a`, `b`, `c`.
Names later in the description are not read; a backticked expression (with spaces) ends it. -/
private partial def leadingNames (cs : List Char) (acc : Array String := #[]) : Array String :=
  let cs := cs.dropWhile isBlank
  let cs := if acc.isEmpty then cs else match cs with
    | ',' :: r | '/' :: r | '&' :: r => r.dropWhile isBlank
    | 'a' :: 'n' :: 'd' :: s :: r | 'o' :: 'r' :: s :: r => if isBlank s then r.dropWhile isBlank else cs
    | _ => cs
  match cs with
  | '`' :: r =>
    let tok := r.takeWhile (· != '`')
    if tok.length == r.length then acc  -- no closing backtick
    else
      let name := match tok with | '@' :: t => t | t => t
      if name.isEmpty || name.any isBlank then acc
      else leadingNames (r.drop (tok.length + 1)) (acc.push (String.ofList name))
  | _ => acc

/-- Whether a heading names Mathlib's main-results section of a module docstring. -/
def isMainStatementsHeading (title : String) : Bool :=
  let t := title.toLower
  ["main statements", "main results", "main theorems"].any fun p => t.startsWith p

/-- The names a module docstring lists as its main results: a `## Main statements` section, the
optional second-level section of Mathlib's documentation style
(https://mathlib.org/contribute/doc.html), or `Main results` / `Main theorems`, which many Mathlib
files use instead (level 2 or deeper, so a file titled `# Main results` is not one), whose list
items start with the result's name in backticks. The section ends at the next heading of the
same or a higher level. -/
def mainStatementNames (doc : String) : Array String := Id.run do
  let mut out : Array String := #[]
  let mut level : Option Nat := none
  for raw in doc.splitOn "\n" do
    let line := (raw.toList.filter (· != '\r')).dropWhile isBlank
    match heading? (String.ofList line) with
    | some (n, title) =>
      if level.any (n ≤ ·) then level := none
      if n ≥ 2 && isMainStatementsHeading title then level := some n
    | none =>
      if level.isSome then
        if let some item := bulletText? line then
          for name in leadingNames item do
            if !out.contains name then out := out.push name
  return out

/-- The first paragraph of a Markdown text (up to a blank line or a heading), trimmed. Headings
before it are titles, not a summary, so they are skipped; a text with only a heading gives the
heading's words. -/
def firstParagraph (text : String) : String :=
  go ((text.splitOn "\n").map (·.trimAscii.toString)) none
where
  go : List String → Option String → String
  | [], heading => heading.getD ""
  | l :: rest, heading =>
    if l.isEmpty then go rest heading
    else match headingText? l with
      | some t => go rest (heading <|> (if t.isEmpty then none else some t))
      | none => " ".intercalate (l :: rest.takeWhile fun x => !x.isEmpty && (headingText? x).isNone)

/-- The commands that name a declaration on a line of their own: `#print axioms X`, `#check X`
(also `#check @X`) and `#eval X …`, as `(command, name, line)` with `command` one of
`print axioms`, `check`, `eval` and `line` 1-based. Only lines with code count (a command inside
a comment is not run), and only a plain name (`#check (f : T)` names no single declaration). -/
def checkCommands (lx : Lexed) : Array (String × String × Nat) := Id.run do
  let mut out := #[]
  for h : i in [0:lx.lines.size] do
    if !(lx.hasCode[i + 1]?.getD false) then continue
    let cs := lx.lines[i].toList.dropWhile isBlank
    let found : Option (String × List Char) :=
      match cs with
      | '#' :: 'p' :: 'r' :: 'i' :: 'n' :: 't' :: s :: r =>
        if isBlank s then
          match r.dropWhile isBlank with
          | 'a' :: 'x' :: 'i' :: 'o' :: 'm' :: 's' :: s' :: r' => if isBlank s' then some ("print axioms", r') else none
          | _ => none
        else none
      | '#' :: 'c' :: 'h' :: 'e' :: 'c' :: 'k' :: s :: r => if isBlank s then some ("check", r) else none
      | '#' :: 'e' :: 'v' :: 'a' :: 'l' :: s :: r => if isBlank s then some ("eval", r) else none
      | _ => none
    let some (command, rest) := found | continue
    let rest := match rest.dropWhile isBlank with | '@' :: r => r | r => r
    let name := rest.takeWhile fun c => !isBlank c && c != '(' && c != ')' && c != ':' && c != ','
    -- A plain name: starts like an identifier, and is not a literal or an expression.
    match name with
    | c :: _ => if c.isAlpha || c == '_' || c.val ≥ 0x80 then out := out.push (command, String.ofList name, i + 1)
    | [] => pure ()
  return out

end Proofmap.Source
