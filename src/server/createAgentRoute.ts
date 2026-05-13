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
  const messages = (runParams.messages ?? []).map(m => {
    if ((m as any).role === 'toolResult' && !(m as any).content) {
      return { ...m, content: [] }
    }
    return m
  })

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
