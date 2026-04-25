# Skill: qzcli

Manage compute resources on 启智 (QZ) platform — submit jobs, stop jobs, query status, check availability.

**Trigger**：user mentions qzcli, 启智平台, 计算组, 提交任务, 停止任务, avail

## Prerequisites

- **Account**: `qzcli login -u <YOUR_USERNAME> -p '<YOUR_PASSWORD>'`
- **API**: `https://YOUR_QZ_API_ENDPOINT`

## Basic Operations

### Login

```bash
# Cookie login (only enables `list`)
qzcli login -u <YOUR_USERNAME> -p '<YOUR_PASSWORD>'

# Persistent auth (required for stop/status/etc.)
qzcli init -u <YOUR_USERNAME> -p '<YOUR_PASSWORD>'
```

### List Jobs

```bash
qzcli list -c -w <WORKSPACE_NAME>
qzcli list -c -w <WORKSPACE_NAME> -n 100
qzcli list -c -w <WORKSPACE_NAME> --compact
```

### Stop Jobs

```bash
qzcli stop -y <job-id>
```

### Check Compute Groups

```bash
qzcli avail -w <WORKSPACE_NAME>
```

### View Resources

```bash
qzcli workspaces                         # workspace resource configs
qzcli res --list                         # cached workspace resources
qzcli res -w <WORKSPACE_NAME>            # spec details
```

## Job Submission Template

```bash
qzcli login -u <YOUR_USERNAME> -p '<YOUR_PASSWORD>'

SUBMIT="/path/to/submit_job_eval_with_score.sh"

INFER_SPEC_ID="<YOUR_INFER_SPEC_ID>" \
INFER_WORKSPACE_ID="<YOUR_INFER_WS_ID>" \
INFER_LOGIC_COMPUTE_GROUP_ID="<YOUR_LCG_ID>" \
EVAL_SPEC_ID="<YOUR_EVAL_SPEC_ID>" \
EVAL_WORKSPACE_ID="<YOUR_EVAL_WS_ID>" \
EVAL_LOGIC_COMPUTE_GROUP_ID="<YOUR_EVAL_LCG_ID>" \
CHECKPOINT_DIR="/path/to/checkpoint" \
EVAL_MODE="..." \
VIDEO_DURATION="8s" \
INSTANCES=1 PRIORITY=3 \
bash $SUBMIT
```

## Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Cookie expired | Long idle time | Re-run `qzcli login` |
| `stop` fails | No `qzcli init` | Run `qzcli init ...` first |
| `spec_id not found` | Spec not in current workspace | Verify workspace/spec match |
| zsh glob errors | Server uses zsh | Wrap in `bash` or use Python |
| Long queue time | Compute group 100% full | Switch group or wait |