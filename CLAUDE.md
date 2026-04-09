# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

**OpenMAIC** (Open Multi-Agent Interactive Classroom) is an open-source AI platform that turns topics or documents into interactive classroom experiences — AI-generated slides, quizzes, simulations, and multi-agent discussions with TTS/ASR, whiteboard drawing, web search, and export to PPTX or interactive HTML.

## Commands

```bash
pnpm dev            # Start dev server (http://localhost:3000)
pnpm build          # Production build
pnpm lint           # ESLint
pnpm check          # Prettier check
pnpm format         # Prettier auto-format
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright E2E tests
npx tsc --noEmit    # Type-check only
```

Minimum setup: copy `.env.example` → `.env.local` and provide at least one LLM API key. `DEFAULT_MODEL` defaults to `anthropic:claude-3-5-haiku-20241022`.

Docker: `docker compose up --build` (runs on port 3000, mounts `openmaic-data:/app/data`).

## Architecture

### Request & Data Flow

```
Home page (topic input)
  → POST /api/generate-classroom         # submits async generation job
  → GET  /api/generate-classroom/[jobId] # polls for completion

Classroom page (/classroom/[id])
  → GET /api/classroom/[id]              # loads saved scenes
  → Playback engine drives state machine (idle → playing → live)
  → Action executor dispatches 28+ action types to canvas/whiteboard/audio

Multi-agent chat
  → POST /api/chat (SSE stream)
  → LangGraph DirectorGraph orchestrates agent turns
  → Vercel AI SDK streams text deltas + tool calls to client
```

### Key Directories

| Path | Role |
|---|---|
| `app/` | Next.js routes and API handlers |
| `app/api/` | ~18 API endpoints (generate, chat, export, media, etc.) |
| `lib/generation/` | Two-stage lesson pipeline: outline → scene content → actions |
| `lib/orchestration/` | LangGraph director graph for multi-agent chat |
| `lib/playback/` | Playback state machine (idle/playing/live) |
| `lib/action/` | Executes AI-generated actions on stage/canvas/whiteboard |
| `lib/ai/` | Unified LLM abstraction over 10+ providers via Vercel AI SDK |
| `lib/audio/` | TTS & ASR provider adapters |
| `lib/media/` | Image & video generation providers |
| `lib/store/` | 9 Zustand stores (canvas, stage, settings, whiteboard, etc.) |
| `lib/hooks/` | 55+ custom React hooks |
| `lib/server/` | Server-only utilities (provider config, model resolution, API responses) |
| `lib/export/` | PPTX generation and interactive HTML export |
| `lib/types/` | Centralized TypeScript types |
| `components/` | React UI components |
| `packages/` | Workspace packages: `pptxgenjs` (fork) and `mathml2omml` |

### Two-Stage Generation Pipeline

1. **Outline stage** (`lib/generation/outline-generator.ts`): LLM generates scene outlines from topic/materials via streaming JSON
2. **Content stage** (`lib/generation/scene-generator.ts`): Each outline scene is expanded into fully structured content (slides, quizzes, simulations)
3. **Action stage** (`lib/generation/action-parser.ts`): Scene content is parsed into discrete actions for playback; malformed JSON is repaired by `lib/generation/json-repair.ts`

### Multi-Agent Orchestration

`lib/orchestration/director-graph.ts` defines a LangGraph `StateGraph`. The director decides agent turn order; each agent uses Vercel AI SDK tool calls to perform web search, whiteboard drawing, TTS, etc. State is client-held — the server is stateless between requests.

### Provider Configuration

LLM, TTS, ASR, image, and video providers are configured via environment variables or `server-providers.yml` (server-side, not committed). Priority: `.env.local` > `server-providers.yml` > env. See `lib/server/provider-config.ts` for merge logic and `lib/ai/providers.ts` for provider registration.

## Code Style

- **Prettier**: 100-char line width, 2-space indent, single quotes, trailing commas — run `pnpm format` before committing
- **i18n required**: All user-facing strings must use i18next (`lib/i18n/`); current locales are `zh-CN` and `en-US`
- **No refactor-only PRs** (per CONTRIBUTING.md)

## Branch & PR Conventions

Branch prefixes: `feat/`, `fix/`, `docs/`. Pre-PR checks: `pnpm format && pnpm lint && npx tsc --noEmit && pnpm test`. Link PRs to related issues and include screenshots for UI changes.
