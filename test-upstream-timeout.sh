#!/bin/bash
# test-upstream-timeout.sh — 复现上游 API 长连接断开问题
# 用法: bash test-upstream-timeout.sh [max_wait_seconds]
#
# 发送一个需要长时间推理的 streaming 请求，记录从首字节到连接断开的时间，
# 从而判断上游是否有请求时长限制（如 300s）。
#
# 同时测试两条链路：
#   1. 直连上游 (openapi-qb-ai)
#   2. 经 proxy 中转

set -euo pipefail

MAX_WAIT="${1:-600}"  # 默认等 10 分钟
API_KEY="YOUR_API_KEY"
BASE_URL="YOUR_BASE_URL"

# 构造一个会触发长推理的 prompt：要求模型逐步思考一个复杂问题
# 目标是让推理时间超过 300s，看上游是否断开
PROMPT='Please solve this step by step, showing ALL work. A farmer has 1000 chickens. Each chicken lays an average of 0.8 eggs per day. The farmer sells eggs for $0.35 each. Feed costs $0.12 per chicken per day. Housing costs $50 per day. The farmer wants to expand: each new chicken costs $15 to buy and requires $0.05 more housing per day. The farmer can get a loan at 6% annual interest, compounded monthly, for up to $50000. The egg price follows seasonal variation: spring $0.40, summer $0.30, fall $0.35, winter $0.45. Disease risk is 2% per quarter, each disease event kills 15% of flock and costs $500 in vet bills. The farmer also has the option to process chickens into meat at $8 per chicken, but only chickens over 18 months old. Chickens stop laying efficiently after 24 months. Calculate the optimal strategy for the next 5 years, considering all factors, showing monthly cash flow projections. Then verify your calculation with a Monte Carlo simulation using 10000 trials. Present results in detailed tables.'

echo "============================================"
echo "上游长连接超时复现测试"
echo "============================================"
echo "上游: $BASE_URL"
echo "最大等待: ${MAX_WAIT}s"
echo "测试时间: $(date -Iseconds)"
echo ""

# ── Test 1: 直连上游，streaming ──
echo "── Test 1: 直连上游 (streaming) ──"
echo "发送请求..."

START_EPOCH=$(date +%s)
FIRST_CHUNK_EPOCH=""
LAST_CHUNK_EPOCH=""
CHUNK_COUNT=0
FINISH_REASON=""
ERROR_MSG=""

# 用 curl 的 -N (no buffer) + timeout 控制
# --max-time 设长一些，让上游自己断
while IFS= read -r line; do
    NOW_EPOCH=$(date +%s)
    ELAPSED=$(( NOW_EPOCH - START_EPOCH ))

    if [ -z "$FIRST_CHUNK_EPOCH" ]; then
        FIRST_CHUNK_EPOCH=$NOW_EPOCH
        echo "  首个 chunk 到达: +${ELAPSED}s"
    fi

    LAST_CHUNK_EPOCH=$NOW_EPOCH

    # 检查 finish_reason
    if echo "$line" | grep -q '"finish_reason"'; then
        FR=$(echo "$line" | sed -n 's/.*"finish_reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        if [ -n "$FR" ] && [ "$FR" != "null" ]; then
            FINISH_REASON="$FR"
        fi
    fi

    # 检查错误
    if echo "$line" | grep -q '"error"'; then
        ERROR_MSG=$(echo "$line" | head -c 300)
    fi

    CHUNK_COUNT=$((CHUNK_COUNT + 1))

    # 每 30s 打印一次心跳
    if [ $((CHUNK_COUNT % 200)) -eq 0 ]; then
        echo "  ... 已收到 ${CHUNK_COUNT} chunks, +${ELAPSED}s"
    fi

    # 超过最大等待时间主动退出
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
        echo "  达到最大等待 ${MAX_WAIT}s，主动退出"
        break
    fi
done < <(
    curl -sS -N --connect-timeout 30 --max-time $((MAX_WAIT + 60)) \
        "${BASE_URL}/v1/chat/completions" \
        -H "Authorization: Bearer ${API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg prompt "$PROMPT" '{
            model: "glm-5.1",
            messages: [{role: "user", content: $prompt}],
            max_tokens: 32000,
            stream: true,
            stream_options: {include_usage: true}
        }')" 2>/dev/null
)

CURL_EXIT=$?
END_EPOCH=$(date +%s)

if [ -n "$FIRST_CHUNK_EPOCH" ]; then
    FIRST_TTFB=$(( FIRST_CHUNK_EPOCH - START_EPOCH ))
    TOTAL=$(( END_EPOCH - START_EPOCH ))
    STREAM_DURATION=$(( LAST_CHUNK_EPOCH - FIRST_CHUNK_EPOCH ))
    echo ""
    echo "── Test 1 结果 ──"
    echo "  TTFB (首字节):      ${FIRST_TTFB}s"
    echo "  流持续时间:          ${STREAM_DURATION}s"
    echo "  总耗时:             ${TOTAL}s"
    echo "  收到 chunks:        ${CHUNK_COUNT}"
    echo "  finish_reason:      ${FINISH_REASON:-无}"
    echo "  curl exit code:     ${CURL_EXIT}"
    if [ -n "$ERROR_MSG" ]; then
        echo "  错误信息:           ${ERROR_MSG}"
    fi
    if [ "$CURL_EXIT" -ne 0 ]; then
        echo "  ⚠ curl 非正常退出 (exit=$CURL_EXIT)，可能是连接被远端关闭"
    fi
    if [ -z "$FINISH_REASON" ] || [ "$FINISH_REASON" = "null" ]; then
        echo "  ⚠ 未收到 finish_reason，连接可能被上游异常断开"
    fi
    echo ""
    echo "  结论: 上游流式响应在约 ${STREAM_DURATION}s 后断开"
else
    echo "  ⚠ 未收到任何数据 (curl exit=$CURL_EXIT)"
fi

echo ""
echo "============================================"
echo "测试完成: $(date -Iseconds)"
echo "============================================"
