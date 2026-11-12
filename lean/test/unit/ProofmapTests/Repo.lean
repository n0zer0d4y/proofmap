import Proofmap.Repo
import Proofmap.Build
import ProofmapTests.Harness

/-! Repository addresses for source links, and the default page title. -/

namespace ProofmapTests

open Proofmap.Repo

def repoTests : TestM Unit := do
  checkEq "remote: https" (webUrl "https://github.com/me/proj.git") (some "https://github.com/me/proj")
  checkEq "remote: https without .git, trailing slash" (webUrl "https://github.com/me/proj/") (some "https://github.com/me/proj")
  checkEq "remote: credentials are dropped" (webUrl "https://me:tok3n@github.com/me/proj.git") (some "https://github.com/me/proj")
  checkEq "remote: scp-like ssh" (webUrl "git@github.com:me/proj.git") (some "https://github.com/me/proj")
  checkEq "remote: ssh url with port" (webUrl "ssh://git@gitlab.example.org:2222/team/proj.git") (some "https://gitlab.example.org/team/proj")
  checkEq "remote: a local path is not a web address" (webUrl "/srv/git/proj.git") none
  checkEq "remote: a Windows path is not a web address" (webUrl "C:\\repos\\proj") none
  checkEq "citation title, quoted" (citationTitle "cff-version: 1.2.0\ntitle: \"Prime gaps and the sieve\"\nauthors: []") (some "Prime gaps and the sieve")
  checkEq "citation title, nested title ignored" (citationTitle "references:\n  - title: Other\n") none
  checkEq "readme title" (readmeTitle "[![CI](x)](y)\n\n# **Sums** of `squares`\n\n## Usage") (some "Sums of squares")
  checkEq "readme: no level-one heading" (readmeTitle "## Only a subsection\ntext") none
  -- A `#` comment in a code block is not a heading; an HTML heading is.
  checkEq "readme: code blocks are skipped" (readmeTitle "Intro\n```sh\n# Fetch the cache\nlake exe cache get\n```\n\n# Real title") (some "Real title")
  checkEq "readme: an HTML heading counts" (readmeTitle "Note.\n```\nCo-authored-by: x\n```\n\n<h1 align=\"center\">Fermat, formalized</h1>\n\n## Usage") (some "Fermat, formalized")
  checkEq "readme: a tilde fence is skipped too" (readmeTitle "~~~\n# not this\n~~~\n# This") (some "This")
  checkEq "title: a leading slug is dropped" (dropSlug "prime-gaps-lean: four certified results on prime gaps") "Four certified results on prime gaps"
  checkEq "title: a phrase before a colon stays" (dropSlug "Sums of squares: a formalization") "Sums of squares: a formalization"
  checkEq "title: no colon" (dropSlug "Fermat, formalized") "Fermat, formalized"
  checkEq "package name, lakefile.toml" (packageName "name = \"prime_gaps\"\ndefaultTargets = [\"A\"]\n\n[[lean_lib]]\nname = \"A\"" true) (some "prime_gaps")
  checkEq "package name, lakefile.lean" (packageName "import Lake\nopen Lake DSL\n\npackage «sums_of_squares» where\n" false) (some "sums_of_squares")
  -- The build always says which main results and title the page uses, and where from.
  checkEq "message: main results from the config" (Proofmap.mainResultsMessage ["A.x", "B.y"] (some "proofmap.toml"))
    "main results (2, from proofmap.toml): A.x, B.y"
  checkEq "message: main results chosen automatically" (Proofmap.mainResultsMessage ["A.x"] none)
    "main results (1, chosen automatically): A.x (name them in a `## Main statements` section of the module docstring, or set roots in proofmap.toml)"
  checkEq "message: main results from the modules" (Proofmap.mainResultsMessage ["A.x"] (some "the Main statements of the modules"))
    "main results (1, from the Main statements of the modules): A.x"
  checkEq "message: title from the config" (Proofmap.titleMessage "T" (some "proofmap.toml") true)
    "page title \"T\" (from proofmap.toml)"
  checkEq "message: title found in the project" (Proofmap.titleMessage "T" (some "README.md") false)
    "page title \"T\" (from README.md; set title in proofmap.toml to change it)"
  checkEq "message: commit hint" (commitHint "proofmap.html" none)
    "proofmap.html is not committed yet: commit proofmap.html to share the page with the repository, or publish it with GitHub Pages (see the FAQ)"
  checkEq "message: commit hint with its folder" (commitHint "proofmap.html" (some "proofmap_files"))
    "proofmap.html is not committed yet: commit proofmap.html and proofmap_files/ to share the page with the repository, or publish it with GitHub Pages (see the FAQ)"
  checkEq "message: title from module names" (Proofmap.titleMessage "T" none false)
    "page title \"T\" (set title in proofmap.toml to change it)"

end ProofmapTests
