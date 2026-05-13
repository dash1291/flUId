'use client'

import { useState } from 'react'
import type { ExerciseComponentProps } from '../types'
import { isSkipped } from '../types'

interface ArrangeInput {
  words: string[]
  correct_order: string[]
  translation?: string
}

interface ArrangeResult {
  order: string[]
}

export function SentenceArrange({ input, submitted, result, onSubmit }: ExerciseComponentProps<ArrangeInput, ArrangeResult>) {
  const [available, setAvailable] = useState(() => [...input.words])
  const [arranged, setArranged] = useState<string[]>([])

  const addWord = (word: string, idx: number) => {
    if (submitted) return
    setAvailable(prev => prev.filter((_, i) => i !== idx))
    setArranged(prev => [...prev, word])
  }

  const removeWord = (word: string, idx: number) => {
    if (submitted) return
    setArranged(prev => prev.filter((_, i) => i !== idx))
    setAvailable(prev => [...prev, word])
  }

  const handleSubmit = () => {
    onSubmit({ order: arranged })
  }

  const skipped = isSkipped(result)
  const displayWords = submitted ? (skipped ? [] : (result?.order ?? arranged)) : arranged

  return (
    <div className="exercise-card">
      <div className="exercise-card-header">
        <span className="exercise-label">Arrange</span>
      </div>
      {input.translation && <p className="translation-hint">{input.translation}</p>}
      <div className="arrange-drop-zone">
        {displayWords.length === 0 && !submitted && (
          <span className="arrange-placeholder">Tap words below to build the sentence</span>
        )}
        {displayWords.length === 0 && submitted && skipped && (
          <span className="arrange-placeholder" style={{ opacity: 0.5 }}>—</span>
        )}
        {displayWords.map((word, idx) => (
          <button
            key={`${word}-${idx}`}
            className="word-chip-placed word-chip-disabled"
            onClick={() => removeWord(word, idx)}
            disabled={submitted}
          >
            {word}
          </button>
        ))}
      </div>
      {!submitted && (
        <div className="arrange-available">
          {available.map((word, idx) => (
            <button key={`${word}-${idx}`} className="word-chip-available" onClick={() => addWord(word, idx)}>
              {word}
            </button>
          ))}
        </div>
      )}
      {!submitted && (
        <button className="btn-primary" onClick={handleSubmit} disabled={arranged.length === 0}>Check</button>
      )}
    </div>
  )
}
