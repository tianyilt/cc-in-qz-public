#!/bin/sh
# env.template.sh - Rename to ~/.env.local and fill in your API keys
# Do NOT commit this file to git with real keys!
# chmod 600 ~/.env.local

# --- z.ai API Key (Anthropic-compatible, for glm-5.1) ---
# export ZAI_API_KEY="your-zai-api-key"

# --- Inference API Key (for local/glm51local/dsv4pro) ---
# export INF_API_KEY="your-inference-api-key"

# --- Override default base URL for local inference ---
# export INF_BASE_URL="https://your-endpoint/v1"

# --- OpenRouter API Key (optional, for qwen and other models) ---
# export OPENROUTER_API_KEY="your-openrouter-key"

# --- Custom config directory (optional) ---
# export CLAUDE_CONFIG_DIR="$HOME/.claude"