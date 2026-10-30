/-!
# The viewer template

`assets/viewer.html` is the single-file viewer, built by `viewer/` (`npm run build` copies it
here). It is embedded into the executable with `include_str`, so nothing has to be found or
installed at run time. Its data placeholder is replaced by the project's JSON.
-/

namespace Proofmap.Package

/-- The prebuilt viewer, embedded at compile time. -/
def template : String := include_str "../../assets/viewer.html"

/-- The placeholder inside `<script id="proofmap-data" type="application/json">`. -/
def placeholder : String := "/*PROOFMAP_DATA*/"

/-- Make JSON safe inside a script element: every `<` becomes the six-character escape backslash-u003c (JSON has
`<` only inside strings, so this is lossless and neither a closing script tag nor a comment
opener can appear), and U+2028/U+2029 are escaped too. The backslash is built from its code so
the escapes cannot be rewritten by any tool that edits this file. Mirrors
`viewer/scripts/inject.mjs`. -/
def escapeJson (json : String) : String :=
  let bs := String.singleton (Char.ofNat 92)
  json.foldl (init := "") fun acc c =>
    if c == '<' then acc ++ bs ++ "u003c"
    else if c.val == 0x2028 then acc ++ bs ++ "u2028"
    else if c.val == 0x2029 then acc ++ bs ++ "u2029"
    else acc.push c

/-- The template with `json` in place of the placeholder. -/
def inject (json : String) (tmpl : String := template) : Except String String :=
  match tmpl.splitOn placeholder with
  | [before, after] => .ok (before ++ escapeJson json ++ after)
  | parts => .error s!"viewer template must contain the data placeholder exactly once (found {parts.length - 1})"

end Proofmap.Package
