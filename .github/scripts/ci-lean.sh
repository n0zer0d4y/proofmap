#!/usr/bin/env bash
# Lean CI checks for one toolchain.
# Usage: ci-lean.sh <toolchain>, for example ci-lean.sh leanprover/lean4:v4.29.0
#
# The package and the fixture are copied to a temporary directory and built there
# with the given toolchain, so builds for different toolchains never share a .lake.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <toolchain>" >&2
  exit 1
fi
toolchain="$1"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== toolchain $toolchain (work dir $work)"
mkdir -p "$work/lean"
(cd "$repo/lean" && tar --exclude='.lake' -cf - lakefile.lean Main.lean Proofmap.lean Proofmap compat assets test) \
  | (cd "$work/lean" && tar -xf -)
echo "$toolchain" > "$work/lean/lean-toolchain"
echo "$toolchain" > "$work/lean/test/fixture/lean-toolchain"

echo "== proofmap package: lake build"
(cd "$work/lean" && lake build && lake exe proofmap --version)

echo "== unit tests: lake test"
(cd "$work/lean" && lake test)

echo "== API check"
(cd "$work/lean/test/api" && lean "+$toolchain" ./ApiCheck.lean)

prefix="$(lean "+$toolchain" --print-prefix)"
if [ -f "$prefix/src/lean/Std/Async/TCP.lean" ]; then serve_check=ServeCheck_Async.lean; else serve_check=ServeCheck_Internal.lean; fi
echo "== serve API check ($serve_check)"
(cd "$work/lean/test/api" && lean "+$toolchain" "./$serve_check")

echo "== fixture: lake build"
(cd "$work/lean/test/fixture" && lake build)

echo "== fixture: extract, validate against the schema, check the manifest"
exe="$work/lean/.lake/build/bin/proofmap"
[ -f "$exe.exe" ] && exe="$exe.exe"
out="$work/fixture.json"
(cd "$work/lean/test/fixture" && lake env "$exe" build --root Fixture --walkthrough --json "$out" --no-lake-build)
node "$repo/viewer/scripts/validate.mjs" "$out"
node "$repo/lean/test/check-manifest.mjs" "$out" --lean "${toolchain##*:}"

echo "== serve: routes, live-reload build id, path and host safety"
(cd "$work/lean" && node "$repo/lean/test/check-serve.mjs" lake env "$exe")

echo "== check: report and exit codes (0 plain, 3 with --strict, 1 for a broken config)"
(cd "$work/lean/test/fixture" && lake env "$exe" check --root Fixture --no-lake-build) > "$work/check.txt"
grep -q "Fixture.unfinished  (Fixture/Status.lean:" "$work/check.txt"
grep -q "Fixture.customAxiom  (used by 4 declarations)" "$work/check.txt"
code=0; (cd "$work/lean/test/fixture" && lake env "$exe" check --root Fixture --no-lake-build --strict > /dev/null) || code=$?
[ "$code" = 3 ] || { echo "check --strict exited with $code, expected 3"; exit 1; }
echo '[summaries' > "$work/broken.toml"
code=0; (cd "$work/lean/test/fixture" && lake env "$exe" check --root Fixture --no-lake-build --config "$work/broken.toml" 2> /dev/null) || code=$?
[ "$code" = 1 ] || { echo "check with a broken config exited with $code, expected 1"; exit 1; }

echo "== compare: two real fixture snapshots with planted changes"
PROOFMAP_FIXTURE="$work/lean/test/fixture" node "$repo/lean/test/check-compare.mjs" lake env "$exe"

if [ -n "${PROOFMAP_E2E:-}" ]; then
  echo "== live reload and split single file (Playwright)"
  (cd "$repo/viewer" && PROOFMAP_EXE="$exe" PROOFMAP_FIXTURE="$work/lean/test/fixture" npx playwright test tests/e2e/serve.spec.ts tests/e2e/split.spec.ts)
fi

echo "== all Lean checks passed on $toolchain"
