# flUId

A reusable chat UI framework for LLM-powered applications with interactive widgets. Built on the Pi agent harness, it provides streaming bubbles, reverse pagination, search UI, and localStorage persistence — leaving remote sync, search backends, and domain tools to your app.

## Philosophy

The LLM doesn't just chat — it can inject interactive widgets into the conversation, collect structured input from them, and continue the dialogue based on that input. The framework handles the React lifecycle, UI state, and persistence so you only worry about your domain (tools, prompts, widgets).

## The Stack

```
┌─────────────────────────────────────────┐
│  Your App                               │
│  (system prompt, tools, components)     │
├─────────────────────────────────────────┤
│  flUId  ←  YOU ARE HERE                 │
│  (chat UI, pagination, search, storage) │
├─────────────────────────────────────────┤
│  Pi Agent Harness                       │
│  (streaming, tool orchestration, LLM)   │
├─────────────────────────────────────────┤
│  LLM Provider APIs                      │
│  (Anthropic, OpenAI, Google, …)         │
└─────────────────────────────────────────┘
```

The Pi agent harness is a production-grade conversation engine (battle-tested in coding agents) that handles streaming deltas, tool call detection, and turn lifecycle (`prompt` / `continue`). The framework wraps that engine in a Next.js/React layer.

## Getting Started

Here is the smallest possible app you can build with flUId — a chatbot that can show an interactive poll widget.

### Step 1 — Install the framework and its peer dependencies

```bash
npm install @fluid/ui react react-dom next react-markdown @earendil-works/pi-agent-core @earendil-works/pi-ai
```

flUId is published as `@fluid/ui`, with its public API on the package root and a few subpath exports (`@fluid/ui/server`, `@fluid/ui/widgets`). All the imports below come from there.

### Step 2 — Create a tool definition

Tools are JSONSchema-described functions the LLM can call. Create `app/tools/pollTool.ts`:

```ts
import { Type } from '@earendil-works/pi-ai'

export function createPollTool(send: (event: object) => void) {
  return {
    name: 'show_poll',
    label: 'Poll',
    description: 'Display a poll with options for the user to vote on',
    parameters: Type.Object({
      question: Type.String(),
      options: Type.Array(Type.String(), { minItems: 2, maxItems: 4 }),
    }),
    execute: async (toolCallId: string, params: { question: string; options: string[] }) => {
      // Emit to the client so AgentView renders the matching component
      send({ type: 'tool_call', toolCallId, toolName: 'show_poll', args: params })
      // Pause the agent until the user submits their vote
      return { content: [], details: { __awaiting: toolCallId }, terminate: true }
    },
  }
}
```

### Step 3 — Create the React component

Create `app/components/Poll.tsx`. This is what the user sees when the LLM triggers the tool.

```tsx
'use client'

interface Props {
  input: { question: string; options: string[] }
  submitted: boolean
  result?: { selected_index: number }
  onSubmit: (result: { selected_index: number }) => void
}

export function Poll({ input, submitted, result, onSubmit }: Props) {
  return (
    <div style={{ border: '1px solid #ccc', padding: 16, borderRadius: 8 }}>
      <p><strong>{input.question}</strong></p>
      {input.options.map((opt, i) => (
        <button
          key={i}
          disabled={submitted}
          onClick={() => onSubmit({ selected_index: i })}
          style={{ margin: '0 8px 8px 0' }}
        >
          {opt} {submitted && result?.selected_index === i ? '✓' : ''}
        </button>
      ))}
    </div>
  )
}
```

### Step 4 — Wire up the server route

Create `app/api/agent/message/route.ts`:

```ts
import { createAgentRoute } from '@fluid/ui/server'
import { createPollTool } from '@/app/tools/pollTool'

export const POST = createAgentRoute({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  buildSystemPrompt: () =>
    'You are a friendly assistant. If you want to ask the user a multiple-choice question, use the show_poll tool.',
  buildTools: (_params, send) => [createPollTool(send)],
})
```

### Step 5 — Wire up the client page

Create `app/page.tsx`:

```tsx
import { AgentView } from '@fluid/ui'
import type { ComponentRegistry } from '@fluid/ui'
import { Poll } from './components/Poll'

const registry: ComponentRegistry = {
  show_poll: Poll,
}

export default function Home() {
  return (
    <AgentView
      agentConfig={{
        endpoint: '/api/agent/message',
        persistKey: 'myapp_chat',
        getRequestParams: () => ({}),
      }}
      registry={registry}
      placeholder="Say hello..."
    />
  )
}
```

### Step 6 — Run

```bash
npm run dev
```

Open the app, type "Ask me a question with a poll", and the LLM will stream a response, call `show_poll`, pause, wait for your click, and continue the conversation based on your answer.

## Directory Structure

```
src/
├── index.ts                 — Package root: re-exports the public API
├── hooks/
│   └── useAgent.ts          — React hook managing SSE streaming, tool calls, persistence
├── memory/
│   ├── localStorage.ts      — Browser storage helpers
│   └── types.ts             — IMemoryStore interface for domain-specific state
├── server/
│   └── createAgentRoute.ts  — Factory for creating Next.js API agent routes
├── types.ts                 — Core types: DisplayItem, AgentConfig, ComponentRegistry
├── ui/
│   ├── AgentView.tsx        — Chat shell with streaming bubbles, search, pagination
│   ├── ComponentHost.tsx    — Renders registered React components for tool calls
│   └── MessageBubble.tsx    — User / assistant message bubbles
└── widgets/                 — Optional ready-made widgets (see "Built-in Widgets")
    ├── Flashcard.tsx        FillBlank.tsx        LessonCard.tsx
    ├── MultipleChoice.tsx   SentenceArrange.tsx  TranslationChallenge.tsx
    └── VocabularyList.tsx
```

The public API is exported from the package root (`@fluid/ui`), with subpaths for `@fluid/ui/server`, `@fluid/ui/hooks`, `@fluid/ui/ui`, `@fluid/ui/types`, and `@fluid/ui/widgets`.

## Core Concepts

### 1. AgentConfig (what the app provides)

```ts
interface AgentConfig {
  endpoint: string                      // POST route for SSE messages
  persistKey?: string                  // localStorage key for conversation
  startTrigger?: string                // Optional auto-sent message on mount
  getRequestParams: () => object       // Extra JSON sent with each message
  onExerciseResult?: (tool, input, result) => void
  onConversationSave?: (messages) => void
  onTurnComplete?: (newMessages) => void
  onSessionEnd?: () => void
}
```

### 2. Tool Definition (what the server provides)

Tools are JSONSchema-described functions. The LLM decides when to call them.

`buildTools(params, send)` hands each tool the SSE `send` function, so tools
close over it (as in Step 2) rather than receiving it as an argument to `execute`:

```ts
import { Type } from '@earendil-works/pi-ai'

export function createQuizTool(send: (event: object) => void) {
  return {
    name: 'show_quiz',
    label: 'Quiz',
    description: 'Display an interactive quiz question',
    parameters: Type.Object({
      question: Type.String(),
      options: Type.Array(Type.String()),
      correct_index: Type.Number(),
    }),
    execute: async (toolCallId: string, params: { question: string; options: string[]; correct_index: number }) => {
      // Emit to client so AgentView renders the matching component
      send({ type: 'tool_call', toolCallId, toolName: 'show_quiz', args: params })
      // Signal the agent to pause until user submits
      return { content: [], details: { __awaiting: toolCallId }, terminate: true }
    },
  }
}
```

### 3. Component Registry (what the app provides)

Maps tool names to React components that handle user interaction.

```ts
import type { ComponentRegistry } from '@fluid/ui'

export const myRegistry: ComponentRegistry = {
  show_quiz: QuizComponent,
  show_chart: ChartComponent,
}
```

### 4. IMemoryStore (what the app provides)

Pluggable state tracker. Injected into the system prompt as context.

```ts
interface IMemoryStore {
  getContext(): string | null           // Returns context injected into system prompt
  recordExerciseResult(tool, input, result): void
  endSession(): void
}
```

## Server Route Factory

Instead of writing a custom API route, use the factory:

```ts
// app/api/agent/message/route.ts
import { createAgentRoute } from '@fluid/ui/server'

export const POST = createAgentRoute({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  buildSystemPrompt: (params) => `You are a ${params.domain} tutor...`,
  buildTools: (params, send) => [
    createQuizTool(send),
    // ... your other tool definitions
  ],
})
```

### Choosing a provider

`provider` and `model` are passed straight to Pi's `getModel()`, and the API key
is read from the environment via `getEnvApiKey(provider)`. Streaming defaults to
Anthropic. To use any other provider Pi supports, pass its stream function as
`streamFn` — Pi ships one per provider, all interchangeable:

```ts
import { streamSimpleOpenAIResponses } from '@earendil-works/pi-ai/openai-responses'

export const POST = createAgentRoute({
  provider: 'openai',
  model: 'gpt-5',
  streamFn: streamSimpleOpenAIResponses,
  buildSystemPrompt: () => '...',
  buildTools: () => [],
})
```

Each provider ships its stream function on a matching subpath of
`@earendil-works/pi-ai`:

| `provider` | `streamFn` import | Subpath |
|---|---|---|
| `anthropic` (default) | `streamSimpleAnthropic` | `@earendil-works/pi-ai/anthropic` |
| `openai` | `streamSimpleOpenAIResponses` | `@earendil-works/pi-ai/openai-responses` |
| `openai` (chat completions) | `streamSimpleOpenAICompletions` | `@earendil-works/pi-ai/openai-completions` |
| `google` | `streamSimpleGoogle` | `@earendil-works/pi-ai/google` |
| `google-vertex` | `streamSimpleGoogleVertex` | `@earendil-works/pi-ai/google-vertex` |
| `mistral` | `streamSimpleMistral` | `@earendil-works/pi-ai/mistral` |
| `amazon-bedrock` | `streamSimpleBedrock` | `@earendil-works/pi-ai/amazon-bedrock` |
| `azure-openai-responses` | `streamSimpleAzureOpenAIResponses` | `@earendil-works/pi-ai/azure-openai-responses` |

`getModel()` recognizes more providers than this — many (Groq, DeepSeek, xAI,
OpenRouter, Together, …) are OpenAI-completions-compatible and run through
`streamSimpleOpenAICompletions` with the appropriate `provider`/`model`. For the
authoritative, version-specific list, check Pi: `getProviders()` from
`@earendil-works/pi-ai`, or the `KnownProvider` type and the `/providers/*`
subpath exports in the installed package.

## Client Setup

```tsx
// app/page.tsx
import { AgentView } from '@fluid/ui'

function MyApp() {
  const agentConfig = {
    endpoint: '/api/agent/message',
    persistKey: 'myapp_conversation',
    getRequestParams: () => ({ domain: 'math' }),
    onSessionEnd: () => console.log('session ended'),
  }

  return (
    <AgentView
      agentConfig={agentConfig}
      registry={myComponentRegistry}
      placeholder="Ask your tutor..."
    />
  )
}
```

## Features Provided Out of the Box

- **Tool call lifecycle** — render widget → collect input → feed result back to LLM
- **Token-by-token streaming** of assistant responses over SSE
- **Windowed rendering** — renders only the most recent messages and reveals older
  ones as you scroll up (preserving scroll position), so long conversations stay fast
- **Message search UI** — search bar with result highlighting; it POSTs `{ query }`
  to `/api/agent/search` and renders the `{ results }` it returns. You implement
  that route against your own store (the search backend is not provided)
- **Auto-save** to localStorage, plus hooks for remote persistence (`onConversationSave`)
- **Queued messages** — type while the LLM is still streaming; the message auto-sends after the turn completes

## Built-in Widgets

You always provide your own `ComponentRegistry`, but flUId ships a set of
ready-made widgets you can drop straight into it (or use as templates). They are
plain `ExerciseComponentProps` components styled with themeable CSS custom
properties (see `styles.css`), currently oriented toward language learning:

```ts
import { MultipleChoice, Flashcard, FillBlank } from '@fluid/ui/widgets'
import type { ComponentRegistry } from '@fluid/ui'

const registry: ComponentRegistry = {
  show_multiple_choice: MultipleChoice,
  show_flashcard: Flashcard,
  show_fill_blank: FillBlank,
}
```

Available: `Flashcard`, `FillBlank`, `LessonCard`, `MultipleChoice`,
`SentenceArrange`, `TranslationChallenge`, `VocabularyList`. Each expects an
`input` shape matching its tool's parameters and reports back via `onSubmit`.

## What Apps Must Provide

| Concern | Provided by app |
|---|---|
| System prompt | `buildSystemPrompt` function |
| Tool definitions | `buildTools` function |
| Interactive widgets | React components in a `ComponentRegistry` |
| Message search | `/api/agent/search` route (if you enable the search UI) |
| Domain memory | `IMemoryStore` implementation |
| Auth / layout | App's own login, headers, menus |
| Database tables | App's own Supabase / DB schema |

## What You Can Build on This Framework

flUId is domain-agnostic — the tools, prompts, and widgets are yours. A few
illustrative shapes:

- **Fluid** (language learning) — `show_lesson`, `show_flashcard`, `show_fill_blank`, etc. (the built-in widgets target this domain)
- **Math tutor** — `show_problem`, `show_hint`, `draw_graph`
- **Coding coach** — `show_coding_problem`, `run_tests`, `complexity_analysis`
- **Fitness tracker** — `show_workout`, `log_set`, `show_progress_chart`

## Dependencies

Peer dependencies your app must install:

- `react` ^19
- `react-dom` ^19
- `next` ^16
- `react-markdown` ^10

The Pi packages (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`) ship as
direct dependencies of flUId, so they install automatically. Because your own
server route and tool code import from `@earendil-works/pi-ai` directly (for
`Type`, provider stream functions, etc.), installing it explicitly — as Step 1
does — keeps that import resolvable regardless of your package manager's hoisting.
