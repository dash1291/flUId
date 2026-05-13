'use client'

import { useState } from 'react'
import type { ExerciseComponentProps } from '../types'
import { isSkipped } from '../types'

interface TranslationInput {
  prompt: string
  direction: 'to_target' | 'to_native'
  correct_answer: string
  acceptable_answers?: string[]
}

interface TranslationResult {
  answer: string
}

export function TranslationChallenge({ input, submitted, result, onSubmit }: ExerciseComponentProps<TranslationInput, TranslationResult>) {
  const [answer, setAnswer] = useState(result?.answer ?? '')
  const skipped = isSkipped(result)

  return (
    <div className="exercise-card">
      <div className="exercise-card-header">
        <span className="exercise-label">Translation</span>
        <span className="direction-label">
          {input.direction === 'to_target' ? 'Translate to target language' : 'Translate to English'}
        </span>
      </div>
      <p className="prompt-text">{input.prompt}</p>
      {!submitted ? (
        <textarea
          className="translation-input"
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder="Type your translation..."
          rows={2}
          autoFocus
        />
      ) : skipped ? (
        <div className="translation-result result-skipped">—</div>
      ) : (
        <div className="translation-result result-submitted">{result?.answer ?? answer}</div>
      )}
      {!submitted && (
        <button className="btn-primary" onClick={() => onSubmit({ answer: answer.trim() })} disabled={!answer.trim()}>
          Check
        </button>
      )}
    </div>
  )
}
