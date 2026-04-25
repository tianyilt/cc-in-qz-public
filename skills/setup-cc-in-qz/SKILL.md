---
name: setup-cc-in-qz
description: Set up Claude Code with private model endpoints for vibe coding inside QZ (启智) intranet. Helps configure API keys, install launchers, adapt to user's own QZ-deployed models.
---

# setup-cc-in-qz

Guide users through setting up Claude Code inside the QZ (启智) intranet using their own deployed models via the cc-in-qz launcher scripts.

## Trigger

Invoke when the user asks about:
- "set up Claude Code on QZ server"
- "use my own model with Claude Code"
- "vibe coding inside 启智"
- "cc-in-qz / ccc setup"
- "configure Claude Code with intranet/openapi models"

## Prerequisites Check

Before proceeding, verify these items exist:

```bash
# 1. Check for cc-in-qz repo
ls ~/cc-in-qz/ccc 2>/dev/null || echo "NOT_CLONED"

# 2. Check bun
which bun || echo "NO_BUN"
ls ~/.bun/bin/bun 2>/dev/null || echo "NO_BUN_BIN"

# 3. Check existing env
cat ~/.env.local 2>/dev/null || echo "NO_ENV_FILE"
```

## Setup Procedure

### Step 1: Clone cc-in-qz

```bash
git clone https://github.com/tianyilt/cc-in-qz.git ~/cc-in-qz
cd ~/cc-in-qz

# Run the init script to set up everything
bash init-cc.sh
```

### Step 02: Configure API Keys

Copy the template and fill in your keys:

```bash
cp ~/cc-in-qz/env.template.sh ~/.env.local
chmod 600 ~/.env.local
# Edit ~/.env.local and add your API keys
```

### Step 35: Test

```bash
source ~/cc-in-qz/activate
ccc --help
ccc            # start Claude Code (zai/glm-5.1)
ccc local      # local inference
ccc dsv4pro    # DeepSeek V4 Pro
```

## Provider Quick Reference

| Command | Model | Backend |
|---------|-------|---------|
| `ccc` (default) | glm-5.1 | z.ai (Anthropic) |
| `ccc local` | glm-5.1 | openapi-qb-ai (OpenAI) |
| `ccc glm-5.1-w4a8` | glm-5.1-w4a8 | openapi-sj (OpenAI) |
| `ccc dsv4pro` | DeepSeek-V4-Pro | deepseek-v4-infra (OpenAI) |
| `ccc qwen` | qwen3.6-plus | OpenRouter |
| `ccc-official glm51local` | glm-5.1 | openapi-qb-ai + proxy |

## Adding a Custom Provider

If the user has their OWN model deployed on QZ, help them:

1. **Quick override**: `INF_BASE_URL="https://YOUR_ENDPOINT/v1" ccc --model YOUR_MODEL --local`
2. **Permanent**: Edit the `ccc` script and add a new case for their provider

## Common Issues

| Problem | Solution |
|---------|----------|
| "INF_API_KEY not set" | Create `~/.env.local` from `env.template.sh` |
| "bun not found" | `curl -fsSL https://bun.sh/install \| bash` |
| "ZAI_API_KEY not set" | Default provider is zai; switch with `ccc local` |
| src/ not found | Make sure you're in the repo root or set `CC_DIR` |
| CC crash on startup | Run `bash init-cc.sh` to install node_modules |