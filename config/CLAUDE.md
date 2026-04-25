# Claude Code Config for QZ (启智)

Use this as a starting point. Add your own skills and preferences below.

## Quick Reference

```bash
# Start Claude Code
ccc              # z.ai glm-5.1 (Anthropic-compatible)
ccc local        # local glm-5.1 via openapi-qb-ai
ccc dsv4pro      # DeepSeek V4 Pro
ccc glm51local   # local glm-5.1 (alias)
ccc qwen         # Qwen via OpenRouter

# Official Claude Code with proxy
ccc-official glm51local
ccc-official zai
```

## Custom Provider

To use your own QZ-deployed model:

```bash
# Option 1: env override
INF_BASE_URL="https://your-endpoint/v1" ccc --model your-model --local

# Option 2: add a new provider in ccc script
```