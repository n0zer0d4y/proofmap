import Proofmap.Schema
import Proofmap.Source.Lexer
import Proofmap.Source.Comments
import Proofmap.Source.Regex

/-!
# Section tree of a source file

Sections come from three sources, merged in document order:

1. headings (`#`, `##`, ...) in module docs: nested by level; the text under a heading becomes
   its description, and text before the first heading of a module doc describes the section
   that is open at that point (if any);
2. divider comments matching the configured patterns: siblings, each closing the previous
   divider in the same block;
3. `namespace X` / `section X` ... `end X` blocks. Unnamed `section`s (also `noncomputable
   section`) and `mutual` blocks are tracked so that `end` matches, but are not shown.

A heading or divider never closes an enclosing `namespace`/`section` block, and `end X` closes
everything opened inside the block.
-/

namespace Proofmap.Source

open Proofmap.Schema (Section SectionSource Range Position)
open Proofmap.Regex

/-- Default divider patterns. -/
def defaultDividerPatterns : Array String :=
  #["^--\\s*[─━=#*-]{2,}\\s*(.+?)\\s*[─━=#*-]*$", "^-- (§|#)\\s*(.+)$"]

private inductive Kind where
  | heading (level : Nat)
  | divider
  /-- A `namespace` or `section` block; `shown` is false for unnamed sections and `mutual`. -/
  | block (keyword : String) (name : String) (shown : Bool)
  deriving Inhabited

private structure Open where
  kind : Kind
  title : String
  source : SectionSource
  description : Option String
  startLine : Nat
  children : Array Section := #[]
  deriving Inhabited

private inductive Event where
  | heading (line level : Nat) (title : String) (description : Option String)
  | preamble (line : Nat) (text : String)
  | divider (line : Nat) (title : String) (description : Option String)
  | begin (line : Nat) (keyword name : String)
  | finish (line : Nat) (name : String)

private def Event.line : Event → Nat
  | .heading l .. | .preamble l .. | .divider l .. | .begin l .. | .finish l .. => l

/-- Headings and descriptions inside one module doc. Fenced code blocks are skipped. -/
private def docEvents (t : Token) : Array Event := Id.run do
  let ls := commentLines t
  let mut out : Array Event := #[]
  let mut inFence := false
  let mut current : Option (Nat × Nat × String) := none  -- (line, level, title)
  let mut body : Array String := #[]
  let flush (current : Option (Nat × Nat × String)) (body : Array String) (out : Array Event) : Array Event :=
    let text := joinLines body
    let desc := if text.isEmpty then none else some text
    match current with
    | some (l, lv, title) => out.push (.heading l lv title desc)
    | none => match desc with
      | some d => out.push (.preamble t.startLine d)
      | none => out
  for h : k in [0:ls.size] do
    let line := ls[k]
    if line.startsWith "```" then inFence := !inFence
    let hashes := (line.toList.takeWhile (· == '#')).length
    if !inFence && hashes ≥ 1 && hashes ≤ 6 && (line.drop hashes).toString.startsWith " " then
      out := flush current body out
      current := some (t.startLine + k, hashes, (line.drop hashes).toString.trimAscii.toString)
      body := #[]
    else
      body := body.push line
  return flush current body out

/-- The code of a line with comments blanked out, for recognizing block commands. -/
private def codeOnly (lx : Lexed) (byLine : Std.HashMap Nat Nat) (l : Nat) : String :=
  match byLine[l]? with
  | none => (lx.lines[l - 1]?).getD ""
  | some ti =>
    let t := lx.tokens[ti]!
    let cs := ((lx.lines[l - 1]?).getD "").toList
    let a := if t.startLine == l then t.startCol else 0
    let b := if t.endLine == l then t.endCol else cs.length
    String.ofList (cs.take a ++ List.replicate (b - a) ' ' ++ cs.drop b)

private def blockRegexes : Array Regex :=
  #["^namespace\\s+(\\S+)\\s*$",
    "^(?:@\\[[^\\]]*\\]\\s*)?(?:(?:noncomputable|public|private)\\s+)*section(?:\\s+(\\S+))?\\s*$",
    "^mutual\\s*$",
    "^end(?:\\s+(\\S+))?\\s*$"].map fun p => (compile p).toOption.get!

private def blockEvent? (l : Nat) (code : String) : Option Event := do
  let code := code.trimAscii.toString
  if code.isEmpty then none else
  if let some g := blockRegexes[0]!.find? code then return .begin l "namespace" (g[1]!.getD "")
  if let some g := blockRegexes[1]!.find? code then return .begin l "section" (g[1]!.getD "")
  if (blockRegexes[2]!.find? code).isSome then return .begin l "mutual" ""
  if let some g := blockRegexes[3]!.find? code then return .finish l (g[1]!.getD "")
  none

private def isScope : Kind → Bool
  | .block .. => true
  | _ => false

/-- Close the top section at `endLine` and attach it to its parent. -/
private def closeTop (stack : Array Open) (endLine : Nat) : Array Open :=
  match stack.back? with
  | none => stack
  | some top =>
    let stack := stack.pop
    let attach (parent : Open) : Open :=
      match top.kind with
      | .block _ _ false => { parent with children := parent.children ++ top.children }
      | _ =>
        let sec : Section := {
          title := top.title, source := top.source, description := top.description
          range := { start := ⟨top.startLine, 0⟩, stop := ⟨max endLine top.startLine, 0⟩ }
          children := top.children }
        { parent with children := parent.children.push sec }
    match stack.back? with
    | some parent => stack.pop.push (attach parent)
    | none => stack  -- never happens: the root is not closed

/-- The section tree of a file, given its comment headings (see `headings`). -/
def sectionTree (lx : Lexed) (heads : Array Heading) : Array Section := Id.run do
  let byLine := commentsByLine lx
  -- Collect events in document order.
  let mut events : Array Event := #[]
  for t in lx.tokens do
    if t.kind == .moduleDoc then events := events ++ docEvents t
  for h in heads do events := events.push (.divider h.startLine h.title h.description)
  for l in [1:lx.lines.size + 1] do
    if lx.hasCode[l]?.getD false then
      if let some e := blockEvent? l (codeOnly lx byLine l) then events := events.push e
  let ordered := events.qsort fun a b => a.line < b.line
  let last := lx.lines.size
  let root : Open := { kind := .block "root" "" true, title := "", source := .section, description := none, startLine := 1 }
  let mut stack : Array Open := #[root]
  for e in ordered do
    match e with
    | .preamble _ text =>
      if stack.size > 1 then
        let top := stack.back!
        let desc := match top.description with | some d => d ++ "\n\n" ++ text | none => text
        stack := stack.pop.push { top with description := some desc }
    | .heading l level title desc =>
      -- Close headings of the same or deeper level and dividers, inside the current block.
      while stack.size > 1 && (match stack.back!.kind with
          | .heading lv => lv ≥ level | .divider => true | .block .. => false) do
        stack := closeTop stack (l - 1)
      stack := stack.push { kind := .heading level, title, source := .doc, description := desc, startLine := l }
    | .divider l title desc =>
      while stack.size > 1 && (match stack.back!.kind with | .divider => true | _ => false) do
        stack := closeTop stack (l - 1)
      stack := stack.push { kind := .divider, title, source := .divider, description := desc, startLine := l }
    | .begin l keyword name =>
      let shown := keyword != "mutual" && !name.isEmpty
      let source := if keyword == "namespace" then SectionSource.namespace else .section
      stack := stack.push { kind := .block keyword name shown, title := name, source, description := none, startLine := l }
    | .finish l name =>
      -- `end X` closes the innermost matching block and everything opened inside it.
      let target := (List.range (stack.size - 1)).reverse.find? fun k =>
        match stack[k + 1]!.kind with
        -- A bare `end` closes an unnamed `section` or a `mutual` block; `end X` closes `X`.
        | .block _ n _ => n == name
        | _ => false
      if let some k := target then
        while stack.size > k + 2 do stack := closeTop stack l
        stack := closeTop stack l
  while stack.size > 1 do stack := closeTop stack last
  return stack[0]!.children

/-- Index path of the deepest section containing `line`. -/
partial def sectionPath (tree : Array Section) (line : Nat) : Array Nat := Id.run do
  for h : i in [0:tree.size] do
    let s := tree[i]
    if s.range.start.line ≤ line && line ≤ s.range.stop.line then
      return #[i] ++ sectionPath s.children line
  return #[]

/-- The section at an index path. -/
partial def sectionAt? (tree : Array Section) : List Nat → Option Section
  | [] => none
  | [i] => tree[i]?
  | i :: rest => tree[i]? >>= fun s => sectionAt? s.children rest

end Proofmap.Source
