'use client'

import { useState } from 'react'
import type { ExerciseComponentProps } from '../types'
import { isSkipped } from '../types'

interface MultipleChoiceInput {
  question: string
  options: string[]
  correct_index: number
  explanation?: string
}

interface MultipleChoiceResult {
  selected_index: number
}

export function MultipleChoice({
  input,
  submitted,
  result,
  onSubmit,
}: ExerciseComponentProps<MultipleChoiceInput, MultipleChoiceResult>) {
  const [selected, setSelected] = useState<number | null>(result?.selected_index ?? null)

  const handleSelect = (idx: number) => {
    if (submitted) return
    setSelected(idx)
    onSubmit({ selected_index: idx })
  }

  const getOptionClass = (idx: number) => {
    if (!submitted) return selected === idx ? 'option-selected' : 'option-default'
    if (isSkipped(result)) return 'option-default option-disabled'
    if (idx === selected) return 'option-selected option-disabled'
    return 'option-default option-disabled'
  }

  return (
    <div className="exercise-card">
      <div className="exercise-card-header">
        <span className="exercise-label">Multiple Choice</span>
      </div>
      <p className="question-text">{input.question}</p>
      <div className="options-list">
        {input.options.map((opt, idx) => (
          <button key={idx} className={getOptionClass(idx)} onClick={() => handleSelect(idx)} disabled={submitted}>
            <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
            <span>{opt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
