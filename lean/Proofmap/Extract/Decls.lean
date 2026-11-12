import Lean
import Proofmap.Schema

/-!
# Declaration kinds and flags

Noise flags hide generated declarations by default; they are always kept in the data.
Facts checked on the fixture (see `test/fixture/expected/manifest.json`):
- private names (`_private.<Module>.0.<Name>`) report `isInternalDetail`, so the internal
  check runs on the user-facing name;
- a `partial def` compiles to an `opaque` whose code is `<name>._unsafe_rec`; recursive
  definitions (structural, well-founded, derived `DecidableEq`) get a partial `_unsafe_rec` helper
  too, but stay checked definitions, so only the opaque one is partial;
- newer toolchains generate `ctorIdx`, `ctorElim`, `ctorElimType` and `<ctor>.elim`, which are
  not internal details, so they are named here. Suffix rules only apply when the prefix really
  is a constructor or inductive type, so user theorems such as `Or.elim` are not noise.
-/

namespace Proofmap.Extract

open Lean Meta
open Proofmap.Schema (DeclKind)

/-- Generated declarations named `<inductive>.<suffix>`. -/
def inductiveSuffixes : List String :=
  ["casesOn", "recOn", "below", "brecOn", "binductionOn", "ibelow", "noConfusion",
   "noConfusionType", "ctorIdx", "toCtorIdx", "ctorElim", "ctorElimType"]

/-- Generated declarations named `<constructor>.<suffix>`. -/
def ctorSuffixes : List String :=
  ["elim", "inj", "injEq", "sizeOf_spec", "noConfusion"]

private def isEquationSuffix (s : String) : Bool :=
  s == "eq_def" || s == "eq_unfold" ||
    (s.startsWith "eq_" && (s.drop 3).toString.all Char.isDigit && (s.drop 3).toString != "")

private def lastString? : Name → Option String
  | .str _ s => some s
  | _ => none

def declKind (env : Environment) (n : Name) (ci : ConstantInfo) : DeclKind :=
  if isInstanceCore env n then .«instance» else
  match ci with
  | .thmInfo _ => .«theorem»
  | .defnInfo _ => if getReducibilityStatusCore env n == .reducible then .«abbrev» else .«def»
  | .axiomInfo _ => .«axiom»
  | .opaqueInfo _ => .«opaque»
  | .inductInfo _ => if isStructure env n then .«structure» else .«inductive»
  | .ctorInfo _ => .ctor
  | .recInfo _ => .recursor
  | .quotInfo _ => .quot

/-- Noise flags (`noise:*`). Empty means the declaration is shown by default. -/
def noiseFlags (env : Environment) (n : Name) (ci : ConstantInfo) : Array String := Id.run do
  let mut fs : Array String := #[]
  let parent := n.getPrefix
  -- An instance, or a part of one: `deriving` writes helpers such as `instDecidableEqT.decEq` and
  -- `instReprT.repr` inside the instance's namespace, with the `deriving` clause as their source.
  if isInstanceCore env n || isInstanceCore env parent then fs := fs.push "noise:instance"
  if isMatcherCore env n then fs := fs.push "noise:matcher"
  let suffix := lastString? n
  let parentIsInductive := match env.find? parent with | some (.inductInfo _) => true | _ => false
  let parentIsCtor := match env.find? parent with | some (.ctorInfo _) => true | _ => false
  let isAux :=
    isAuxRecursor env n || isNoConfusion env n || ci matches .recInfo _ ||
    (parentIsInductive && suffix.any (inductiveSuffixes.contains ·)) ||
    (parentIsCtor && suffix.any (ctorSuffixes.contains ·))
  if isAux then fs := fs.push "noise:aux"
  if (env.getProjectionFnInfo? n).isSome then fs := fs.push "noise:projection"
  if let .ctorInfo v := ci then
    if isStructure env v.induct then fs := fs.push "noise:ctor"
  if suffix.any isEquationSuffix then fs := fs.push "noise:equation"
  if fs.isEmpty && (privateToUserName n).isInternalDetail then fs := fs.push "noise:internal"
  return fs

/-- A project declaration with no source range is one Lean generated: match splitters, congruence
lemmas (`congr_eq_N`, `congr_simp`), helpers made by `deriving` (`enumList`, `ofNat`, `proxyType`)
and structural recursion (`brecOn.go`). Their names change between Lean versions, so they are
recognised by the missing range rather than by name. -/
def generatedFlag (noise : Array String) (hasRange : Bool) : Array String :=
  if noise.isEmpty && !hasRange then #["noise:generated"] else noise

/-- Informational flags: `private`, `deprecated`, `unsafe`, `partial`, `simp`. -/
def infoFlags (env : Environment) (n : Name) (ci : ConstantInfo) : Array String := Id.run do
  let mut fs : Array String := #[]
  if isPrivateName n then fs := fs.push "private"
  if Linter.isDeprecated env n then fs := fs.push "deprecated"
  if ci.isUnsafe then fs := fs.push "unsafe"
  -- A `partial def` has no checked definition: Lean adds it as an opaque constant whose compiled
  -- code is `<name>._unsafe_rec`. Structural and well-founded recursion also get an `_unsafe_rec`
  -- helper (itself partial), but keep a checked definition, so they are not partial.
  -- `@[implemented_by]` only replaces the compiled code of a checked definition: not partial.
  let isPartial := ci.isPartial || (ci matches .opaqueInfo _ && env.contains (n.str "_unsafe_rec"))
  if isPartial then fs := fs.push "partial"
  -- `@[simp]`: a lemma the simp set rewrites with, or a definition it unfolds. Kept even when
  -- nothing in the project uses it: the simp tactic may, in projects that build on this one.
  let simpSet := Meta.simpExtension.getState env
  if simpSet.isLemma (.decl n) || simpSet.isDeclToUnfold n then fs := fs.push "simp"
  return fs

def isNoise (flags : Array String) : Bool :=
  flags.any (·.startsWith "noise:")

end Proofmap.Extract
