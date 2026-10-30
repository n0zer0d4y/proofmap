/-
API check: every Lean API the extractor relies on
must resolve on every required toolchain. Compile with `lean test/api/ApiCheck.lean`
under each toolchain. The socket API moved between versions and is checked in
`ServeCheck_Async.lean` (toolchains that ship `Std.Async.TCP`) and
`ServeCheck_Internal.lean` (older ones, such as v4.29.0).
-/
import Lean
import Lake.Toml

open Lean Elab Meta

-- Extraction
#check @Lean.collectAxioms
#check @Lean.findDocString?
#check @Lean.findDeclarationRanges?
#check @Lean.getModuleDoc?
#check @Lean.isAuxRecursor
#check @Lean.Meta.isMatcher
#check @Lean.Meta.isInstance
#check @Lean.isStructure
#check @Lean.Name.isInternalDetail
#check @Lean.Linter.isDeprecated
#check @Lean.Expr.getUsedConstants
#check @Lean.PrettyPrinter.ppSignature
#check @Lean.Environment.getModuleIdxFor?

-- Walkthrough
#check @Lean.Elab.processHeader
#check @Lean.Elab.IO.processCommands
#check @Lean.Elab.ContextInfo.ppGoals
#check @Lean.Elab.TacticInfo.goalsBefore
#check @Lean.Elab.TacticInfo.goalsAfter

-- Packaging and config
def includeStrProbe : String := include_str "probe.txt"
#guard includeStrProbe == "include_str probe\n"
#check @Lake.Toml.loadToml
