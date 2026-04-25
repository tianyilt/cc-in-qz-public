#!/usr/bin/env python3
"""test-upstream-timeout.py — 精确测量上游 API 流式连接何时断开

用法:
  python3 test-upstream-timeout.py [--max-wait 600] [--url URL] [--prompt-file FILE]

输出:
  - 每个 chunk 的时间戳和延迟
  - 连接断开时的精确时长
  - 是否收到 finish_reason
  - 断开前的最后几个 chunk 详情

用来给上游团队提供精确的超时证据。
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
import ssl
from datetime import datetime, timedelta

DEFAULT_URL = "YOUR_BASE_URL/v1/chat/completions"
DEFAULT_API_KEY = "YOUR_API_KEY"

# 会触发长推理的 prompt
DEFAULT_PROMPT = """Please solve this step by step, showing ALL work in extreme detail.

A farmer has 1000 chickens. Each chicken lays an average of 0.8 eggs per day. The farmer sells eggs for $0.35 each. Feed costs $0.12 per chicken per day. Housing costs $50 per day.

The farmer wants to expand: each new chicken costs $15 to buy and requires $0.05 more housing per day. The farmer can get a loan at 6% annual interest, compounded monthly, for up to $50000.

The egg price follows seasonal variation: spring $0.40, summer $0.30, fall $0.35, winter $0.45. Disease risk is 2% per quarter, each disease event kills 15% of flock and costs $500 in vet bills.

The farmer also has the option to process chickens into meat at $8 per chicken, but only chickens over 18 months old. Chickens stop laying efficiently after 24 months.

Calculate the optimal strategy for the next 5 years, considering all factors, showing monthly cash flow projections. Then verify your calculation with a Monte Carlo simulation using 10000 trials. Present results in detailed tables."""


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] {msg}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Test upstream API streaming timeout")
    parser.add_argument("--max-wait", type=int, default=600, help="Max wait seconds (default: 600)")
    parser.add_argument("--url", default=DEFAULT_URL, help="Upstream API URL")
    parser.add_argument("--api-key", default=DEFAULT_API_KEY, help="API key")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Prompt text")
    parser.add_argument("--prompt-file", help="Read prompt from file")
    parser.add_argument("--max-tokens", type=int, default=32000, help="max_tokens for request")
    parser.add_argument("--no-verify-ssl", action="store_true", help="Skip SSL verification")
    args = parser.parse_args()

    if args.prompt_file:
        with open(args.prompt_file, "r") as f:
            args.prompt = f.read()

    ctx = ssl.create_default_context()
    if args.no_verify_ssl:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    body = json.dumps({
        "model": "glm-5.1",
        "messages": [{"role": "user", "content": args.prompt}],
        "max_tokens": args.max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }).encode("utf-8")

    req = urllib.request.Request(
        args.url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {args.api_key}",
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    log("=" * 60)
    log("上游 API 流式超时复现测试")
    log("=" * 60)
    log(f"URL:       {args.url}")
    log(f"Max wait:  {args.max_wait}s")
    log(f"Max tokens: {args.max_tokens}")
    log(f"Prompt len: {len(args.prompt)} chars")
    log("")

    start_time = time.monotonic()
    first_chunk_time = None
    last_chunk_time = None
    chunk_count = 0
    finish_reason = None
    total_content_tokens = 0
    total_reasoning_tokens = 0
    error_encountered = None
    last_5_chunks = []  # 保存最后 5 个 chunk 的摘要

    try:
        log("发送请求...")
        resp = urllib.request.urlopen(req, timeout=args.max_wait + 60, context=ctx)
        log(f"HTTP {resp.status} {resp.reason}")

        buffer = ""
        while True:
            elapsed = time.monotonic() - start_time
            if elapsed > args.max_wait:
                log(f"达到最大等待 {args.max_wait}s，主动退出")
                break

            try:
                chunk_bytes = resp.read(1)  # 逐字节读取以获得精确时间
                if not chunk_bytes:
                    log("连接关闭: read() 返回空（远端 EOF）")
                    break
            except Exception as e:
                error_encountered = str(e)
                log(f"连接异常断开: {type(e).__name__}: {e}")
                break

            now = time.monotonic()
            if first_chunk_time is None:
                first_chunk_time = now
                ttfb = first_chunk_time - start_time
                log(f"首字节到达: TTFB = {ttfb:.2f}s")

            last_chunk_time = now
            chunk_count += 1

            buffer += chunk_bytes.decode("utf-8", errors="replace")

            # 解析 SSE 行
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()

                if not line.startswith("data: "):
                    continue

                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    log("收到 [DONE] 信号")
                    break

                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                # 检查 finish_reason
                choice = data.get("choices", [{}])[0]
                fr = choice.get("finish_reason")
                if fr and fr != "null":
                    finish_reason = fr
                    elapsed_now = time.monotonic() - start_time
                    log(f"收到 finish_reason={fr} at +{elapsed_now:.1f}s")

                # 统计 tokens
                delta = choice.get("delta", {})
                if delta.get("content"):
                    total_content_tokens += 1  # 粗略计数
                if delta.get("reasoning_content"):
                    total_reasoning_tokens += 1

                # usage
                usage = data.get("usage")
                if usage:
                    log(f"  usage: prompt_tokens={usage.get('prompt_tokens')}, "
                        f"completion_tokens={usage.get('completion_tokens')}")

                # 保存最后 5 个 chunk
                chunk_summary = {
                    "elapsed": round(time.monotonic() - start_time, 2),
                    "finish_reason": fr,
                    "has_content": bool(delta.get("content")),
                    "has_reasoning": bool(delta.get("reasoning_content")),
                    "has_tool_calls": bool(delta.get("tool_calls")),
                }
                last_5_chunks.append(chunk_summary)
                if len(last_5_chunks) > 5:
                    last_5_chunks.pop(0)

            # 每 30s 打印心跳
            if chunk_count % 5000 == 0:
                elapsed_now = time.monotonic() - start_time
                log(f"  ... 已读 {chunk_count} bytes, +{elapsed_now:.1f}s")

    except urllib.error.HTTPError as e:
        error_encountered = f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:500]}"
        log(f"HTTP 错误: {error_encountered}")
    except urllib.error.URLError as e:
        error_encountered = f"URL Error: {e.reason}"
        log(f"URL 错误: {error_encountered}")
    except Exception as e:
        error_encountered = f"{type(e).__name__}: {e}"
        log(f"异常: {error_encountered}")

    end_time = time.monotonic()
    total_elapsed = end_time - start_time

    # ── 报告 ──
    log("")
    log("=" * 60)
    log("测试结果")
    log("=" * 60)
    log(f"总耗时:            {total_elapsed:.2f}s")
    if first_chunk_time:
        ttfb = first_chunk_time - start_time
        stream_duration = last_chunk_time - first_chunk_time if last_chunk_time else 0
        log(f"TTFB (首字节):     {ttfb:.2f}s")
        log(f"流持续时间:        {stream_duration:.2f}s")
    log(f"读取字节数:        {chunk_count}")
    log(f"finish_reason:     {finish_reason or '未收到'}")
    log(f"错误:              {error_encountered or '无'}")

    if last_5_chunks:
        log(f"\n最后 5 个 chunk:")
        for c in last_5_chunks:
            log(f"  +{c['elapsed']}s  finish={c['finish_reason']}  "
                f"content={c['has_content']}  reasoning={c['has_reasoning']}  "
                f"tool_calls={c['has_tool_calls']}")

    # ── 结论 ──
    log("")
    if finish_reason and finish_reason not in ("null",):
        log(f"结论: 正常结束 (finish_reason={finish_reason})，上游在 {total_elapsed:.1f}s 内完成")
    elif error_encountered and "EOF" in str(error_encountered):
        log(f"结论: 上游在约 {total_elapsed:.1f}s 后主动关闭连接（EOF），未发 finish_reason")
        log(f"       → 很可能是上游有请求时长限制")
        # 尝试猜测超时阈值
        if first_chunk_time and last_chunk_time:
            sd = last_chunk_time - first_chunk_time
            log(f"       → 流持续时间 {sd:.1f}s，可能是上游的 streaming timeout 阈值")
    elif error_encountered:
        log(f"结论: 异常断开 ({error_encountered})，在 {total_elapsed:.1f}s 时")
    else:
        log(f"结论: 未收到 finish_reason 但也未检测到错误，在 {total_elapsed:.1f}s 后退出")

    log("")


if __name__ == "__main__":
    main()
