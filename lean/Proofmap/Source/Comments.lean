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

/-- The first paragraph of a Markdown text (up to the first blank line), trimmed. -/
def firstParagraph (text : String) : String :=
  let ls := (text.splitOn "\n").map (·.trimAscii.toString) |>.dropWhile (·.isEmpty)
  " ".intercalate (ls.takeWhile (!·.isEmpty))

end Proofmap.Source
