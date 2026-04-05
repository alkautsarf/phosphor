#!/usr/bin/env sh
set -e

REPO="alkautsarf/phosphor"

# Check bun is installed
if ! command -v bun >/dev/null 2>&1; then
  echo "phosphor requires bun. Install it first:" >&2
  echo "  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

# Detect OS
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

# Detect architecture
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)             echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

TARGET="${OS}-${ARCH}"

case "$TARGET" in
  darwin-arm64|linux-x64) ;;
  *) echo "No prebuilt package for ${TARGET}. Install from source instead:" >&2
     echo "  git clone https://github.com/${REPO}.git && cd phosphor && bun install && bun run src/index.ts" >&2
     exit 1 ;;
esac

# Fetch latest tag
TAG=$(curl -sfL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$TAG" ]; then
  echo "Failed to fetch latest release" >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${TAG}/phosphor-${TAG}-${TARGET}.tar.gz"

echo "Installing phosphor ${TAG} (${TARGET})..."

# Install to ~/.local/lib/phosphor
INSTALL_DIR="${HOME}/.local/lib/phosphor"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"

# Clean previous install
rm -rf "$INSTALL_DIR"/*

# Extract package
curl -sfL "$URL" | tar xz -C "$INSTALL_DIR"

# Create symlinks in bin
ln -sf "$INSTALL_DIR/phosphor" "$BIN_DIR/phosphor"
ln -sf "$INSTALL_DIR/phosphor" "$BIN_DIR/ph"
ln -sf "$INSTALL_DIR/phosphor" "$BIN_DIR/pho"

echo "Installed phosphor to ${INSTALL_DIR} (aliases: phosphor, ph, pho)"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  echo "Add ${BIN_DIR} to your PATH:"
  echo "  export PATH=\"${BIN_DIR}:\$PATH\""
fi
