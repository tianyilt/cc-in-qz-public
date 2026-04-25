#!/bin/sh
# init-cc.sh - One-time setup for Claude Code in QZ (启智) environment
# Run: bash ./init-cc.sh
#
# What it does:
#   1. Verifies CC source tree and bun exist
#   2. Runs bun install if node_modules missing
#   3. Creates ~/.claude/ with config from this repo
#   4. Adds this repo to PATH in shell rc file
#
# After running: open a new terminal (or source rc file), then `ccc`

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CC_DIR="${CC_DIR:-$SCRIPT_DIR}"
CC_SETUP_DIR="${CC_SETUP_DIR:-$SCRIPT_DIR}"
CONFIG_SRC="${CC_SETUP_DIR}/config"
CLAUDE_DIR="${HOME}/.claude"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { printf "${BLUE}[INFO]${NC}  %s\n" "$1"; }
ok()    { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }
error() { printf "${RED}[ERROR]${NC} %s\n" "$1"; }

# ============================================================
# Step 1: Verify prerequisites
# ============================================================
info "Checking prerequisites..."

if [ ! -d "$CC_DIR/src" ]; then
  error "CC source tree not found at $CC_DIR"
  error "Set CC_DIR to the path of this repo or the shared CC source tree."
  exit 1
fi

# Resolve bun
if [ -z "${BUN:-}" ]; then
  for candidate in \
    "$(command -v bun 2>/dev/null)" \
    "$CC_SETUP_DIR/bun/bun" \
    "$HOME/.bun/bin/bun"; do
    if [ -x "$candidate" ]; then
      BUN="$candidate"
      break
    fi
  done
fi

if [ -z "$BUN" ]; then
  error "bun not found. Install it: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
ok "CC source tree + bun ($($BUN --version))"

# ============================================================
# Step 2: Run bun install if node_modules missing
# ============================================================
if [ ! -d "$CC_DIR/node_modules" ]; then
  info "Running bun install (one-time)..."
  (cd "$CC_DIR" && "$BUN" install)
  if [ -d "$CC_DIR/node_modules" ]; then
    ok "bun install complete"
  else
    error "bun install failed. Check write access to $CC_DIR"
    exit 1
  fi
else
  ok "node_modules already exists"
fi

# ============================================================
# Step 3: Create ~/.claude/ directory structure
# ============================================================
info "Setting up ~/.claude/ directory..."

mkdir -p "$CLAUDE_DIR"
mkdir -p "$CLAUDE_DIR/skills"
mkdir -p "$CLAUDE_DIR/cache"

ok "~/.claude/ directory ready"

# ============================================================
# Step 4: Set up CLAUDE.md
# ============================================================
info "Setting up global CLAUDE.md..."

CLAUDE_MD_SRC="$CONFIG_SRC/CLAUDE.md"
CLAUDE_MD_DST="$CLAUDE_DIR/CLAUDE.md"

if [ -L "$CLAUDE_MD_DST" ]; then
  rm "$CLAUDE_MD_DST"
  ln -s "$CLAUDE_MD_SRC" "$CLAUDE_MD_DST"
  ok "CLAUDE.md symlink updated -> $CLAUDE_MD_SRC"
elif [ -f "$CLAUDE_MD_DST" ]; then
  warn "CLAUDE.md already exists -- not overwriting"
  warn "  To use cc-in-qz version: rm $CLAUDE_MD_DST && ln -s $CLAUDE_MD_SRC $CLAUDE_MD_DST"
else
  ln -s "$CLAUDE_MD_SRC" "$CLAUDE_MD_DST"
  ok "CLAUDE.md symlinked -> $CLAUDE_MD_SRC"
fi

# ============================================================
# Step 5: Set up settings.json
# ============================================================
info "Setting up settings.json..."

SETTINGS_SRC="$CONFIG_SRC/settings.json"
SETTINGS_DST="$CLAUDE_DIR/settings.json"

if [ -f "$SETTINGS_DST" ]; then
  warn "settings.json already exists -- not overwriting"
else
  cp "$SETTINGS_SRC" "$SETTINGS_DST"
  ok "settings.json copied"
fi

# ============================================================
# Step 6: Add cc-in-qz to PATH
# ============================================================
info "Configuring PATH..."

CC_BIN="$CC_SETUP_DIR"

# Determine shell rc file
rc_file=""
shell_name=$(basename "${SHELL:-bash}")
case "$shell_name" in
  zsh)  rc_file="$HOME/.zshrc" ;;
  bash) rc_file="$HOME/.bashrc" ;;
  *)    rc_file="$HOME/.profile" ;;
esac

path_ok=false
case ":${PATH}:" in
  *":$CC_BIN:"*)
    ok "cc-in-qz already in PATH"
    path_ok=true
    ;;
esac

if [ -f "$rc_file" ] && grep -qF "$CC_BIN" "$rc_file" 2>/dev/null; then
  if ! $path_ok; then
    warn "$CC_BIN is in $rc_file but not in current PATH."
  fi
  path_ok=true
fi

if ! $path_ok; then
  echo "" >> "$rc_file"
  echo "# cc-in-qz: Claude Code launcher for 启智" >> "$rc_file"
  echo "export PATH=\"$CC_BIN:\$PATH\"" >> "$rc_file"
  ok "Added $CC_BIN to $rc_file"
fi

# ============================================================
# Step 7: Summary
# ============================================================
echo ""
printf "${BLUE}========================================${NC}\n"
printf "${BLUE}  cc-in-qz Setup Complete${NC}\n"
printf "${BLUE}========================================${NC}\n"
echo ""

ok "ccc command: $CC_BIN/ccc"
ok "bun: $($BUN --version)"

echo ""
printf "${YELLOW}Next steps:${NC}\n"
echo "  source $CC_BIN/activate    # activate in current shell"
echo "  ccc                        # start Claude Code (zai/glm-5.1)"
echo "  ccc local                  # local inference"
echo "  ccc dsv4pro                # DeepSeek V4 Pro"
echo ""
echo "  Add your API keys to ~/.env.local (see env.template.sh for format)"
echo ""