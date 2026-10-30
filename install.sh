#!/bin/sh
# Installs proofmap globally for the current user.
#
#   curl -fsSL https://raw.githubusercontent.com/n0zer0d4y/proofmap/main/install.sh | sh
#
# Needs only elan (every Lean user has it) and git. Downloads the proofmap release into
# ~/.proofmap/repo, keeps its Lean source in ~/.proofmap/src/<version> (engines for other
# toolchains are built from it on first use), builds the launcher with proofmap's own
# toolchain, and adds ~/.proofmap/bin to PATH in your shell profile.
#
# Options (also as environment variables, which is how they reach a piped install):
#   --version TAG      release to install (PROOFMAP_VERSION; default: the latest vX.Y.Z tag)
#   --source DIR       install from a local checkout (PROOFMAP_SOURCE; self-update and tests)
#   --no-modify-path   leave shell profiles alone (PROOFMAP_NO_MODIFY_PATH=1)
set -eu

REPO=https://github.com/n0zer0d4y/proofmap
HOME_DIR="${PROOFMAP_HOME:-$HOME/.proofmap}"
VERSION="${PROOFMAP_VERSION:-}"
SOURCE="${PROOFMAP_SOURCE:-}"
MODIFY_PATH=1
[ "${PROOFMAP_NO_MODIFY_PATH:-}" = 1 ] && MODIFY_PATH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --no-modify-path) MODIFY_PATH=0; shift ;;
    *) echo "proofmap: unknown option $1" >&2; exit 1 ;;
  esac
done

say() { echo "proofmap: $*"; }
fail() { echo "proofmap: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required ($2) but was not found"; }

need elan "it installs the Lean toolchains proofmap is built with; see https://github.com/leanprover/elan"
need lake "it comes with elan"

# 1. The release source.
if [ -n "$SOURCE" ]; then
  CHECKOUT="$(cd "$SOURCE" && pwd)"
  say "installing from $CHECKOUT"
else
  need git "it downloads the release"
  CHECKOUT="$HOME_DIR/repo"
  if [ -z "$VERSION" ]; then
    VERSION="$(git ls-remote --tags --refs "$REPO" 'v*' | sed 's|.*refs/tags/||' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$'       | sort -t. -k1.2,1n -k2,2n -k3,3n | tail -n 1)"
    [ -n "$VERSION" ] || fail "no release found at $REPO"
  fi
  if [ -d "$CHECKOUT/.git" ]; then
    git -C "$CHECKOUT" fetch --quiet --depth 1 origin tag "$VERSION" --force
    git -C "$CHECKOUT" checkout --quiet --force "$VERSION"
  else
    rm -rf "$CHECKOUT"
    git clone --quiet --depth 1 --branch "$VERSION" "$REPO" "$CHECKOUT"
  fi
  say "downloaded proofmap $VERSION"
fi
LEAN="$CHECKOUT/lean"
[ -f "$LEAN/lakefile.lean" ] || fail "$CHECKOUT is not a proofmap checkout (lean/lakefile.lean missing)"
VER="$(sed -n 's/.*def version : String := "\([^"]*\)".*/\1/p' "$LEAN/Proofmap/Version.lean")"
[ -n "$VER" ] || fail "could not read the proofmap version"

# 2. The source engines are built from (without build output).
SRC="$HOME_DIR/src/$VER"
rm -rf "$SRC"
mkdir -p "$SRC"
for item in lakefile.lean lean-toolchain lake-manifest.json Main.lean Proofmap.lean Proofmap compat assets test; do
  [ -e "$LEAN/$item" ] && cp -R "$LEAN/$item" "$SRC/"
done
find "$SRC" -type d -name .lake -prune -exec rm -rf {} +

# 3. The launcher, built with proofmap's own toolchain (elan installs it if needed).
say "building the launcher (proofmap $VER); the first time this downloads a Lean toolchain"
BUILD="$HOME_DIR/build/$VER"
rm -rf "$BUILD"
mkdir -p "$(dirname "$BUILD")"
cp -R "$SRC" "$BUILD"
(cd "$BUILD" && lake build proofmap) || fail "building the launcher failed (see above)"
PREFIX="$(cd "$BUILD" && lean --print-prefix)"
mkdir -p "$HOME_DIR/launcher"
EXE="$HOME_DIR/launcher/proofmap"
# Replace atomically, so a running launcher (self-update) keeps working.
cp "$BUILD/.lake/build/bin/proofmap" "$EXE.new"
mv -f "$EXE.new" "$EXE"
rm -rf "$BUILD"

# 4. The shim: the launcher's Lean runtime first on the library path, the original saved for
# the programs the launcher starts, and the process marked as the launcher.
mkdir -p "$HOME_DIR/bin"
cat > "$HOME_DIR/bin/proofmap" <<EOF
#!/bin/sh
PROOFMAP_SAVED_LD_LIBRARY_PATH="\${LD_LIBRARY_PATH:-}" \\
LD_LIBRARY_PATH="$PREFIX/lib/lean\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}" \\
PROOFMAP_LAUNCHER=1 PROOFMAP_HOME="$HOME_DIR" exec "$EXE" "\$@"
EOF
chmod +x "$HOME_DIR/bin/proofmap"

# 5. PATH, in the profiles of the shells in use (lines marked so uninstall can remove them).
if [ "$MODIFY_PATH" = 1 ]; then
  line="export PATH=\"$HOME_DIR/bin:\$PATH\" # proofmap"
  for f in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$f" ] || [ "$f" = "$HOME/.profile" ]; then
      grep -qs "# proofmap\$" "$f" || printf '\n%s\n' "$line" >> "$f"
    fi
  done
  say "added $HOME_DIR/bin to PATH in your shell profile; open a new terminal to use it"
fi
say "installed proofmap $VER. In a Lean project, run: proofmap build   (proofmap doctor checks the setup)"
