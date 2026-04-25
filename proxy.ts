/**
 * Anthropic-to-OpenAI API proxy server.
 * Accepts Anthropic Messages API requests and translates to OpenAI Chat Completions API.
 *
 * Usage:
 *   OPENAI_API_KEY=xxx OPENAI_BASE_URL=https://... bun run anthropic-openai-proxy.ts [--port-file <path>] [port]
 *
 * Env vars:
 *   OPENAI_API_KEY       - API key for the OpenAI-compatible service
 *   OPENAI_BASE_URL      - Base URL (e.g. https://api.example.com/v1)
 *   OPENAI_CONTEXT_WINDOW - Max context window tokens (default: 202752)
 *   DEFAULT_MODEL        - If set, remap all incoming model names to this model
 */

const portFileIdx = process.argv.indexOf('--port-file')
const PORT_FILE = portFileIdx >= 0 ? process.argv[portFileIdx + 1] : ''
const requestedPort = parseInt(process.argv.find((a, i) => i > 0 && !a.startsWith('-') && process.argv[i - 1] !== '--port-file') || '0', 10)
const API_KEY = process.env.OPENAI_API_KEY || ''
const BASE_URL = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '')
const CONTEXT_WINDOW = parseInt(process.env.OPENAI_CONTEXT_WINDOW || '202752', 10)
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || ''
const COMPLETIONS_URL = BASE_URL + '/chat/completions'

// Auto-detect context window from upstream /v1/models (for vLLM/SGLang deployments)
let effectiveContextWindow = CONTEXT_WINDOW
try {
  const resp = await fetch(BASE_URL + '/models', {
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  if (resp.ok) {
    const data = await resp.json()
    const maxLen = data?.data?.[0]?.max_model_len
    if (maxLen && maxLen > 0) {
      effectiveContextWindow = maxLen
      console.error(`[proxy] Auto-detected context window from upstream /v1/models: ${maxLen} (env had: ${CONTEXT_WINDOW})`)
    }
  }
} catch (e) {
  console.error(`[proxy] Could not auto-detect context window from upstream: ${(e as Error).message || e}, using env value: ${CONTEXT_WINDOW}`)
}

const EFFECTIVE_CONTEXT_WINDOW = effectiveContextWindow

// --- Translation helpers (from openai-adapter.ts) ---

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
  }
  return ''
}

function translateMessages(anthropicMessages: any[], systemPrompt?: unknown): any[] {
  const out: any[] = []
  if (systemPrompt) {
    const text =
      typeof systemPrompt === 'string'
        ? systemPrompt
        : Array.isArray(systemPrompt)
          ? systemPrompt.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          : ''
    if (text) out.push({ role: 'system', content: text })
  }
  for (const msg of anthropicMessages) {
    if (msg.role === 'user') {
      if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter((b: any) => b.type === 'tool_result')
        const textParts = msg.content.filter((b: any) => b.type === 'text')
        for (const tr of toolResults) {
          const trContent = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
              : ''
          out.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id || 'unknown',
            content: trContent,
          })
        }
        if (textParts.length) {
          out.push({ role: 'user', content: textParts.map((b: any) => b.text).join('\n') })
        }
      } else {
        out.push({ role: 'user', content: flattenContent(msg.content) })
      }
    } else if (msg.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: any[] = []
      if (typeof msg.content === 'string') {
        textParts.push(msg.content)
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') textParts.push(block.text)
          else if (block.type === 'thinking') textParts.push(block.thinking)
          else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
              },
            })
          }
        }
      }
      const entry: any = { role: 'assistant' }
      if (textParts.length) entry.content = textParts.join('\n')
      if (toolCalls.length) entry.tool_calls = toolCalls
      out.push(entry)
    } else if (msg.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: msg.tool_use_id || msg.id || 'unknown',
        content: flattenContent(msg.content),
      })
    }
  }
  return out
}

function translateTools(tools?: any[]): any[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t: any) => ({
    type: 'function',
    function: { name: t.name, description: t.description || '', parameters: t.input_schema || {} },
  }))
}

function buildOpenAIBody(anthropicBody: any): any {
  // Remap model if DEFAULT_MODEL is set
  if (DEFAULT_MODEL) anthropicBody.model = DEFAULT_MODEL

  let maxTokens = anthropicBody.max_tokens
  if (EFFECTIVE_CONTEXT_WINDOW > 0 && maxTokens > 0) {
    const estimatedInputTokens = Math.ceil(
      JSON.stringify(anthropicBody.messages || []).length / 4
    )
    const safetyMargin = 1024
    const cappedMax = EFFECTIVE_CONTEXT_WINDOW - estimatedInputTokens - safetyMargin
    if (cappedMax > 0 && maxTokens > cappedMax) {
      maxTokens = cappedMax
    }
  }

  const body: any = {
    model: anthropicBody.model,
    messages: translateMessages(anthropicBody.messages, anthropicBody.system),
    max_tokens: maxTokens,
    stream: !!anthropicBody.stream,
  }
  if (anthropicBody.temperature != null) body.temperature = anthropicBody.temperature
  if (anthropicBody.top_p != null) body.top_p = anthropicBody.top_p
  const tools = translateTools(anthropicBody.tools)
  if (tools) body.tools = tools
  if (anthropicBody.stream) body.stream_options = { include_usage: true }
  if (anthropicBody.thinking?.type === 'enabled') {
    body.chat_template_kwargs = { enable_thinking: true }
  }
  return body
}

function safeParseJSON(s: string | undefined): any {
  if (!s) return {}
  try { return JSON.parse(s) } catch { return { raw: s } }
}

function translateNonStreamingResponse(openaiResp: any, model: string): any {
  const choice = openaiResp.choices?.[0]
  const msg = choice?.message
  const content: any[] = []
  if (msg?.reasoning_content) content.push({ type: 'thinking', thinking: msg.reasoning_content })
  if (msg?.tool_calls?.length) {
    if (msg.content) content.push({ type: 'text', text: msg.content })
    for (const tc of msg.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id || `toolu_${Date.now()}`,
        name: tc.function?.name,
        input: safeParseJSON(tc.function?.arguments),
      })
    }
  } else {
    content.push({ type: 'text', text: msg?.content || '' })
  }
  return {
    id: openaiResp.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: openaiResp.model || model,
    stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

function sse(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function translateStreamingResponse(body: ReadableStream<Uint8Array>, model: string, anthropicBody: any): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''
  let sentStart = false
  let idx = 0
  let blockType: string | null = null
  let currentToolCallIndex: number | null = null
  let outTokens = 0
  let inTokens = 0
  let bufferedFinishReason: string | null = null

  // Pre-estimate input tokens from the request body so we can report
  // usage even when the API doesn't return usage in streaming chunks.
  // Many OpenAI-compatible servers (GLM, etc.) ignore stream_options.include_usage
  // and never send chunk.usage, leaving inTokens=0. Without input_tokens,
  // Claude Code's auto-compact can never detect that the context window is
  // full, so it never triggers. The estimate (JSON length / 4) matches
  // roughTokenCountEstimation's default bytes-per-token ratio.
  const estimatedInputTokens = Math.ceil(
    JSON.stringify(anthropicBody.messages || []).length / 4
  )

  return new ReadableStream({
    async start(ctrl) {
      const reader = body.getReader()

      function emit(ev: string, d: any) { ctrl.enqueue(encoder.encode(sse(ev, d))) }

      function msgStart() {
        if (sentStart) return
        sentStart = true
        emit('message_start', {
          type: 'message_start',
          message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: inTokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
        })
      }

      function closeBlock() {
        if (!blockType) return
        emit('content_block_stop', { type: 'content_block_stop', index: idx })
        idx++
        blockType = null
      }

      function ensureBlock(type: string, extra?: any) {
        if (blockType === type && type !== 'tool_use') return
        closeBlock()
        blockType = type
        emit('content_block_start', { type: 'content_block_start', index: idx, content_block: { type, ...extra } })
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const s = line.slice(6).trim()
            if (s === '[DONE]') continue
            let chunk: any
            try { chunk = JSON.parse(s) } catch { continue }

            msgStart()
            if (chunk.usage) {
              outTokens = chunk.usage.completion_tokens || outTokens
              inTokens = chunk.usage.prompt_tokens || inTokens
            }

            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue

            if (delta.reasoning_content) {
              ensureBlock('thinking', { thinking: '' })
              emit('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'thinking_delta', thinking: delta.reasoning_content } })
            }
            if (delta.content) {
              ensureBlock('text', { text: '' })
              emit('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text: delta.content } })
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name && tc.index !== currentToolCallIndex) {
                  currentToolCallIndex = tc.index ?? null
                  ensureBlock('tool_use', { id: tc.id || `toolu_${Date.now()}`, name: tc.function.name })
                }
                if (tc.function?.arguments) {
                  emit('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } })
                }
              }
            }

            const fin = chunk.choices?.[0]?.finish_reason
            if (fin) {
              closeBlock()
              // Buffer the finish reason instead of emitting message_delta immediately.
              // OpenAI streaming with stream_options.include_usage sends the usage chunk
              // AFTER the finish_reason chunk (it has choices:[]). If we emit message_delta
              // here, inTokens is still 0 because usage hasn't arrived yet. We'll emit
              // message_delta after the loop ends, by which time inTokens will be populated.
              bufferedFinishReason = fin === 'tool_calls' ? 'tool_use' : fin === 'length' ? 'max_tokens' : 'end_turn'
            }
          }
        }
        // Emit message_delta after the stream is fully consumed, so we have
        // the final inTokens from the usage chunk (if the server sent one).
        // If inTokens is still 0 (server didn't return usage), fall back to
        // the pre-estimated input tokens so auto-compact can still work.
        if (sentStart) {
          if (blockType) closeBlock()
          const finalInputTokens = inTokens > 0 ? inTokens : estimatedInputTokens
          const stopReason = bufferedFinishReason || 'end_turn'
          emit('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outTokens, input_tokens: finalInputTokens } })
          emit('message_stop', { type: 'message_stop' })
        }
        ctrl.close()
      } catch (err) { ctrl.error(err) }
    },
  })
}

// --- HTTP Server ---

const server = Bun.serve({
  port: requestedPort || 0,
  idleTimeout: 255,  // max allowed by Bun; prevents "socket connection was closed unexpectedly" on long pauses
  async fetch(req) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', upstream: BASE_URL }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Only handle /v1/messages
    if (!url.pathname.endsWith('/v1/messages') && url.pathname !== '/v1/messages') {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found', message: `Not found: ${url.pathname}` } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'method_not_allowed', message: 'Only POST is supported' } }), { status: 405, headers: { 'Content-Type': 'application/json' } })
    }

    // Parse Anthropic request
    let anthropicBody: any
    try {
      anthropicBody = await req.json()
    } catch (e) {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request', message: 'Invalid JSON body' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const isStream = !!anthropicBody.stream
    const openaiBody = buildOpenAIBody(anthropicBody)

    console.error(`[proxy] ${anthropicBody.model} stream=${isStream} messages=${anthropicBody.messages?.length} tools=${anthropicBody.tools?.length || 0}`)

    // Forward to OpenAI-compatible endpoint
    try {
      const resp = await fetch(COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(openaiBody),
      })

      if (!resp.ok) {
        const errText = await resp.text()
        console.error(`[proxy] upstream error ${resp.status}: ${errText.slice(0, 500)}`)
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'api_error', message: `OpenAI API error (${resp.status}): ${errText}` } }),
          { status: resp.status, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (isStream) {
        return new Response(translateStreamingResponse(resp.body!, anthropicBody.model, anthropicBody), {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'request-id': `req_oai_${Date.now()}`,
          },
        })
      }

      const result = await resp.json()
      return new Response(JSON.stringify(translateNonStreamingResponse(result, anthropicBody.model)), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'request-id': `req_oai_${Date.now()}` },
      })
    } catch (e: any) {
      console.error(`[proxy] fetch error: ${e.message}`)
      return new Response(
        JSON.stringify({ type: 'error', error: { type: 'api_error', message: `Proxy fetch error: ${e.message}` } }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )
    }
  },
})

const actualPort = server.port

// Write actual port to file if --port-file was specified
if (PORT_FILE) {
  await Bun.write(PORT_FILE, String(actualPort))
}

console.log(`[proxy] Listening on http://localhost:${actualPort}`)
console.log(`[proxy] Upstream: ${COMPLETIONS_URL}`)
console.log(`[proxy] Context window: ${EFFECTIVE_CONTEXT_WINDOW}`)
if (DEFAULT_MODEL) console.log(`[proxy] Default model: ${DEFAULT_MODEL}`)
if (PORT_FILE) console.log(`[proxy] Port file: ${PORT_FILE}`)
