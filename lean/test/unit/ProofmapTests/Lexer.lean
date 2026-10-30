import Proofmap.Source.Lexer
import ProofmapTests.Harness

/-! Lexer tests. -/

namespace ProofmapTests

open Proofmap.Source

private def kinds (src : String) : Array TokenKind := (lex src).tokens.map (·.kind)
private def texts (src : String) : Array String := (lex src).tokens.map (·.text)

def lexerTests : TestM Unit := do
  -- Nested block comments: one token.
  checkEq "nested block comment" (texts "a /- x /- y -/ z -/ b") #["/- x /- y -/ z -/"]
  checkEq "nested block comment kind" (kinds "/- /- -/ -/") #[.block]
  -- `--` inside a string is not a comment.
  checkEq "-- in string" (kinds "def s := \"--\" -- real") #[.string, .line]
  checkEq "-- in string text" (texts "def s := \"--\" -- real") #["\"--\"", "-- real"]
  -- `-/` and `/-` inside a string do not open or close comments.
  checkEq "-/ in string" (kinds "def s := \"-/ /- x\"\n-- after") #[.string, .line]
  -- A string with an escaped quote.
  checkEq "escaped quote" (texts "\"a\\\"--b\" -- c") #["\"a\\\"--b\"", "-- c"]
  -- Char literals: '-' and '\'' are not comment starts or string ends.
  checkEq "char literal '-'" (kinds "def c := '-' -- x") #[.char, .line]
  checkEq "char literal escaped quote" (texts "def c := '\\'' -- x") #["'\\''", "-- x"]
  checkEq "char literal unicode escape" (kinds "'\\u{2028}' -- x") #[.char, .line]
  -- A prime in a name is not a char literal.
  checkEq "prime in name" (kinds "theorem h' : x' = y' := rfl -- c") #[.line]
  checkEq "double prime name then char" (kinds "def f'' := 'a'") #[.char]
  -- Doc comments and module docs.
  checkEq "doc comment" (kinds "/-- doc -/ def x := 1") #[.doc]
  checkEq "module doc" (kinds "/-! # Title -/") #[.moduleDoc]
  checkEq "/--/ is a plain block comment" (kinds "/--/ def x := 1") #[.block]
  -- Inside a block comment, strings are not special (as in Lean): the comment ends at the
  -- first closer, and the quote after it starts a string.
  checkEq "string inside block comment" (texts "/- \"-/\" x") #["/- \"-/", "\" x"]
  -- Raw strings.
  checkEq "raw string" (kinds "r\"a--b\" -- c") #[.string, .line]
  checkEq "raw string with hashes" (texts "r#\"a\"--\"#") #["r#\"a\"--\"#"]
  -- Guillemet names may contain comment-like text.
  checkEq "guillemet name" (kinds "def «a--b» := 1 -- c") #[.line]
  -- Positions and code lines.
  let l := lex "def a := 1\n-- only a comment\n\n/- block\nstill -/ def b := 2"
  checkEq "comment line has no code" l.hasCode[2]! false
  checkEq "code line" l.hasCode[1]! true
  checkEq "blank line" l.hasCode[3]! false
  checkEq "code after block comment" l.hasCode[5]! true
  checkEq "line comment position" ((l.tokens[0]!).startLine, (l.tokens[0]!).startCol) (2, 0)
  checkEq "block end position" ((l.tokens[1]!).endLine, (l.tokens[1]!).endCol) (5, 8)
  -- Unterminated comment runs to the end of the file.
  checkEq "unterminated block" (kinds "/- open") #[.block]

end ProofmapTests
