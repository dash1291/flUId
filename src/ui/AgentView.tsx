'use client'

import { useEffect, useRef, useState, useCallback, useLayoutEffect, type ReactNode } from 'react'
import type { AgentConfig, ComponentRegistry } from '../types'
import { useAgent } from '../hooks/useAgent'
import { MessageBubble } from './MessageBubble'
import { ComponentHost } from './ComponentHost'

const PAGE_SIZE = 30

interface Props {
  agentConfig: AgentConfig
  registry: ComponentRegistry
  placeholder?: string
  toolbarRight?: ReactNode
}

interface SearchResult {
  language: string
  messageIndex: number
  role: string
  text: string
  snippet: string
}

export function AgentView({ agentConfig, registry, placeholder = 'Message your tutor...', toolbarRight }: Props) {
  const { displayItems, isStreaming, sendUserMessage, submitExerciseResult } =
    useAgent(agentConfig)

  const [input, setInput] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [serverResults, setServerResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const scrollStateRef = useRef<{ height: number; top: number } | null>(null)
  const isLoadingMoreRef = useRef(false)
  const prevLengthRef = useRef(displayItems.length)
  const isNearBottomRef = useRef(true)
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())
  const didInitScroll = useRef(false)

  const totalItems = displayItems.length
  const hasMore = totalItems > visibleCount && !searchQuery

  // Scroll to bottom on initial load when messages are restored
  useEffect(() => {
    if (!didInitScroll.current && displayItems.length > 0) {
      didInitScroll.current = true
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [displayItems])

  // Auto-scroll only when new messages arrive and user is already near the bottom
  useEffect(() => {
    const newLength = displayItems.length
    const lengthIncreased = newLength > prevLengthRef.current
    prevLengthRef.current = newLength

    if (lengthIncreased && isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [displayItems])

  // Restore scroll position after prepending older messages
  useLayoutEffect(() => {
    if (!scrollStateRef.current) return
    const container = scrollRef.current
    if (!container) return
    const newHeight = container.scrollHeight
    const { height, top } = scrollStateRef.current
    container.scrollTop = newHeight - height + top
    scrollStateRef.current = null
    requestAnimationFrame(() => {
      isLoadingMoreRef.current = false
    })
  })

  // Reverse infinite scroll: load older messages when the top sentinel scrolls into view
  useEffect(() => {
    if (searchQuery || !hasMore) return
    const sentinel = loadMoreRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !isLoadingMoreRef.current) {
          isLoadingMoreRef.current = true
          const container = scrollRef.current
          if (container) {
            scrollStateRef.current = {
              height: container.scrollHeight,
              top: container.scrollTop,
            }
          }
          setVisibleCount(prev => prev + PAGE_SIZE)
        }
      },
      { root: scrollRef.current, threshold: 0, rootMargin: '120px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, searchQuery])

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const threshold = 100
    isNearBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  }, [])

  const executeSearch = useCallback(() => {
    const query = searchInput.trim()
    if (query.length < 2) {
      setServerResults([])
      setSearchQuery('')
      return
    }
    setSearchQuery(query)
    setIsSearching(true)
    fetch('/api/agent/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, language: undefined }),
    })
      .then(r => r.json())
      .then(({ results }) => {
        setServerResults((results as SearchResult[]) ?? [])
      })
      .catch(() => {
        setServerResults([])
      })
      .finally(() => {
        setIsSearching(false)
      })
  }, [searchInput])

  const handleSend = () => {
    const text = input.trim()
    if (!text || inputBlocked) return
    setInput('')
    sendUserMessage(text)
  }

  const hasPendingExercises = displayItems.some(i => i.kind === 'exercise' && !i.submitted)
  const inputBlocked = isStreaming && !hasPendingExercises

  const setItemRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) itemRefs.current.set(id, el)
    else itemRefs.current.delete(id)
  }, [])

  const scrollToMessageIndex = useCallback((messageIndex: number) => {
    const targetId = displayItems.find(i => i.id.startsWith(`msg-${messageIndex}-`))?.id
    if (!targetId) return
    const el = itemRefs.current.get(targetId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [displayItems])

  const handleResultClick = useCallback((result: SearchResult) => {
    if (result.language !== (agentConfig.getRequestParams() as Record<string, unknown>).language) {
      // Navigate to other language conversation
      window.location.href = `/learn/${result.language}`
      return
    }
    // Load all messages so the match is visible
    setVisibleCount(Infinity)
    // Keep search query active so highlight shows
    scrollToMessageIndex(result.messageIndex)
  }, [agentConfig, scrollToMessageIndex])

  // Local highlight results within the current visible set
  const currentLang = (agentConfig.getRequestParams() as Record<string, unknown>).language as string | undefined
  const currentLangResults = serverResults.filter(r => r.language === currentLang)
  const otherLangResults = serverResults.filter(r => r.language !== currentLang)

  // Visible items for normal view (most recent N)
  const visibleItems = searchQuery
    ? displayItems.slice(Math.max(0, totalItems - visibleCount))
    : displayItems.slice(Math.max(0, totalItems - visibleCount))

  return (
    <div className="conversation-container">
      <div className="conversation-toolbar">
        <div className="toolbar-left">{toolbarRight}</div>
        <div className="toolbar-right">
          {isSearchOpen ? (
            <div className="search-bar">
              <input
                className="search-input"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && executeSearch()}
                placeholder="Search messages..."
                autoFocus
              />
              <button
                className="search-submit"
                onClick={executeSearch}
                disabled={!searchInput.trim() || isSearching}
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
              <button
                className="search-close"
                onClick={() => {
                  setSearchInput('')
                  setSearchQuery('')
                  setIsSearchOpen(false)
                  setServerResults([])
                  setVisibleCount(PAGE_SIZE)
                }}
              >
                Close
              </button>
            </div>
          ) : (
            <button className="search-toggle" onClick={() => setIsSearchOpen(true)}>
              Search
            </button>
          )}
        </div>
      </div>

      {isSearchOpen && (serverResults.length > 0 || searchQuery.trim().length >= 2) && (
        <div className="search-results-panel">
          {serverResults.length === 0 && searchQuery.trim().length >= 2 && !isSearching && (
            <div className="search-results-empty">No results found</div>
          )}
          {currentLangResults.length > 0 && (
            <div className="search-results-group">
              <div className="search-results-label">This conversation</div>
              {currentLangResults.map((r, i) => (
                <button
                  key={`current-${i}`}
                  className="search-result-item"
                  onClick={() => handleResultClick(r)}
                >
                  <span className={`search-result-role ${r.role}`}>{r.role}</span>
                  <span className="search-result-snippet">{r.snippet}</span>
                </button>
              ))}
            </div>
          )}
          {otherLangResults.length > 0 && (
            <div className="search-results-group">
              <div className="search-results-label">Other conversations</div>
              {otherLangResults.map((r, i) => (
                <button
                  key={`other-${i}`}
                  className="search-result-item"
                  onClick={() => handleResultClick(r)}
                >
                  <span className="search-result-language">{r.language}</span>
                  <span className={`search-result-role ${r.role}`}>{r.role}</span>
                  <span className="search-result-snippet">{r.snippet}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="conversation-scroll" ref={scrollRef} onScroll={handleScroll}>
        {!searchQuery && hasMore && (
          <div ref={loadMoreRef} className="load-more-sentinel">
            <span className="dot-flashing" />
          </div>
        )}

        {visibleItems.map(item => {
          if (item.kind === 'user_message') {
            return (
              <div key={item.id} ref={setItemRef(item.id)}>
                <MessageBubble
                  role="user"
                  text={item.text}
                  highlight={searchQuery}
                />
              </div>
            )
          }
          if (item.kind === 'assistant_text') {
            return (
              <div key={item.id} ref={setItemRef(item.id)}>
                <MessageBubble
                  role="assistant"
                  text={item.text}
                  isStreaming={item.isStreaming}
                  highlight={searchQuery}
                />
              </div>
            )
          }
          if (item.kind === 'exercise') {
            return (
              <div key={item.id} ref={setItemRef(item.id)} className="exercise-wrapper">
                <ComponentHost item={item} registry={registry} onSubmit={submitExerciseResult} />
              </div>
            )
          }
          return null
        })}

        {isStreaming && displayItems.every(i => i.kind !== 'assistant_text' || !i.isStreaming) && (
          <div className="message-row message-row-assistant">
            <div className="bubble-assistant bubble-thinking">
              <span className="dot-flashing" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="input-bar">
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={placeholder}
          disabled={inputBlocked}
        />
        <button
          className="send-button"
          onClick={handleSend}
          disabled={!input.trim() || inputBlocked}
        >
          Send
        </button>
      </div>
    </div>
  )
}
