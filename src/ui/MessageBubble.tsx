'use client'

import Markdown from 'react-markdown'

interface Props {
  role: 'user' | 'assistant'
  text: string
  isStreaming?: boolean
  highlight?: string
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="search-highlight">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

export function MessageBubble({ role, text, isStreaming, highlight }: Props) {
  if (!text && !isStreaming) return null

  return (
    <div className={`message-row ${role === 'user' ? 'message-row-user' : 'message-row-assistant'}`}>
      <div className={role === 'user' ? 'bubble-user' : 'bubble-assistant'}>
        {highlight ? (
          <HighlightedText text={text} query={highlight} />
        ) : role === 'assistant' ? (
          <Markdown>{text}</Markdown>
        ) : (
          text
        )}
        {isStreaming && <span className="streaming-cursor" />}
      </div>
    </div>
  )
}
