import { Agent } from '@earendil-works/pi-agent-core'
import { getModel, getEnvApiKey } from '@earendil-works/pi-ai'
import { streamSimpleAnthropic } from '@earendil-works/pi-ai/anthropic'
import type { AgentTool, AgentMessage } from '@earendil-works/pi-agent-core'

const encoder = new TextEncoder()

function sseChunk(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

export interface AgentRouteConfig {
  /** Model provider name passed to getModel() */
  provider: string
  /** Model name passed to getModel() */
  model: string
  /** Function that builds the system prompt from request params */
  buildSystemPrompt: (params: Record<string, unknown>) => string
  /** Function that builds the tool list from request params and the SSE send function */
  buildTools: (
    params: Record<string, unknown>,
    send: (event: object) => void,
  ) => AgentTool<any>[]
}

export function createAgentRoute(config: AgentRouteConfig) {
  return async function POST(request: Request): Promise<Response> {
    const body = await request.json()
    const { messages, newMessage, ...params } = body as {
      messages: AgentMessage[]
      newMessage?: string
    } & Record<string, unknown>

    let ctrl!: ReadableStreamDefaultController<Uint8Array>

    const send = (event: object) => {
      try {
        ctrl.enqueue(sseChunk(event))
      } catch {
        // stream already closed
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        runAgent({ messages, newMessage, params }, config, send)
          .catch(err => {
            send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
          })
          .finally(() => c.close())
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }
}

// The API validates every tool_use/tool_result pair in every request and
// rejects the whole conversation on any mismatch. Stored histories may carry
// such inconsistencies (e.g. an interrupted stream left a tool result without
// its tool call); they are tolerated, not repaired — this only skips what the
// API would reject when building the request. Stored data is never touched.
function toSendableMessages(messages: AgentMessage[]): AgentMessage[] {
  const out: Record<string, any>[] = []
  // Tool calls from the latest assistant message still awaiting a result
  const open = new Map<string, string>()

  const closeOpen = () => {
    for (const [id, name] of open) {
      out.push({
        role: 'toolResult',
        toolCallId: id,
        toolName: name,
        content: [{ type: 'text', text: 'No result recorded.' }],
        isError: false,
        timestamp: Date.now(),
      })
    }
    open.clear()
  }

  for (const m of messages as Record<string, any>[]) {
    if (m.role === 'toolResult') {
      if (open.has(m.toolCallId)) {
        open.delete(m.toolCallId)
        out.push(m)
      } else {
        console.warn('Skipping orphaned tool result:', m.toolCallId, m.toolName)
      }
      continue
    }
    closeOpen()
    out.push(m)
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block?.type === 'toolCall') open.set(block.id, block.name)
      }
    }
  }
  closeOpen()
  return out as AgentMessage[]
}

async function runAgent(
  runParams: {
    messages: AgentMessage[]
    newMessage?: string
    params: Record<string, unknown>
  },
  config: AgentRouteConfig,
  send: (event: object) => void,
) {
  const { newMessage, params } = runParams
  // Ensure tool result messages always have content array (old client data may be missing it)
  const messages = toSendableMessages((runParams.messages ?? []).map(m => {
    if ((m as any).role === 'toolResult' && !(m as any).content) {
      return { ...m, content: [] }
    }
    return m
  }))

  const model = getModel(config.provider as any, config.model as any)
  const tools = config.buildTools(params, send)
  const systemPrompt = config.buildSystemPrompt(params)

  const agent = new Agent({
    initialState: {
      model,
      systemPrompt,
      tools,
      messages: messages ?? [],
    },
    getApiKey: () => getEnvApiKey(config.provider),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamFn: streamSimpleAnthropic as any,
  })

  agent.subscribe(event => {
    if (event.type === 'message_update') {
      const { assistantMessageEvent } = event
      if (assistantMessageEvent.type === 'text_delta') {
        send({ type: 'text_delta', delta: assistantMessageEvent.delta })
      }
    }
    if (event.type === 'agent_end') {
      const msgs = event.messages
      const last = msgs[msgs.length - 1] as unknown as Record<string, unknown> | undefined
      if (last?.role === 'assistant' && last.stopReason === 'error') {
        // API failures end the turn normally with an empty assistant message;
        // without this the client renders nothing and the failure is invisible.
        console.error('Agent turn failed:', last.errorMessage)
        send({ type: 'error', message: String(last.errorMessage ?? 'Unknown agent error') })
      }
      const awaitingIdx = msgs.findIndex(
        m => (m as unknown as Record<string, unknown>).role === 'toolResult'
          && ((m as unknown as Record<string, unknown>).details as Record<string, unknown>)?.__awaiting,
      )
      if (awaitingIdx !== -1) {
        send({ type: 'paused', messages: msgs.slice(0, awaitingIdx) })
      } else {
        send({ type: 'done', messages: msgs })
      }
    }
  })

  if (newMessage) {
    await agent.prompt(newMessage)
  } else {
    await agent.continue()
  }
}
