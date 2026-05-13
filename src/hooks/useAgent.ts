'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { lsGet, lsSet } from '../memory/localStorage'
import type { AgentConfig, DisplayItem } from '../types'

// Mirrors Pi message types (client-safe — not imported from the Pi server package)
interface PiTextContent { type: 'text'; text: string }
interface PiToolCall { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
interface PiUserMessage { role: 'user'; content: string | PiTextContent[] }
interface PiAssistantMessage { role: 'assistant'; content: (PiTextContent | { type: 'thinking' } | PiToolCall)[] }
interface PiToolResultMessage { role: 'toolResult'; toolCallId: string; toolName: string; content: unknown[]; isError: boolean; timestamp: number; details?: unknown }
type PiMessage = PiUserMessage | PiAssistantMessage | PiToolResultMessage

interface PersistedState {
  piMessages: PiMessage[]
}

// Used only for restoring from localStorage — not called during active streaming
function buildDisplayItems(messages: PiMessage[], startTrigger?: string): DisplayItem[] {
  const toolResults = new Map<string, unknown>()
  for (const msg of messages) {
    if (msg.role === 'toolResult') {
      toolResults.set(msg.toolCallId, msg.details)
    }
  }

  const items: DisplayItem[] = []
  let msgIdx = 0

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : (msg.content as PiTextContent[])
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('')
      if (text && text !== startTrigger) {
        items.push({ kind: 'user_message', id: `msg-${msgIdx}-user`, text })
      }
    } else if (msg.role === 'assistant') {
      let textIdx = 0
      for (const block of msg.content) {
        if (block.type === 'text') {
          const text = (block as PiTextContent).text
          if (text) {
            items.push({
              kind: 'assistant_text',
              id: `msg-${msgIdx}-text-${textIdx++}`,
              text,
              isStreaming: false,
            })
          }
        } else if (block.type === 'toolCall') {
          const tc = block as PiToolCall
          const submitted = toolResults.has(tc.id)
          items.push({
            kind: 'exercise',
            id: `msg-${msgIdx}-tool-${tc.id}`,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.arguments,
            submitted,
            result: submitted ? toolResults.get(tc.id) : undefined,
          })
        }
      }
    }
    msgIdx++
  }

  return items
}

function makeSkipResult(item: Extract<DisplayItem, { kind: 'exercise' }>): PiToolResultMessage {
  return { role: 'toolResult', toolCallId: item.toolCallId, toolName: item.toolName, content: [{ type: 'text', text: 'Exercise skipped.' }], isError: false, timestamp: Date.now(), details: { skipped: true } }
}

function isResolved(piMessages: PiMessage[], toolCallId: string): boolean {
  return piMessages.some(m => m.role === 'toolResult' && m.toolCallId === toolCallId)
}

function buildResultContent(toolName: string, result: unknown): string {
  const r = result as Record<string, unknown>
  switch (toolName) {
    case 'show_fill_blank':
    case 'show_translation':
      return `User submitted: "${r.answer}"`
    case 'show_multiple_choice':
      return `User selected index: ${r.selected_index}`
    case 'show_arrange':
      return `User arranged: [${(r.order as string[]).join(', ')}]`
    case 'show_flashcard':
      return `User self-rating: ${r.rating}`
    default:
      return JSON.stringify(result)
  }
}

export function useAgent(config: AgentConfig) {
  const configRef = useRef(config)
  configRef.current = config

  const piMessagesRef = useRef<PiMessage[]>([])

  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([])
  const displayItemsRef = useRef<DisplayItem[]>([])
  displayItemsRef.current = displayItems

  const [isStreaming, setIsStreaming] = useState(false)
  const isStreamingRef = useRef(false)

  const streamingTextIdRef = useRef<string | null>(null)
  // Message queued to send after current agent turn completes (already shown in UI)
  const pendingUserMessageRef = useRef<string | null>(null)

  function skipPendingExercises() {
    const pending = displayItemsRef.current.filter(
      (i): i is Extract<DisplayItem, { kind: 'exercise' }> => i.kind === 'exercise' && !i.submitted,
    )
    if (pending.length === 0) return

    for (const item of pending) {
      if (!isResolved(piMessagesRef.current, item.toolCallId)) {
        piMessagesRef.current = [...piMessagesRef.current, makeSkipResult(item)]
      }
    }
    setDisplayItems(prev =>
      prev.map(i =>
        i.kind === 'exercise' && !i.submitted
          ? { ...i, submitted: true, result: { skipped: true } }
          : i,
      ),
    )
  }

  function finalizeTurn(newMessages: PiMessage[], withTurnComplete?: boolean) {
    const fullMessages = [...piMessagesRef.current, ...newMessages]
    piMessagesRef.current = fullMessages
    setDisplayItems(prev =>
      prev.map(i =>
        i.kind === 'assistant_text' && i.isStreaming ? { ...i, isStreaming: false } : i,
      ),
    )
    const key = configRef.current.persistKey
    if (key) lsSet(key, { piMessages: fullMessages } satisfies PersistedState)
    try {
      configRef.current.onConversationSave?.(fullMessages)
    } catch (err) {
      console.error('onConversationSave error:', err)
    }
    if (withTurnComplete) {
      try {
        configRef.current.onTurnComplete?.(newMessages)
      } catch (err) {
        console.error('onTurnComplete error:', err)
      }
    }
  }

  const sendMessage = useCallback(async (text: string, visible: boolean) => {
    if (isStreamingRef.current) return
    isStreamingRef.current = true
    setIsStreaming(true)
    streamingTextIdRef.current = null
    let followUp: string | null = null

    if (visible) {
      setDisplayItems(prev => [
        ...prev,
        { kind: 'user_message', id: `user-${Date.now()}`, text },
      ])
    }

    const { endpoint, getRequestParams } = configRef.current
    const params = getRequestParams()

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: piMessagesRef.current,
          newMessage: text || undefined,
          ...params,
        }),
      })

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: Record<string, unknown>
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (event.type === 'text_delta') {
            const delta = event.delta as string
            const existingId = streamingTextIdRef.current
            if (existingId) {
              setDisplayItems(prev =>
                prev.map(item =>
                  item.kind === 'assistant_text' && item.id === existingId
                    ? { ...item, text: item.text + delta }
                    : item,
                ),
              )
            } else {
              const newId = `stream-text-${Date.now()}`
              streamingTextIdRef.current = newId
              setDisplayItems(prev => [
                ...prev,
                { kind: 'assistant_text', id: newId, text: delta, isStreaming: true },
              ])
            }
          }

          if (event.type === 'tool_call') {
            streamingTextIdRef.current = null
            setDisplayItems(prev => [
              ...prev,
              {
                kind: 'exercise',
                id: `stream-tool-${event.toolCallId}`,
                toolCallId: event.toolCallId as string,
                toolName: event.toolName as string,
                input: event.args as Record<string, unknown>,
                submitted: false,
              },
            ])
          }

          // Agent paused waiting for user input — tool result will come with the next request
          if (event.type === 'paused') {
            finalizeTurn(event.messages as PiMessage[])
            followUp = pendingUserMessageRef.current
            pendingUserMessageRef.current = null
          }

          if (event.type === 'done') {
            finalizeTurn(event.messages as PiMessage[], true)
            followUp = pendingUserMessageRef.current
            pendingUserMessageRef.current = null
          }

          if (event.type === 'error') {
            console.error('Agent error:', event.message)
          }
        }
      }
    } catch (err) {
      console.error('Stream read error:', err)
    } finally {
      isStreamingRef.current = false
      setIsStreaming(false)
      if (followUp) {
        skipPendingExercises()
        sendMessage(followUp, false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let restored: PiMessage[] = []
    const key = configRef.current.persistKey
    if (key) {
      const saved = lsGet<PersistedState>(key)
      restored = saved?.piMessages ?? []
    }

    if (restored.length > 0) {
      piMessagesRef.current = restored
      const items = buildDisplayItems(restored, configRef.current.startTrigger)
      setDisplayItems(items)
      displayItemsRef.current = items
    } else if (configRef.current.startTrigger) {
      sendMessage(configRef.current.startTrigger, false)
    }

    return () => {
      configRef.current.onSessionEnd?.()
    }
  // sendMessage is stable (useCallback with no deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendUserMessage = useCallback(
    (text: string) => {
      if (isStreamingRef.current) {
        // Agent is mid-run (streaming text) — show message and queue it
        setDisplayItems(prev => [
          ...prev,
          { kind: 'user_message', id: `user-${Date.now()}`, text },
        ])
        pendingUserMessageRef.current = text
        return
      }

      // Not streaming — skip any pending exercises by writing results directly to piMessages.
      skipPendingExercises()
      sendMessage(text, true)
    },
    [sendMessage],
  )

  const submitExerciseResult = useCallback((toolCallId: string, result: unknown) => {
    const item = displayItemsRef.current.find(
      i => i.kind === 'exercise' && i.toolCallId === toolCallId,
    )

    setDisplayItems(prev =>
      prev.map(i =>
        i.kind === 'exercise' && i.toolCallId === toolCallId
          ? { ...i, submitted: true, result }
          : i,
      ),
    )

    if (!item || item.kind !== 'exercise') return

    configRef.current.onExerciseResult?.(item.toolName, item.input, result)

    const resolved = isResolved(piMessagesRef.current, toolCallId)
    if (resolved) return

    piMessagesRef.current = [
      ...piMessagesRef.current,
      { role: 'toolResult', toolCallId, toolName: item.toolName, content: [{ type: 'text', text: buildResultContent(item.toolName, result) }], isError: false, timestamp: Date.now(), details: result },
    ]
    // Empty string is falsy — server calls agent.continue() instead of agent.prompt()
    sendMessage('', false)
  }, [sendMessage])

  return { displayItems, isStreaming, sendUserMessage, submitExerciseResult }
}
