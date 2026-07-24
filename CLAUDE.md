# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RebelAI is a self-hostable BYOK (Bring Your Own Key) character chat platform built with Next.js 15 App Router, Supabase (PostgreSQL + Vault + Auth + Realtime + Storage), Vercel AI SDK 5, and Tailwind CSS 3.4. Users manage their own LLM API keys. RBX is the native character package format; Safe UGC UI (SUU) renders declarative character UI.

## Commands

```bash
npm run dev              # Dev server (localhost:3000)
npm run build            # Production build
npm run lint             # ESLint (next/core-web-vitals + next/typescript + prettier)
npm run format:check     # Prettier check
npm run format           # Prettier write
npm run test             # Vitest (unit + integration)
npm run test -- path     # Single test file
npm run test:rls         # RLS policy tests (requires `supabase start`)
npm run test:vault       # Vault security test (requires .env.local)
npm run typecheck        # Type check (next typegen + tsc --noEmit)
npm run db:types         # Push local migrations + regenerate database.generated.ts
npm run chat:jobs        # Manually drain chat job queue
npm run character:jobs   # Manually drain character import job queue
```

## Code Style

- TypeScript-first, Prettier-formatted: 2-space indent, no semicolons, single quotes, trailing commas, `printWidth: 100`
- ESLint: `next/core-web-vitals` + `next/typescript` + `prettier`
- Components: PascalCase (`CharacterDetailView.tsx`); hooks: `useX.ts`; utilities: lowercase (`model-config.ts`)
- Import alias: `@/` maps to `src/`

## Architecture

### Request Flow (Chat)

1. Client → `POST /api/chat` (Node runtime) → saves user message, enqueues job in `chat_generation_jobs` table → returns `202 { jobId }`
2. External scheduler or manual trigger → `/api/internal/chat-job-runner/trigger` → `/api/internal/chat-job-runner` (Node runtime) picks up pending jobs
3. Runner: decrypts user's API key via Vault → `streamText` (AI SDK) → INSERTs first chunk, UPDATEs to accumulate content → Realtime broadcasts to subscribed clients
4. Client polls `GET /api/chat/jobs/[jobId]` (Edge) as backup for completion/token stats

### Character Import Flow

1. Client uploads `.rbx` → `POST /api/characters/import/storage` → staged storage + background job
2. External scheduler or manual trigger → `/api/internal/character-import-runner/trigger` → runner downloads, parses RBX, creates character/assets/modules, cleans up staged files

### Deployment Notes

- This repository does not ship active Vercel cron entries by default.
- Vercel Pro can use built-in cron, but Vercel Hobby should use an external scheduler.
- Verified low-cost reference setup on April 7, 2026: `Vercel Hobby + Supabase Free + cron-job.org`, with character import and queued chat generation working end-to-end.
- `npm run chat:jobs` and `npm run character:jobs` are the manual fallback paths for draining the background queues.

### Key Modules

| Module                                      | Purpose                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/lib/chat/`                             | Job queue, system prompt composition, rate limiting, model config, bilingual context, summaries trigger  |
| `src/lib/chat-summaries.ts`                 | 2-tier summary pipeline (chunk→meta), context window compression                                         |
| `src/lib/rbx-parser.ts` / `rbx-importer.ts` | RBX package parsing and import logic                                                                     |
| `src/lib/llm/`                              | Provider-specific options, prompt caching, model factory, Google cache                                   |
| `src/lib/providers/catalog.ts`              | Model catalog with pricing and capability metadata                                                       |
| `src/lib/lorebook/`                         | Lorebook runtime: always-active entries, simple keyword activation, overrides, and prompt block assembly |
| `src/lib/supabase/`                         | Client/Server/Admin Supabase client helpers                                                              |
| `src/lib/security/`                         | XSS defense, input sanitization                                                                          |
| `src/lib/internal-api-origin.ts`            | Trusted origin resolution for Edge→Node internal calls                                                   |
| `src/lib/embeddings.ts`                     | Voyage AI embeddings for episodic memory RAG                                                             |

### Runtime Split

- **Node runtime**: `/api/chat`, `/api/internal/*` (job runners, maintenance routes, internal triggers) — anything that touches secrets or does LLM calls
- **Edge runtime**: lightweight routes like job status (`/api/chat/jobs/[jobId]`), icon serving

### Internal API Auth

- `CHAT_ADMIN_SECRET`: internal runner, maintenance route, and trigger → runner bearer auth
- `CRON_SECRET`: bearer token used by external schedulers or Vercel Cron to call trigger routes
- `INTERNAL_API_ORIGIN`: trusted origin for internal calls (required in production)
- Use `buildInternalApiUrl()` from `src/lib/internal-api-origin.ts` for all internal API calls

### Database

- Supabase PostgreSQL with RLS on all user-facing tables
- Vault for encrypted API key storage
- Realtime for chat streaming + token stats updates
- Migrations in `supabase/migrations/` (numbered sequentially)
- Schema documented in `DATABASE_SCHEMA.md`

## Testing

- Place unit tests next to source: `foo.test.ts` alongside `foo.ts`
- Cross-cutting tests go in `tests/` (security, announcements, API, mocks)
- `server-only` package is mocked in `tests/__mocks__/server-only.ts` for Vitest
- RLS tests (`src/lib/rls/`) require local Supabase running
- When changing API routes, queue runners, RBX import, or Supabase policies, add or update tests

## Commit Style

Short imperative subjects: `Fix ...`, `Add ...`, `Switch ...`. Occasional conventional prefix (`fix:`, `feat:`) is fine. Mention migration or env-var impact when relevant.
