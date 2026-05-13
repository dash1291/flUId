export interface IMemoryStore {
  // Returns a context string injected into the system prompt. Null for new users.
  getContext(): string | null

  // Called after each exercise is completed
  recordExerciseResult(
    toolName: string,
    input: Record<string, unknown>,
    result: unknown,
  ): void

  // Called when the session ends (component unmount or explicit end)
  endSession(): void
}
