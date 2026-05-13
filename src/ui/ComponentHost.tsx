'use client'

import type { ComponentRegistry, DisplayItem } from '../types'

interface Props {
  item: Extract<DisplayItem, { kind: 'exercise' }>
  registry: ComponentRegistry
  onSubmit: (toolCallId: string, result: unknown) => void
}

export function ComponentHost({ item, registry, onSubmit }: Props) {
  const Component = registry[item.toolName]

  if (!Component) {
    console.warn(`No component registered for tool: ${item.toolName}`)
    return null
  }

  return (
    <Component
      input={item.input}
      submitted={item.submitted}
      result={item.result}
      onSubmit={(result: unknown) => onSubmit(item.toolCallId, result)}
    />
  )
}
