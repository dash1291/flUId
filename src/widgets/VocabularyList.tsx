'use client'

import type { ExerciseComponentProps } from '../types'

interface VocabularyInput {
  words: Array<{ word: string; translation: string; pronunciation?: string; example?: string }>
}

export function VocabularyList({ input, submitted, onSubmit }: ExerciseComponentProps<VocabularyInput>) {
  return (
    <div className="exercise-card">
      <div className="exercise-card-header">
        <span className="exercise-label">Vocabulary</span>
      </div>
      <div className="vocab-grid">
        {input.words.map((word, i) => (
          <div key={i} className="vocab-item">
            <div className="vocab-word">{word.word}</div>
            {word.pronunciation && <div className="vocab-pronunciation">{word.pronunciation}</div>}
            <div className="vocab-translation">{word.translation}</div>
            {word.example && <div className="vocab-example">{word.example}</div>}
          </div>
        ))}
      </div>
      {!submitted
        ? <button className="btn-primary" onClick={() => onSubmit({ acknowledged: true })}>Got it</button>
        : <p className="submitted-label">Reviewed</p>
      }
    </div>
  )
}
