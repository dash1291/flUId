import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { compactHistory, splitForCompaction } from '../src/server/compaction'
import { SUMMARY_PREFIX } from '../src/types'

const filler = 'x'.repeat(400)

const user = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] }) as unknown as AgentMessage

const exercise = (id: string) =>
  ({
    role: 'assistant',
    content: [
      { type: 'text', text: filler },
      { type: 'toolCall', id, name: 'show_exercise', arguments: {} },
    ],
  }) as unknown as AgentMessage

const answer = (id: string) =>
  ({
    role: 'toolResult',
    toolCallId: id,
    toolName: 'show_exercise',
    content: [{ type: 'text', text: filler }],
  }) as unknown as AgentMessage

const roles = (messages: AgentMessage[]) => messages.map(m => (m as { role: string }).role)

describe('splitForCompaction', () => {
  it('splits a conversation with a single user message at an assistant message', () => {
    const base = [user('start'), exercise('a'), answer('a'), exercise('b'), answer('b'), exercise('c'), answer('c')]

    const split = splitForCompaction(base, 150)

    expect(split).not.toBeNull()
    expect(roles(split!.older)).toEqual(['user', 'assistant', 'toolResult', 'assistant', 'toolResult'])
    expect(roles(split!.recent)).toEqual(['assistant', 'toolResult'])
  })

  it('never starts the kept part on a tool result', () => {
    const base = [user('start'), exercise('a'), answer('a'), exercise('b'), answer('b')]

    const split = splitForCompaction(base, 50)

    expect(roles(split!.recent)).toEqual(['assistant', 'toolResult'])
  })

  it('returns null when the whole history fits in the recent budget', () => {
    const base = [user('start'), exercise('a'), answer('a')]

    expect(splitForCompaction(base, 10_000)).toBeNull()
  })

  it('hands an earlier summary to the summarizer and leaves it out of the older messages', () => {
    const base = [user(SUMMARY_PREFIX + 'earlier lesson'), exercise('a'), answer('a'), exercise('b'), answer('b')]

    const split = splitForCompaction(base, 150)

    expect(split!.previousSummary).toBe('earlier lesson')
    expect(roles(split!.older)).toEqual(['assistant', 'toolResult'])
  })
})

describe('compactHistory', () => {
  const base = [user('start'), exercise('a'), answer('a'), exercise('b'), answer('b'), exercise('c'), answer('c')]

  it('leaves a history under the budget untouched', async () => {
    const summarize = async () => {
      throw new Error('should not be called')
    }

    const result = await compactHistory(base, { summarize, contextWindow: 10_000, reserveTokens: 0 }, 200_000)

    expect(result).toBe(base)
  })

  it('replaces the older messages with one summary message', async () => {
    const summarize = async () => 'the summary'

    const result = await compactHistory(
      base,
      { summarize, contextWindow: 300, reserveTokens: 0, keepRecentTokens: 150 },
      200_000,
    )

    expect(roles(result)).toEqual(['user', 'assistant', 'toolResult'])
    expect((result[0] as unknown as { content: { text: string }[] }).content[0].text).toBe(SUMMARY_PREFIX + 'the summary')
  })
})
