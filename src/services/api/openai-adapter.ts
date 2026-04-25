/**
 * OpenAI-compatible API adapter for Claude Code.
 * Intercepts Anthropic SDK HTTP requests and translates to/from OpenAI format.
 *
 * Env vars:
 *   OPENAI_API_KEY     - API key for the OpenAI-compatible service
 *   OPENAI_BASE_URL    - Base URL (e.g. https://api.example.com/v1)
 */

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
  // Clamp max_tokens so that input_tokens + max_tokens <= context window.
  // OpenAI-compatible servers (GLM, etc.) reject requests where the total exceeds
  // the model's context length with a 400 error, unlike Anthropic's server which
  // handles this gracefully. We estimate input tokens from message text length
  // (4 chars/token) and leave a safety margin.
  let maxTokens = anthropicBody.max_tokens
  const contextWindow = parseInt(process.env.OPENAI_CONTEXT_WINDOW || '0', 10)
  if (contextWindow > 0 && maxTokens > 0) {
    const estimatedInputTokens = Math.ceil(
      JSON.stringify(anthropicBody.messages || []).length / 4
    )
    const safetyMargin = 1024
    const cappedMax = contextWindow - estimatedInputTokens - safetyMargin
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
                // Open a new tool_use block when: new tool call name arrives AND it's a different tc index
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

export function isOpenAIProvider(): boolean {
  return !!process.env.OPENAI_API_KEY
}

export function createOpenAIFetch(baseURL: string, apiKey: string): typeof globalThis.fetch {
  const completionsURL = baseURL.replace(/\/+$/, '') + '/chat/completions'

  return (async (input: any, init: any) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/messages')) return globalThis.fetch(input, init)

    const anthropicBody = JSON.parse(typeof init?.body === 'string' ? init.body : new TextDecoder().decode(init?.body as any))
    const isStream = !!anthropicBody.stream
    const openaiBody = buildOpenAIBody(anthropicBody)

    const resp = await globalThis.fetch(completionsURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(openaiBody),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `OpenAI API error (${resp.status}): ${errText}` } }), { status: resp.status, headers: { 'Content-Type': 'application/json' } })
    }

    if (isStream) {
      return new Response(translateStreamingResponse(resp.body!, anthropicBody.model, anthropicBody), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'request-id': `req_oai_${Date.now()}` },
      })
    }

    const result = await resp.json()
    return new Response(JSON.stringify(translateNonStreamingResponse(result, anthropicBody.model)), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'request-id': `req_oai_${Date.now()}` },
    })
  }) as typeof globalThis.fetch
}
