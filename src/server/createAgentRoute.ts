import { Agent } from '@earendil-works/pi-agent-core'
import { getModel, getEnvApiKey } from '@earendil-works/pi-ai'
import { streamSimpleAnthropic } from '@earendil-works/pi-ai/anthropic'
import type { StreamFunction } from '@earendil-works/pi-ai'
import type { AgentTool, AgentMessage } from '@earendil-works/pi-agent-core'

const encoder = new TextEncoder()

function sseChunk(event: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}

export interface AgentRouteConfig {
  /** Model provider name passed to getModel() and getEnvApiKey() */
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
  /**
   * Pi stream function matching `provider`. Pi ships one per provider, all
   * sharing the same SimpleStreamOptions shape, so any of them works here —
   * import the one you need, e.g.:
   *   import { streamSimpleOpenAIResponses } from '@earendil-works/pi-ai/openai-responses'
   *   import { streamSimpleGoogle } from '@earendil-works/pi-ai/google'
   * Defaults to Anthropic (`streamSimpleAnthropic`).
   */
  streamFn?: StreamFunction<any, any>
  /**
   * Returns the base conversation history. When it returns an array (possibly
   * empty), that array is the history and the request body's `messages` is
   * ignored; the client sends only the new delta (`newMessage` or `toolResult`).
   * When it returns `null`, the request body's `messages` is used instead.
   * Receives the request so it can read auth cookies.
   */
  loadHistory?: (
    params: Record<string, unknown>,
    request: Request,
  ) => Promise<AgentMessage[] | null>
  /**
   * Called with the full conversation after a turn settles, when `loadHistory`
   * returned a non-null array. Awaited before the response stream closes. Not
   * called when the request body's `messages` was used.
   */
  saveHistory?: (
    messages: AgentMessage[],
    params: Record<string, unknown>,
    request: Request,
  ) => Promise<void>
}

export function createAgentRoute(config: AgentRouteConfig) {
  return async function POST(request: Request): Promise<Response> {
    const body = await request.json()
    const { messages, newMessage, toolResult, ...params } = body as {
      messages: AgentMessage[]
      newMessage?: string
      toolResult?: AgentMessage
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
        runAgent({ messages, newMessage, toolResult, params, request }, config, send)
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

// Tool result messages from older client data may be missing the content array.
function withContent(messages: AgentMessage[]): AgentMessage[] {
  return messages.map(m =>
    (m as any).role === 'toolResult' && !(m as any).content ? { ...m, content: [] } : m,
  )
}

async function runAgent(
  runParams: {
    messages: AgentMessage[]
    newMessage?: string
    toolResult?: AgentMessage
    params: Record<string, unknown>
    request: Request
  },
  config: AgentRouteConfig,
  send: (event: object) => void,
) {
  const { newMessage, toolResult, params, request } = runParams

  let base: AgentMessage[]
  let serverAuthoritative = false
  if (config.loadHistory) {
    const loaded = await config.loadHistory(params, request)
    if (loaded != null) {
      base = loaded
      serverAuthoritative = true
    } else {
      base = runParams.messages ?? []
    }
  } else {
    base = runParams.messages ?? []
  }

  // The submitted tool result arrives as a delta; append it before continuing.
  if (toolResult) base = [...base, toolResult]

  const context = toSendableMessages(withContent(base))

  const model = getModel(config.provider as any, config.model as any)
  const tools = config.buildTools(params, send)
  const systemPrompt = config.buildSystemPrompt(params)

  const agent = new Agent({
    initialState: {
      model,
      systemPrompt,
      tools,
      messages: context,
    },
    getApiKey: () => getEnvApiKey(config.provider),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamFn: (config.streamFn ?? streamSimpleAnthropic) as any,
  })

  let newMsgs: AgentMessage[] = []
  agent.subscribe(event => {
    if (event.type === 'message_update') {
      const { assistantMessageEvent } = event
      if (assistantMessageEvent.type === 'text_delta') {
        send({ type: 'text_delta', delta: assistantMessageEvent.delta })
      }
    }
    if (event.type === 'agent_end') {
      newMsgs = event.messages
    }
  })

  if (newMessage) {
    await agent.prompt(newMessage)
  } else {
    await agent.continue()
  }

  const last = newMsgs[newMsgs.length - 1] as unknown as Record<string, unknown> | undefined
  if (last?.role === 'assistant' && last.stopReason === 'error') {
    // API failures end the turn normally with an empty assistant message;
    // without this the client renders nothing and the failure is invisible.
    console.error('Agent turn failed:', last.errorMessage)
    send({ type: 'error', message: String(last.errorMessage ?? 'Unknown agent error') })
  }

  // A paused exercise leaves a synthetic awaiting tool result; persist and send
  // the turn up to that point so the real result can be appended next request.
  const awaitingIdx = newMsgs.findIndex(
    m => (m as unknown as Record<string, unknown>).role === 'toolResult'
      && ((m as unknown as Record<string, unknown>).details as Record<string, unknown>)?.__awaiting,
  )
  const turnMsgs = awaitingIdx !== -1 ? newMsgs.slice(0, awaitingIdx) : newMsgs

  if (serverAuthoritative && config.saveHistory) {
    await config.saveHistory([...context, ...turnMsgs], params, request)
  }

  send({ type: awaitingIdx !== -1 ? 'paused' : 'done', messages: turnMsgs })
}
