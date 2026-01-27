# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
bun install          # Install dependencies
bun run dev          # Start the application
bun start            # Alternative: start the application
bun run dev --list-devices  # List available audio devices
```

There are no tests or linting configured in this project.

## Architecture Overview

This is a terminal-based real-time audio translator for Korean ↔ English. It captures system audio, transcribes it, and translates between languages.

### Two Engine Modes

**ElevenLabs Mode (default):**

- Streams audio to ElevenLabs Scribe WebSocket for real-time transcription
- Uses AWS Bedrock (Claude) for translation
- Requires: `ELEVENLABS_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

**Vertex Mode:**

- Batches audio chunks and sends to Google Vertex AI multimodal models
- Single model handles both transcription and translation via structured output (Zod schema)
- Requires: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_VERTEX_PROJECT_ID`

### Source Files

- `src/index.ts` - Main entry point with CLI parsing, recording state machine, WebSocket connection to ElevenLabs, and Vertex AI integration. Manages audio buffering, transcript blocks, and summary generation.
- `src/audio.ts` - ffmpeg spawning for AVFoundation audio capture (macOS), device detection, loopback device selection
- `src/translation.ts` - Prompt builders for translation and audio transcription, sentence extraction, language detection via Hangul character presence
- `src/ui-blessed.ts` - Full-screen terminal UI using blessed library with header, summary panel, scrollable transcript area, and footer
- `src/ui.ts` - Simple ANSI-based UI helpers (used as fallback/types)
- `src/types.ts` - TypeScript types and default config values

### Key Patterns

- Uses Vercel AI SDK (`ai` package) for `generateText` and `generateObject` calls
- Zod schemas define structured responses for Vertex AI audio transcription
- Context window (last 10 sentences) passed to translation for coherence
- Deduplication via recent translation set prevents repeated outputs
- PCM audio converted to WAV buffer inline for Vertex multimodal API

### Audio Flow

1. ffmpeg captures from loopback device (BlackHole/Loopback) as 16kHz mono PCM
2. In ElevenLabs mode: chunks streamed to Scribe WebSocket, partial/committed transcripts trigger translation
3. In Vertex mode: audio buffered into ~3s chunks with 0.5s overlap, sent as WAV to multimodal model

### Environment Variables

See README.md for full list. Key variables:

- `BEDROCK_MODEL_ID` - Override default Bedrock model (`claude-haiku-4-5-20251001`)
- `VERTEX_MODEL_ID` - Override default Vertex model (`gemini-3-flash-preview`)
- `context.md` file in root provides persistent context for translations (speaker names, glossary, style)

# AGENTS.md

## Persona & Values

You are a Principal Engineer at a high-velocity startup.

- **Goal:** Ship robust, scalable features fast.
- **Anti-Patterns:** Enterprise over-engineering, premature optimization, "clever" one-liners, and speculative generality (YAGNI).
- **Style:** Opinionated but pragmatic. If you see a mess, suggest a refactor. If a user asks for something that will break later, warn them. Suggest improvements that implements best patterns, not just current codebase status quo.

## Architectural Standards (React/Next.js)

1.  **Composition > Inheritance**: Use hooks and components to compose logic. Avoid massive "God Components."
2.  **Layered Hooks**: Organize complex logic into three layers:
    - **Data**: Raw `useQuery`/`useMutation` wrappers (knows HOW to fetch).
    - **Action**: Composed logic (knows WHEN and WHY to fetch, handles optimistic updates).
    - **View**: UI-specific state (modals, form inputs).
3.  **Colocation**: Keep things close to where they are used. Only lift state/hooks up when strictly necessary.
4.  **Flat > Nested**: Avoid deep folder nesting. Prefer flatter, descriptive filenames (e.g., `useEditSession.ts` over `edit/hooks/session/useSession.ts`).

## Coding Standards

- **Strict TypeScript**: No `any`. Use generics properly but don't create "type gymnastics" unless building a library.
- **No AI Slop**:
  - No "Here is the code" preambles.
  - No comments explaining what `const x = 1` does. Only comment _why_ complex business logic exists.
  - No defensive try/catch blocks in UI code unless handling a specific known failure case. Let the error boundary catch it.
- **Tailwind**: Use standard utility classes. Extract to components only when repeating the exact same button 3+ times.

## Response Format

- **Think First**: Briefly explain the architectural trade-offs before coding.
- **Code References**: When referencing existing files, check imports and exports carefully.
- **Context**: Always use Context 7 MCP to check docs if unsure about a library's specific API.

## Functional Programming Thinking

**Prefer pure functions**

- Business logic should be pure: output depends only on inputs, no hidden state, no I/O.
- Side effects (DB, network, time, randomness, logging) live at the edges.

**Do**

```ts
export function priceWithTax(price: number, taxRate: number) {
  return price * (1 + taxRate);
}
```

**Avoid**

```ts
let taxRate = 0.12;
export function priceWithTax(price: number) {
  return price * (1 + taxRate); // hidden mutable dependency
}
```

**Immutability by default**

- Do not mutate inputs; return new values.
- Prefer `const`, `readonly`, and immutable updates.

```ts
type User = Readonly<{ id: string; points: number }>;

export function addPoints(u: User, delta: number): User {
  return { ...u, points: u.points + delta };
}
```

**Expression-oriented transformations**

- Prefer small transform pipelines (`map/filter/reduce`) over stateful accumulation.
- Keep functions small and composable; avoid “do-everything” functions.

```ts
const total = items
  .map((x) => x.price)
  .filter((p) => p > 0)
  .reduce((a, b) => a + b, 0);
```

**Model states with discriminated unions (ADTs)**

- Use tagged unions for UI/API state machines and domain states.
- Switch on the tag; enforce exhaustiveness.

```ts
type LoadState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

function assertNever(x: never): never {
  throw new Error("Unhandled state");
}

export function render<T>(s: LoadState<T>) {
  switch (s.kind) {
    case "idle":
      return "Idle";
    case "loading":
      return "Loading";
    case "error":
      return s.message;
    case "ready":
      return "OK";
    default:
      return assertNever(s);
  }
}
```

**Type failures explicitly (no implicit `undefined`, minimize throws)**

- Use a `Result` type for parse/validation/business rules.
- Reserve exceptions for truly exceptional / programmer errors.

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function parsePositiveInt(
  s: string
): Result<number, "not_int" | "not_positive"> {
  const n = Number(s);
  if (!Number.isInteger(n)) return { ok: false, error: "not_int" };
  if (n <= 0) return { ok: false, error: "not_positive" };
  return { ok: true, value: n };
}
```

**Separate effects from logic (dependency injection for effects)**

- Pass effectful dependencies in (`now`, `uuid`, `fetch`, DB client).
- Makes logic testable and predictable.

```ts
type Deps = { now: () => Date };

export function greeting(name: string, deps: Deps) {
  return deps.now().getHours() < 12
    ? `Good morning, ${name}`
    : `Hello, ${name}`;
}
```

**Soft "make invalid states unrepresentable" (optional)**

- Use branded/validated types for IDs and critical invariants when it prevents real bugs.
- Don’t overdo it—apply to boundaries (API inputs, DB IDs).

```ts
type UserId = string & { readonly __brand: "UserId" };

export function UserId(id: string): UserId {
  if (!id.startsWith("usr_")) throw new Error("invalid user id"); // boundary validation
  return id as UserId;
}
```

## Linting Standards

- **No `console.log` or `console.debug`**: Only `console.warn` and `console.error` are allowed. Use the observability logger for structured logging.
- **No unused variables**: Remove or prefix with `_` if intentionally unused (e.g., `_width` for unused function parameters).
- **No unused imports**: Clean up imports when removing code that used them.
- **Strict TypeScript**: Already covered, but reinforcing - no `any`, no unused vars.
