'use client'

import { useState } from 'react'
import type { ExerciseComponentProps } from '../types'

interface FlashcardInput {
  front: string
  back: string
  pronunciation?: string
  context?: string
}

interface FlashcardResult {
  rating: 'again' | 'hard' | 'good' | 'easy'
}

const RATINGS: { label: string; value: FlashcardResult['rating']; className: string }[] = [
  { label: 'Again', value: 'again', className: 'btn-rating-again' },
  { label: 'Hard', value: 'hard', className: 'btn-rating-hard' },
  { label: 'Good', value: 'good', className: 'btn-rating-good' },
  { label: 'Easy', value: 'easy', className: 'btn-rating-easy' },
]

export function Flashcard({ input, submitted, onSubmit }: ExerciseComponentProps<FlashcardInput, FlashcardResult>) {
  const [flipped, setFlipped] = useState(false)
  const [chosen, setChosen] = useState<FlashcardResult['rating'] | null>(null)

  const handleRate = (rating: FlashcardResult['rating']) => {
    setChosen(rating)
    onSubmit({ rating })
  }

  return (
    <div className="exercise-card">
      <div className="exercise-card-header">
        <span className="exercise-label">Flashcard</span>
      </div>
      <div
        className={`flashcard-face ${flipped ? 'flashcard-flipped' : ''}`}
        onClick={() => !submitted && setFlipped(f => !f)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && !submitted && setFlipped(f => !f)}
      >
        {!flipped ? (
          <div className="flashcard-front">
            <p className="flashcard-word">{input.front}</p>
            {!submitted && <p className="flashcard-hint">Tap to reveal</p>}
          </div>
        ) : (
          <div className="flashcard-back">
            <p className="flashcard-word">{input.back}</p>
            {input.pronunciation && <p className="flashcard-pronunciation">{input.pronunciation}</p>}
            {input.context && <p className="flashcard-context">{input.context}</p>}
          </div>
        )}
      </div>
      {flipped && !submitted && (
        <div className="rating-row">
          {RATINGS.map(r => (
            <button key={r.value} className={r.className} onClick={() => handleRate(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      {submitted && chosen && <p className="submitted-label">Rated: {chosen}</p>}
    </div>
  )
}
