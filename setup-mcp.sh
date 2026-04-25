#!/bin/sh
# setup-mcp.sh - Set up MCP Python servers for Claude Code
# Optional: only needed if you want llm-chat, gemini-review, etc.
#
# Run: bash /inspire/ssd/project/video-generation/public/openveo3/tools/cc-setup/setup-mcp.sh

CC_DIR="/inspire/ssd/project/video-generation/public/openveo3/tools/claude-code-rev-1"
MCP_SRC="$CC_DIR/Auto-claude-code-research-in-sleep/mcp-servers"
VENV_DIR="$HOME/.claude/mcp-venv"

echo "Setting up MCP servers..."

# Check MCP source exists
if [ ! -d "$MCP_SRC" ]; then
  echo "Error: MCP server source not found at $MCP_SRC"
  exit 1
fi

# Create Python venv for MCP servers
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
  echo "Created Python venv at $VENV_DIR"
else
  echo "Python venv already exists at $VENV_DIR"
fi

# Install dependencies
echo "Installing Python dependencies..."
"$VENV_DIR/bin/pip" install --quiet httpx lark-oapi 2>/dev/null || {
  echo "Warning: pip install failed. You may need to install MCP deps manually."
}

# Generate .mcp.json with absolute paths (JSON doesn't expand shell variables)
MCP_JSON="$CC_DIR/.mcp.json"
PYTHON_BIN="$VENV_DIR/bin/python3"

if [ -f "$MCP_JSON" ]; then
  echo "$MCP_JSON already exists, not overwriting."
  echo "To regenerate: rm $MCP_JSON && re-run this script"
else
  cat > "$MCP_JSON" << EOF
{
  "mcpServers": {
    "llm-chat": {
      "command": "$PYTHON_BIN",
      "args": ["$MCP_SRC/llm-chat/server.py"]
    },
    "gemini-review": {
      "command": "$PYTHON_BIN",
      "args": ["$MCP_SRC/gemini-review/server.py"]
    },
    "claude-review": {
      "command": "$PYTHON_BIN",
      "args": ["$MCP_SRC/claude-review/server.py"]
    },
    "minimax-chat": {
      "command": "$PYTHON_BIN",
      "args": ["$MCP_SRC/minimax-chat/server.py"]
    },
    "feishu-bridge": {
      "command": "$PYTHON_BIN",
      "args": ["$MCP_SRC/feishu-bridge/server.py"]
    }
  }
}
EOF
  echo "Created $MCP_JSON"
fi

echo ""
echo "MCP servers set up. Restart cc to use them."
echo "Available servers: llm-chat, gemini-review, claude-review, minimax-chat, feishu-bridge"
