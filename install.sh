#!/usr/bin/env sh
set -e

REPO="alkautsarf/phosphor"

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

# Only supported combinations
case "$TARGET" in
  darwin-arm64|linux-x64) ;;
  *) echo "No prebuilt binary for ${TARGET}. Install from source instead:" >&2
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
BINARY="phosphor-${TARGET}"

echo "Installing phosphor ${TAG} (${TARGET})..."

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

curl -sfL "$URL" | tar xz -C "$WORK_DIR"

# Install to ~/.local/bin (no sudo) or /usr/local/bin
if [ -w "/usr/local/bin" ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi

mv "$WORK_DIR/$BINARY" "$INSTALL_DIR/phosphor"
chmod +x "$INSTALL_DIR/phosphor"
ln -sf "$INSTALL_DIR/phosphor" "$INSTALL_DIR/ph"
ln -sf "$INSTALL_DIR/phosphor" "$INSTALL_DIR/pho"

echo "Installed phosphor to ${INSTALL_DIR}/phosphor (aliases: ph, pho)"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "Add ${INSTALL_DIR} to your PATH:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi
