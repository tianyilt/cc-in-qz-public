# cc-in-qz: Claude Code for 启智 (QZ) Intranet

在启智内网服务器上使用你自己部署的模型进行 Vibe Coding，无需 Anthropic 官方 API。

## 这是什么？

这是一个**完整的 Claude Code 开发环境**，包括：

- **重构版 Claude Code 源码** — 从 source maps 恢复，经魔改修复以支持启智内网模型
- **多 Provider 启动器** — 一键启动，自动适配不同模型后端
- **配置模板** — CLAUDE.md、settings.json 开箱即用

关键改进（见 `git log`）：
- 修复了 OpenAI 端点上 auto-compact 不触发的问题（commit `c9f14fb`）
- 支持启智内网 OpenAI-compatible API（openapi-qb-ai / openapi-sj / deepseek-v4-infra）

## 前置要求

- Linux 服务器（部署在启智内网或能访问内网 API 端点）
- Git

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/tianyilt/cc-in-qz.git ~/cc-in-qz
cd ~/cc-in-qz
```

### 2. 运行初始化脚本

```bash
bash init-cc.sh
```

这个脚本会：
- 检查/安装 bun 运行时
- 运行 `bun install` 安装 node_modules
- 设置 `~/.claude/` 配置目录
- 将 cc-in-qz 添加到你的 PATH

### 3. 配置 API Key

```bash
cp env.template.sh ~/.env.local
chmod 600 ~/.env.local
# 编辑 ~/.env.local，填入你的 API Key
```

### 4. 开始 Vibe Coding

```bash
source activate
ccc
```

## 使用方式

```bash
ccc              # 默认：z.ai glm-5.1 (Anthropic)
ccc local        # 本地 glm-5.1 (openapi-qb-ai)
ccc dsv4pro      # DeepSeek V4 Pro
ccc qwen         # Qwen via OpenRouter
ccc --help       # 查看所有选项
```

## 支持的 Provider

| 命令 | 模型 | 后端 | 协议 |
|------|------|------|------|
| `ccc` | glm-5.1 | z.ai | Anthropic |
| `ccc local` | glm-5.1 | openapi-qb-ai | OpenAI |
| `ccc glm-5.1-w4a8` | glm-5.1-w4a8 | openapi-sj | OpenAI |
| `ccc dsv4pro` | DeepSeek-V4-Pro | deepseek-v4-infra | OpenAI |
| `ccc qwen` | qwen3.6-plus | OpenRouter | OpenAI |

## 文件说明

| 文件 | 用途 |
|------|------|
| `ccc` | 重构版 CC 启动器（推荐日常使用） |
| `ccc-official` | 官方 CC 启动器 + OpenAI 代理 |
| `proxy.ts` | Anthropic ↔ OpenAI 协议代理 |
| `init-cc.sh` | 一键初始化脚本 |
| `activate` | `source` 后即可在当前 shell 用 `ccc` |
| `env.template.sh` | 环境变量模板（**不含真实 key**） |
| `config/` | CLAUDE.md + settings.json 模板 |
| `skills/` | Claude Code Skills |
| `src/` | Claude Code TypeScript 源码 |

## 适配自己的 QZ 模型

```bash
# 快速覆盖（不改脚本）
INF_BASE_URL="https://你的服务/v1" ccc --model 你的模型 --local

# 或编辑 ccc 脚本，添加新的 provider case
```

## Git 历史

```
c9f14fb Fix auto-compact not triggering on GLM-5.1 OpenAI endpoints
fb08bce Snapshot: pre-openai-adapter-fix baseline
ead95c1 Update .gitignore
e0185bf Initial commit: restored CC source tree (999.0.0-restored)
```

`c9f14fb` 修复：OpenAI streaming 的 usage chunk 在 finish_reason 之后到达，导致 inTokens 为零时 message_delta 已发出，auto-compact 永不触发。修复为延迟 message_delta 到 stream 完全消费后。

## 作为 Skill 使用

在团队成员的 CLAUDE.md 中添加：

```markdown
### cc-in-qz-setup
使用 cc-in-qz skill 帮助 setup 启智内网的 Claude Code。
Trigger: 提到 cc-in-qz / ccc / 启智 vibe coding
Skill 位置: ~/cc-in-qz/skills/setup-cc-in-qz/SKILL.md
```

## 常见问题

| 问题 | 解决方案 |
|------|---------|
| `bun not found` | `curl -fsSL https://bun.sh/install \| bash` |
| `INF_API_KEY not set` | 创建 `~/.env.local`，参考 `env.template.sh` |
| `ZAI_API_KEY not set` | 默认 provider 需要 zai key；换用 `ccc local` |
| `src/dev-entry.ts` 找不到 | 确保在 repo 根目录运行，或设置 `CC_DIR` |

## 安全提醒

- `~/.env.local` 务必 `chmod 600`，**不要提交到 git**
- 内网 API 端点地址不要对外公开
- 仓库保持 **Private**