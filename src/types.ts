// UI display items

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DisplayItem =
  | { kind: 'user_message'; id: string; text: string }
  | { kind: 'assistant_text'; id: string; text: string; isStreaming: boolean }
  | {
      kind: 'exercise'
      id: string
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result?: any
      submitted: boolean
    }

// Component registry — maps tool names to React components

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ExerciseComponentProps<TInput = any, TResult = any> {
  input: TInput
  submitted: boolean
  result?: TResult
  onSubmit: (result: TResult) => void
}

export type ExerciseComponent = React.ComponentType<ExerciseComponentProps>

export type ComponentRegistry = Record<string, ExerciseComponent>

export function isSkipped(result?: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as Record<string, unknown>).skipped === true
}

// Agent config passed to useAgent

export interface AgentConfig {
  endpoint: string
  getRequestParams: () => Record<string, unknown>
  startTrigger?: string
  persistKey?: string
  onExerciseResult?: (
    toolName: string,
    input: Record<string, unknown>,
    result: unknown,
  ) => void
  onTurnComplete?: (newMessages: unknown[]) => void
  onConversationSave?: (fullMessages: unknown[]) => void
  onSessionEnd?: () => void
}
