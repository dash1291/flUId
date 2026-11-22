import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { SUMMARY_PREFIX } from '../types'

export interface CompactionConfig {
  summarize: (
    conversationText: string,
    previousSummary: string | null,
  ) => Promise<string>
  /** Token budget the context is kept under. Default: model.contextWindow ?? 200000. */
  contextWindow?: number
  /** Tokens left as headroom; compaction triggers above contextWindow - reserveTokens. Default 16384. */
  reserveTokens?: number
  /** Recent tokens kept verbatim; older ones are summarized. Default 20000. */
  keepRecentTokens?: number
}

// Returns the summary text of a summary message, or null if m is not one.
function summaryText(m: AgentMessage): string | null {
  const mm = m as any
  if (mm.role !== 'user') return null
  const text =
    typeof mm.content === 'string'
      ? mm.content
      : Array.isArray(mm.content)
        ? mm.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
        : ''
  return text.startsWith(SUMMARY_PREFIX) ? text.slice(SUMMARY_PREFIX.length) : null
}

// Role-tagged text of a conversation, including tool calls and results. Used
// for token estimation and as summarizer input.
export function serializeForSummary(messages: AgentMessage[]): string {
  const parts: string[] = []
  for (const m of messages as any[]) {
    if (m.role === 'user') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : (m.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
      if (text) parts.push(`[User]: ${text}`)
    } else if (m.role === 'assistant') {
      for (const b of m.content ?? []) {
        if (b?.type === 'text' && b.text) parts.push(`[Assistant]: ${b.text}`)
        else if (b?.type === 'toolCall') parts.push(`[Assistant used ${b.name}]: ${JSON.stringify(b.arguments)}`)
      }
    } else if (m.role === 'toolResult') {
      const text = (m.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
      if (text) parts.push(`[${m.toolName} result]: ${text}`)
    }
  }
  return parts.join('\n')
}

export function estimateTokens(messages: AgentMessage[]): number {
  return Math.ceil(serializeForSummary(messages).length / 4)
}

// Splits base into the older messages to summarize and the recent ones to
// keep, about keepRecentTokens of the tail. Returns null when there is nothing
// to summarize.
export function splitForCompaction(
  base: AgentMessage[],
  keepRecentTokens: number,
): { older: AgentMessage[]; recent: AgentMessage[]; previousSummary: string | null } | null {
  let start = 0
  let previousSummary: string | null = null
  const leading = base.length > 0 ? summaryText(base[0]) : null
  if (leading !== null) {
    previousSummary = leading
    start = 1
  }

  let acc = 0
  let cut = base.length
  for (let i = base.length - 1; i >= start; i--) {
    acc += estimateTokens([base[i]])
    if (acc >= keepRecentTokens) {
      cut = i
      break
    }
  }
  if (cut >= base.length) return null
  // A tool result must stay with the assistant message that made the call, so
  // the kept part never starts on one.
  while (cut > start && (base[cut] as any).role === 'toolResult') cut--

  const older = base.slice(start, cut)
  const recent = base.slice(cut)
  if (older.length === 0 || recent.length === 0) return null
  return { older, recent, previousSummary }
}

function makeSummaryMessage(summary: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: SUMMARY_PREFIX + summary }],
    timestamp: Date.now(),
  } as unknown as AgentMessage
}

export async function compactHistory(
  base: AgentMessage[],
  compaction: CompactionConfig,
  modelContextWindow: number,
): Promise<AgentMessage[]> {
  const window = compaction.contextWindow ?? modelContextWindow
  const reserve = compaction.reserveTokens ?? 16384
  const keepRecent = compaction.keepRecentTokens ?? 20000
  if (estimateTokens(base) <= window - reserve) return base

  const split = splitForCompaction(base, keepRecent)
  if (!split) return base

  const summary = await compaction.summarize(serializeForSummary(split.older), split.previousSummary)
  return [makeSummaryMessage(summary), ...split.recent]
}
