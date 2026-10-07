#!/usr/bin/env bash
set -euo pipefail

REPO="PineGrove-AI/MarkdownOffice"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="mdo"

# ── Helpers ────────────────────────────────────────────────────────────

info()    { printf '  %s\n' "$*"; }
ok()      { printf '  ✓ %s\n' "$*"; }
warn()    { printf '  ! %s\n' "$*"; }
fail()    { printf '  ✗ %s\n' "$*" >&2; exit 1; }

confirm() {
  printf '  %s [y/N] ' "$1"
  read -r answer
  case "$answer" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Detect platform ───────────────────────────────────────────────────

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)  os="linux" ;;
    Darwin) os="darwin" ;;
    *)      fail "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  arch="x86_64" ;;
    arm64|aarch64) arch="aarch64" ;;
    *)             fail "Unsupported architecture: $arch" ;;
  esac

  echo "${os}-${arch}"
}

# ── Detect package manager ────────────────────────────────────────────

detect_pkg_manager() {
  if command -v brew >/dev/null 2>&1; then
    echo "brew"
  elif command -v apt-get >/dev/null 2>&1; then
    echo "apt"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v pacman >/dev/null 2>&1; then
    echo "pacman"
  else
    echo "none"
  fi
}

install_with_pkg_manager() {
  local pkg="$1"
  local mgr="$2"

  case "$mgr" in
    brew)   brew install "$pkg" ;;
    apt)    sudo apt-get update -qq && sudo apt-get install -y "$pkg" ;;
    dnf)    sudo dnf install -y "$pkg" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" ;;
    *)      return 1 ;;
  esac
}

# ── Check / install dependencies ──────────────────────────────────────

PKG_MGR="$(detect_pkg_manager)"

echo "Checking dependencies..."

if command -v pandoc >/dev/null 2>&1; then
  ok "pandoc $(pandoc --version | head -1 | awk '{print $2}')"
else
  warn "pandoc not found"
  if [ "$PKG_MGR" != "none" ] && confirm "Install pandoc via $PKG_MGR?"; then
    install_with_pkg_manager pandoc "$PKG_MGR"
    ok "pandoc installed"
  else
    fail "pandoc is required. Install it manually: https://pandoc.org/installing.html"
  fi
fi

if command -v typst >/dev/null 2>&1; then
  ok "typst $(typst --version | awk '{print $2}')"
else
  warn "typst not found"
  if [ "$PKG_MGR" = "brew" ] && confirm "Install typst via brew?"; then
    brew install typst
    ok "typst installed"
  elif command -v cargo >/dev/null 2>&1 && confirm "Install typst via cargo?"; then
    cargo install typst-cli
    ok "typst installed"
  else
    fail "typst is required. Install it manually: https://github.com/typst/typst#installation"
  fi
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  ok "node $(node --version) (for mdo slides)"
else
  warn "node/npm not found — only needed for 'mdo slides': https://nodejs.org"
fi

# ── Download mdo ──────────────────────────────────────────────────────

PLATFORM="$(detect_platform)"
ARTIFACT="mdo-${PLATFORM}"

echo ""
echo "Downloading mdo for ${PLATFORM}..."

# GitHub redirects this to the latest release's asset. Unlike the API, it
# isn't rate limited for anonymous requests.
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ARTIFACT}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL -o "$TMP_DIR/$BINARY_NAME" "$DOWNLOAD_URL" \
  || fail "Could not download ${ARTIFACT} from the latest release. Check https://github.com/${REPO}/releases"
chmod +x "$TMP_DIR/$BINARY_NAME"

# ── Install ────────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"

echo ""
echo "Installing to $INSTALL_DIR/$BINARY_NAME..."

mv "$TMP_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"

ok "installed: $INSTALL_DIR/$BINARY_NAME"

# Check if INSTALL_DIR is on PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    warn "$INSTALL_DIR is not on your PATH"
    echo ""
    echo "  Add it by appending this to your shell profile (~/.zshrc, ~/.bashrc, etc.):"
    echo ""
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    ;;
esac

echo ""
echo "Run 'mdo --help' to get started."
