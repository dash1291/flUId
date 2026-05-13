'use client'

import type { ExerciseComponentProps } from '../types'

interface LessonInput {
  title: string
  content: string
  examples?: Array<{ native: string; translation: string }>
}

export function LessonCard({ input, submitted, onSubmit }: ExerciseComponentProps<LessonInput>) {
  const paragraphs = input.content.split('\n').filter(Boolean)

  return (
    <div className="exercise-card">
      <div className="exercise-card-header">
        <span className="exercise-label">Lesson</span>
        <h3 className="exercise-title">{input.title}</h3>
      </div>
      <div className="lesson-content">
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {input.examples && input.examples.length > 0 && (
        <div className="examples-list">
          {input.examples.map((ex, i) => (
            <div key={i} className="example-row">
              <span className="example-native">{ex.native}</span>
              <span className="example-translation">{ex.translation}</span>
            </div>
          ))}
        </div>
      )}
      {!submitted
        ? <button className="btn-primary" onClick={() => onSubmit({ acknowledged: true })}>Got it</button>
        : <p className="submitted-label">Noted</p>
      }
    </div>
  )
}
