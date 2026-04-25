const PORT = 18080
const MOCK_TEXT = "[Mock] Claude Code 已启动，当前为模拟模式。"

function extractUserText(msgs: any[]): string {
  const last = msgs?.filter((m: any) => m.role === "user").pop()
  if (!last) return ""
  return typeof last.content === "string" ? last.content : last.content?.find?.((b: any) => b.type === "text")?.text || ""
}

function makeStream(model: string, text: string): string {
  const id = `msg_${Date.now()}`
  const reply = `${MOCK_TEXT}\n\n> 你说: ${text.slice(0,100)}`
  return [
    `event: message_start\ndata: ${JSON.stringify({type:"message_start",message:{id,type:"message",role:"assistant",content:[],model,stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}})}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({type:"content_block_start",index:0,content_block:{type:"text",text:""}})}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({type:"content_block_delta",index:0,delta:{type:"text_delta",text:reply}})}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({type:"content_block_stop",index:0})}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:20}})}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({type:"message_stop"})}\n\n`,
  ].join("")
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname.includes("/messages") && req.method === "POST") {
      const body = await req.json() as any
      const text = extractUserText(body.messages || [])
      console.log(`[mock] ${body.model} stream=${body.stream} "${text.slice(0,60)}"`)
      if (body.stream) return new Response(makeStream(body.model, text), {headers:{"Content-Type":"text/event-stream"}})
      return Response.json({id:`msg_${Date.now()}`,type:"message",role:"assistant",content:[{type:"text",text:`${MOCK_TEXT}\n\n> 你说: ${text.slice(0,100)}`}],model:body.model,stop_reason:"end_turn",stop_sequence:null,usage:{input_tokens:10,output_tokens:20}})
    }
    return Response.json({error:{type:"not_found",message:"mock"}}, {status:404})
  },
})
console.log(`Mock Anthropic API on http://localhost:${PORT}`)
