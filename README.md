# RebelAI

**Open-source, self-hosted character chat — your keys, your data, your server.**

[![CI](https://github.com/devforai-creator/rebel-ai/actions/workflows/test.yml/badge.svg)](https://github.com/devforai-creator/rebel-ai/actions/workflows/test.yml)
[![Version](https://img.shields.io/badge/version-0.9.3-blue)](#)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

> **v0.9.3** — A character chat web app you deploy on your own infrastructure.
> Bring your own API keys to control costs. Keep conversations and characters in your own database.
> Runs on free-tier cloud (Vercel Hobby + Supabase Free) or your own stack.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdevforai-creator%2Frebel-ai&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,CHAT_ADMIN_SECRET,SUMMARY_GENERATION_SECRET,CRON_SECRET,INTERNAL_API_ORIGIN)

[**🚀 Getting Started Guide**](./docs/GETTING_STARTED.md) — _New to RebelAI? Start here!_
[**🧭 Hosting Profiles**](./docs/HOSTING_PROFILES.md) — _Managed production vs low-cost self-hosting_

---

## Overview

An open-source character chat web app that runs on your own infrastructure. You bring your own LLM API keys, and your conversations, characters, and data stay in your own database — nothing is hosted by a third party.

Web-based by design: server-side long-term memory, background chat generation, and cross-device access are architectural choices, not add-ons. **RBX** is the native character package format, and **Safe UGC UI (SUU)** renders declarative character UI without script execution.

### Key Features

- 🔑 **BYOK Architecture** - API keys encrypted via Vault, user-controlled costs + OpenAI Standard/Flex service tier selection
- ⚠️ **Managed vs Self-Hosted** - Vercel + Supabase Pro is the easiest production path, but low-cost self-hosting is supported with an external scheduler/worker and host-aware import limits.
- 💾 **Prompt Caching** - Shared caching strategy for supported LLM providers:
  - **OpenAI**: Fixed cache keys per operation (`chat:…`, `summary:…`) with 24-hour retention
  - **Anthropic**: Prefix-aware cache control for stable memory plans, including a switchable prefix-optimized chat mode for long conversations
  - **Google / DeepSeek**: Provider-native caching behavior where available
- 📦 **RBX Native Format** - RebelAI's native `.rbx` package is the recommended format for new cards: portable manifests, explicit asset references, declarative UI, and no script execution by design.
- 📥 **Background RBX Import Jobs** - Queue `.rbx` packages into a background runner with configurable size limits. Practical maximum depends on your host and storage plan.
- 🧩 **Safe UGC UI (SUU) Integration** - RBX `ui_card` and `image_display` payloads render via `@safe-ugc-ui/react`, giving native character cards a declarative safe UI layer for status panels and emotion-image layouts without adding new raw HTML/CSS paths.
- 🧠 **Long-term Memory** - Dual memory system (semantic + episodic memory), custom prompts, Realtime updates, optional Voyage embeddings-based retrieval, and switchable memory modes: the default summary-window mode plus a prefix-optimized mode for cache-friendly long chats.
- 🌀 **Async Chat Queue (Realtime streaming)** - `/api/chat` (Node) enqueues jobs, runner uses `streamText` to update `messages` in real-time for Realtime subscription streaming. Job status API maintained as backup channel for completion/token aggregation.
- 📄 **Message Pagination** - Optimized for large chats (loads 80 at a time, supports 1000+ messages)
- ⚡ **SWR Data Caching** - Eliminates duplicate API calls, automatic revalidation
- 🎨 **Structured Character UI** - Image displays and status panels render through RBX asset bindings and Safe UGC UI, not ad-hoc HTML.
- ✍️ **Responsive Composer** - Autosizing chat input & inline editor tuned for long-form edits on mobile/desktop
- 👤 **Persona System** - User roleplay profile management
- 🔒 **Security-First** - Chat entry point locked to Node Runtime to protect secret keys, maintains Internal Admin Bridge + RLS + XSS defense.
- 🌏 **Bilingual Memory** _(Experimental)_ - Token-efficient multilingual support that preserves natural output style while reducing context cost for non-English chats.

### Implementation Highlights

- RBX runtime: native `.rbx` parser/importer with direct manifest validation, explicit asset references, and SUU-based UI payloads.
- Lorebook engine: v3 decorators, keyword/regex activation, recursion, overrides, and token budgeting.
- Import pipeline: RBX-native import queue with rollback on failure, staged upload cleanup, and asset/module import stats.
- Safety: RBX excludes script execution by design; regex script execution remains blocked in production.

### RBX Native Format

RBX is RebelAI's **native** character exchange format and the recommended target for new RebelAI-native cards.

- **Security-first design**: no embedded scripts, no external asset URLs, and no new raw HTML/CSS authoring path.
- **Portable packages**: manifests reference assets by `file_name`, not DB IDs or deployment-specific URLs.
- **Declarative UI**: `ui_card` and `image_display` integrate with Safe UGC UI instead of expanding raw HTML rendering.
- **Single spec**: one format, one parser, one importer. No multi-format version branching.

See [`docs/rbx-spec.md`](./docs/rbx-spec.md) for the full format and runtime status.

### Compatibility Boundaries

RebelAI is centered on **RBX + SUU**. Compatibility helpers remain only for migration workflows and compatible chat import/export.

- Active chat generation now composes only plain-text system fields: base/custom system prompt, `post_history_instructions`, `character.system_prompt`, and persona info.
- Legacy preset/module rendering paths are retired from the primary runtime.
- New RebelAI-native packaging and UI work should target RBX + SUU only.
- Archived compatibility behavior should be treated as secondary implementation detail, not the primary product surface.

### Chat Experience

- Chat input and inline editor share the `useAutosizeTextArea` hook, smoothly expanding up to max viewport height.
- On mobile, input and send button stack vertically for thumb-friendly operation; desktop maintains horizontal layout.
- **v0.8.0 Mobile Optimization**: Header/memory panel toggle, API key bar collapse (expand on click), lorebook overlay mode for maximum screen space utilization.

### Tech Stack

| Category          | Technologies                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Framework**     | Next.js 15 App Router, TypeScript 5, React 19                                                                     |
| **Styling**       | Tailwind CSS 3.4                                                                                                  |
| **Database**      | Supabase (PostgreSQL + Vault + Auth + Realtime + Storage)                                                         |
| **AI**            | Vercel AI SDK 5 (`ai` + `@ai-sdk/*`, streamText/prompt cache for Gemini, OpenAI, Anthropic, DeepSeek, OpenRouter) |
| **UI Cards**      | Safe UGC UI (`@safe-ugc-ui/react`) for RBX `ui_card` and `image_display` rendering                                |
| **Data Fetching** | SWR 2.3 (Client-side caching & revalidation)                                                                      |
| **Deployment**    | Vercel (Node runtime for `/api/chat` + runners, Edge only for lightweight routes like job status/icon)            |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Supabase account ([supabase.com](https://supabase.com))
- API key from Google AI / OpenAI / Anthropic / DeepSeek / OpenRouter

### 5-Minute Setup

```bash
# 1. Clone repository
git clone https://github.com/devforai-creator/rebel-ai.git
cd rebel-ai

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# 4. Start development server
npm run dev
```

**Detailed setup guide:** See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for database configuration.

### Hosting Profiles

- **Managed production** — Vercel Pro + Supabase Pro. Easiest path for built-in minutely cron, larger hosted quotas, and always-on production projects.
- **Low-cost self-hosted** — Vercel Hobby or another Node host + Supabase Free + external scheduler. Verified end-to-end on April 7, 2026 using `cron-job.org`: character import and chat generation both completed successfully. Good for personal or small deployments; keep imports within your storage provider's file-size limits.
- **Full self-hosted** — Any Node host + your own scheduler/worker + your own Supabase/Postgres stack.

See [`docs/HOSTING_PROFILES.md`](./docs/HOSTING_PROFILES.md) for the tradeoffs and required infrastructure for each mode.

### Optional: Episodic Memory RAG

1.  **Register Voyage Embeddings key** – In `/dashboard/api-keys`, select `Voyage (Embeddings)` provider and save your key.
2.  **Enable in account settings** – In `/dashboard/account` → _Episodic Memory RAG_ section, toggle on and select your Voyage key.
3.  **Backfill existing facts** – To add vectors to existing `chat_facts`, run `npm run backfill:embeddings`. (Requires: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
4.  **Resume conversation** – In chats with 20+ turns, if `=== Key Facts to Remember (by relevance) ===` appears at context end, RAG is working properly.

---

## Documentation Map

| Audience        | Document                                                 | Purpose                                                         |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Setup           | [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md)               | Local + Supabase configuration walkthrough                      |
| Getting started | [`docs/GETTING_STARTED.md`](./docs/GETTING_STARTED.md)   | First-run guide for a fresh local deployment                    |
| Hosting         | [`docs/HOSTING_PROFILES.md`](./docs/HOSTING_PROFILES.md) | Managed production vs low-cost self-hosted deployment profiles  |
| Database        | [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)             | Tables, RLS policies, RPC functions                             |
| Database ops    | [`docs/DB_CHANGE_WORKFLOW.md`](./docs/DB_CHANGE_WORKFLOW.md) | Migration workflow, production pushes, and drift recovery    |
| Format          | [`docs/rbx-spec.md`](./docs/rbx-spec.md)                 | RBX package format and runtime contract                         |
| Security        | [`SECURITY.md`](./SECURITY.md)                           | Reporting policy, security model, and self-hosting requirements |

> **Tip:** Keep the public entry points small: setup, schema, security, and the RBX spec should be enough to deploy and extend the project.

For database bootstrapping, treat `supabase/migrations/` as the source of truth. `supabase/schema.sql` is the generated hosted bootstrap snapshot and should be regenerated after migration changes. Use SQL Editor for first-time hosted bootstrap only, not for ongoing production schema changes. See [`docs/DB_CHANGE_WORKFLOW.md`](./docs/DB_CHANGE_WORKFLOW.md) for the operational workflow.

---

## Chat Generation Queue & Job Runner

The chat entry point (`/api/chat`) maintains a job queue in Node.js Runtime while the runner uses `streamText` to update `messages` in real-time for Realtime subscription streaming. Polling remains as a backup path for completion status and token aggregation.

1. **Client** sends a message → `/api/chat` saves the user message (except for regeneration) and creates a job in `chat_generation_jobs` table, returning `202 { jobId }`. Rate limit check occurs via `/api/internal/chat-admin`.
2. **Dashboard** subscribes to `chat-{chatId}` Realtime channel. **Job Runner** (`/api/internal/chat-job-runner`, Node.js Runtime) INSERTs first chunk via `streamText` and UPDATEs to accumulate content for streaming. `GET /api/chat/jobs/[jobId]` (Edge) continues polling for completion/error status and token aggregation, or as recovery for Realtime misses.
3. **Job Runner** fetches pending jobs and performs: LLM call → message save/update → usage/cache hit recording → `debug_info` save.
4. **Trigger Mechanism**: `/api/internal/chat-job-runner/trigger` invokes the runner via Vercel Cron on Pro, or via any external scheduler/manual `curl`/CLI path on self-hosted or Hobby deployments. Requires `CRON_SECRET` authentication.

### Operations

- **Local/Manual execution**: `npm run chat:jobs` → `scripts/run-chat-jobs.js` calls the current deployment URL to process jobs immediately.
- **Validated low-cost deployment**: On April 7, 2026, `Vercel Hobby + Supabase Free + cron-job.org` was verified end-to-end for queued chat generation. `cron-job.org` is just one working scheduler option; any scheduler that can call the trigger route with `Authorization: Bearer ${CRON_SECRET}` should work.
- **Environment variables**
  - `INTERNAL_API_ORIGIN`: Fixed origin used by Edge callsites (`chat-admin` rate limiter, `/api/chat/jobs/[id]`, etc.) when calling internal admin routes (e.g., `https://app.rebelai.com`). Header-based detection risks token theft, so **must be set in production**. Preview/local environments auto-detect via `resolveInternalApiOrigin()` (falls back to current Vercel URL or `http://127.0.0.1:3000`).
  - `CRON_SECRET`: Bearer token used by Vercel Cron and any external scheduler that invokes internal trigger routes.
  - `CHAT_ADMIN_SECRET`: Default Bearer token (used for Edge ↔ internal admin bridge & trigger → runner authentication).
  - `CHAT_JOB_RUNNER_BATCH_LIMIT` (optional): Jobs to process per batch (default 2, recommended max 5).
  - `RISUAI_ALLOW_REGEX_SCRIPTS` _(optional, default false)_: When `true`, executes `regex.script` blocks in compatibility modules. Only use in trusted offline environments; never enable in production.
- **Schedule adjustment**: This repository does not ship active Vercel cron entries by default, because minute-level cron is not available on Vercel Hobby. On Vercel Pro, add the schedules for your deployment target yourself. On Vercel Hobby or other hosts, schedule the same trigger endpoint externally with `Authorization: Bearer ${CRON_SECRET}`.

> **TIP:** To verify scheduled execution, check the logs for whichever scheduler you use. On Vercel Pro, look for `/api/internal/chat-job-runner/trigger` → `/api/internal/chat-job-runner`. For urgent cases, run `npm run chat:jobs` to drain jobs immediately.

- **Health check**: Call `GET /api/internal/health` (requires `Authorization: Bearer ${CHAT_ADMIN_SECRET}` header) to check recent success/failure times and consecutive failure counts for chat runner trigger and summary trigger. If response `status` is `degraded`, one of Cron settings, runner logs, or summary bridge has consecutive failures.

### Internal API origin resolution

- Edge callsites (e.g., job status route, `chat-admin` rate limiter, summary trigger) use `resolveInternalApiOrigin()`/`buildInternalApiUrl()` from `src/lib/internal-api-origin.ts` to compute a trusted origin.
- Priority: `INTERNAL_API_ORIGIN` → `VERCEL_URL` (preview) → `VERCEL_PROJECT_PRODUCTION_URL` → local dev (`http://127.0.0.1:3000`).
- When new routes/scripts call internal APIs, reuse `buildInternalApiUrl('/api/internal/...')` instead of adding environment-specific branches.

## Operator Announcement System

Admin-only announcement system for immediate emergency maintenance/event notifications.

- **Data model**: `announcements` table (`supabase/migrations/37_announcements.sql`) stores message, CTA label/URL, severity (`info`·`warning`·`critical`), and exposure start/end times. Default policy: **all users can read**, only `profiles.is_admin = true` users can write.
- **User experience**
  - `/api/announcements` REST route returns currently active announcements; `AnnouncementBanner` at dashboard top always shows latest announcement.
  - When user clicks `Close`, hash is stored in localStorage to prevent re-showing same announcement (auto-resets when new announcement ID appears).
- **Admin console**: In `/dashboard/admin/announcements` → "Operator Announcement Center" card:
  - Create new announcement (required fields: body, severity, `expose on save` option)
  - Schedule start/end times (if empty, exposes from save time indefinitely)
  - CTA button (optional): Both label and URL must be filled for display; URL must start with `https://` or `/`.
  - Edit/deactivate/delete existing announcements
- **Permission grant**: Set `profiles.is_admin` directly via SQL.
  ```sql
  update profiles set is_admin = true where id = '<user-id>';
  ```
- **Operations tips**
  - Emergency outage → use `critical` severity for red banner display.
  - Periodic announcements (e.g., Discord invite) → use `warning` or `info` and add external link to CTA button.
  - Announcement history viewable in "Active/Inactive" tabs at UI top; to re-enable ended announcements, just adjust `Starts at / Ends at` times.

## Character Import Queue & Runner

Uses the same architecture as Chat Job Runner for processing native RBX packages with configurable host-dependent size limits.

1. **Client** uploads an `.rbx` package → `POST /api/characters/import/storage` stores the file in the staged import bucket/job pipeline and creates a background import job. Legacy Supabase naming is retained internally.
2. **Dashboard** polls `GET /api/characters/import/jobs/[jobId]` to track `status`; refreshes character list on completion.
3. **Job Runner** (`/api/internal/character-import-runner`, Node.js Runtime) fetches pending jobs: download file from Storage → parse RBX → create character/assets/modules → cleanup staged files.
4. **Cron Trigger** (`/api/internal/character-import-runner/trigger`) invokes runner via Vercel Cron or manual command.

### Operations

- **Local/Manual execution**: `npm run character:jobs` → `scripts/run-character-import-jobs.js` calls the current deployment URL to process jobs immediately. `npm run import:jobs` remains as a compatibility alias.
- **Validated low-cost deployment**: On April 7, 2026, `Vercel Hobby + Supabase Free + cron-job.org` was verified end-to-end for background character import. The same scheduler setup can trigger both import and chat runners.
- **Environment variables**
  - `CHAT_ADMIN_SECRET`: Used for trigger → runner authentication (same as chat job runner)
  - `CRON_SECRET`: Used by Vercel Cron for trigger route (same as chat job runner)
  - `CHARACTER_IMPORT_RUNNER_BATCH_LIMIT` (optional): Jobs per batch (default 1, recommended max 5). Legacy fallback: `CHARX_IMPORT_RUNNER_BATCH_LIMIT`
  - `ASSET_UPLOAD_CONCURRENCY` (optional): Concurrent asset uploads (default 8)
- **Schedule adjustment**: This repository does not ship active Vercel cron entries by default, because minute-level cron is not available on Vercel Hobby. On Vercel Pro, add the schedules for your deployment target yourself. On Vercel Hobby or other hosts, run the same trigger endpoint from your own scheduler.

> **TIP:** To verify scheduled execution, check your scheduler logs. On Vercel Pro, look for `/api/internal/character-import-runner/trigger` → `/api/internal/character-import-runner`. For urgent cases, run `npm run character:jobs` to drain jobs immediately.

---

## Development

### Branch Strategy

```bash
dev branch  → Preview deployments (testing & development)
main branch → Production (stable releases only)
```

**Workflow:**

```bash
# Work on dev branch
git checkout dev
git add . && git commit -m "Add new feature"
git push  # → Vercel creates preview deployment

# After testing, merge to production
git checkout main
git merge dev
git push  # → Production deployment
```

### Commands

```bash
npm run dev          # Development server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint check
npm run test         # Vitest (unit + integration)
npx tsc --noEmit     # Type check
npm run backfill:embeddings  # Voyage embeddings backfill (optional feature)
```

### Project Structure

```
src/
├── app/                     # Next.js App Router
│   ├── auth/                # Authentication
│   ├── dashboard/           # Protected routes
│   │   ├── api-keys/        # BYOK management
│   │   ├── characters/      # Character CRUD + RBX import flow
│   │   ├── chats/[id]/      # Chat interface with pagination
│   │   └── personas/        # User personas
│   └── api/
│       ├── chat/            # Chat enqueue API (Node runtime) + job status (Edge)
│       ├── internal/        # Admin Bridge & job runners (Node.js Runtime)
│       └── characters/      # Background character import (Node.js)
├── lib/
│   ├── api-keys/            # Provider utilities (LLM vs embedding filtering)
│   ├── supabase/            # Client/Server/Admin clients
│   ├── import/              # Shared import constants
│   └── character-import-jobs.ts
├── hooks/                   # SWR custom hooks (useChatOptions, etc.)
└── types/                   # TypeScript definitions
```

### Testing

**Automated:**

- `npm run test` - Vitest (chat summaries, API route ownership)
- `npm run test:rls` _(local Supabase required)_ — RLS policy integration tests (28 tests). Verifies cross-tenant isolation for characters, chats, api_keys, messages. Requires `supabase start`.
- `npm run test:vault` _(manual/secure env only)_ — Sources `.env.local`, then runs `vitest run tests/security/get_decrypted_secret.test.ts` to ensure Vault RPC requires service-role. Requires Supabase network access; auto-skips if env vars missing.
  - Manual equivalent (for custom env files):
    ```bash
    set -a
    source .env.local
    set +a
    npm run test -- tests/security/get_decrypted_secret.test.ts
    ```
- `CI=1 npm run lint` - ESLint with Next.js rules
- `npm run db:types` - Apply pending local Supabase migrations and regenerate `src/types/database.generated.ts`
- `npm run character:jobs` - Background character import runner (requires `CHAT_ADMIN_SECRET`)
- GitHub Actions runs tests on all pushes/PRs

**CI Pipeline (GitHub Actions):**

- Lint, format check, unit tests, production build
- **Migration validation** — Applies all migrations to local Supabase, catches schema errors (missing columns, syntax)
- **RLS behavior tests** — Verifies row-level security policies block cross-tenant access

### Large File Import

RBX imports run as background jobs and are the supported path for large character packages. If Vercel import jobs time out or asset uploads stall, use `npm run character:jobs` to manually drain the queue and inspect runner logs.

If you target low-cost hosted setups, keep packages within your storage provider's limits. For example, hosted Supabase Free plans currently enforce a smaller global file-size cap than Pro.

**Manual:**

- Upload RBX packages (`.rbx`)
- Test streaming chat with 20+ turns
- Verify lorebook activation and token stats

### Chat Token Stats

- The chat header surfaces two metrics: **This message** shows the most recent assistant turn while **Total tokens** shows the aggregate usage for the conversation. Both values come from `GET /api/chats/[chatId]/stats`.
- The stats API calls the `get_chat_token_totals(chat_id, requester)` RPC so totals always pass RLS and still work on Supabase instances with aggregates disabled. It also reads the most recent assistant `messages` row (sequence-desc) and emits a `latestMessage` block with `prompt`, `completion`, and `total` counts.
- The chat page fetches this endpoint when the page mounts and whenever the async job runner reports success. See `useQueuedChat.fetchLatestUsage()` inside `src/app/dashboard/chats/[id]/ChatInterface.tsx`.
- Realtime keeps the numbers fresh across tabs/devices: `ChatInterface` subscribes to `chat-${chatId}-token-stats` (table `messages`) and refetches stats whenever an assistant row is inserted, deleted, or its token columns change. This works because we call `await supabase.auth.getSession()` before joining the channel and only react to assistant-role payloads via `shouldRefreshTokenStats()`.
- If the chips stop updating, inspect `GET /api/chats/[chatId]/stats`, the latest assistant `messages` row token columns, and the active Realtime subscription state.

---

## Re-enabling Super-Meta Summaries

Super-meta summaries (4 metas → 400 message compression) are **currently disabled**.

**Reasons for disabling:**

- 3-tier compression (chunk → meta → super-meta) causes significant information loss with minimal quality improvement in practice
- Meta summaries alone (100 message compression) provide sufficient context compression

**How to re-enable:**

1. **Remove context filtering** (`src/lib/chat-summaries.ts:207-213`)

   ```typescript
   // Delete this:
   const summariesWithoutSuperMeta = summaryRows.filter(
     (row) => row.level !== SUMMARY_LEVEL_SUPER_META,
   )
   const filteredSummaries = filterRedundantChunks(summariesWithoutSuperMeta)

   // Restore to:
   const filteredSummaries = filterRedundantChunks(summaryRows)
   ```

2. **Enable generation logic** (`src/lib/chat-summaries.ts:481-489`)

   ```typescript
   // Uncomment:
   await processSuperMetaSummaries({
     supabase,
     chatId,
     model,
     provider,
     modelName,
     metaPrompt,
   })
   ```

3. **Restore UI preview** (`src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx:242-245`)

   ```typescript
   // Restore to original logic:
   const superMetaSummaries = useMemo(() => {
     if (summaryCutoff <= 0) {
       return []
     }
     return summaries
       .filter((summary) => summary.level === 2 && summary.end_seq <= summaryCutoff)
       .sort((a, b) => a.start_seq - b.start_seq)
   }, [summaries, summaryCutoff])
   ```

4. **Restore tests** (remove `.skip`)
   - `src/lib/chat-summaries.test.ts:370`
   - `src/lib/chat-summaries.integration.test.ts:452`

5. **Verify**
   ```bash
   npm run test
   npm run lint
   npm run build
   ```

**Note:** Previously generated super-meta data remains in DB, so re-enabling will immediately include existing data in context.

---

## Supported Models (2025)

- **Google Gemini**: 3-pro-preview (1M / 64k context, dynamic thinking, $2/$12 <200k tokens, $4/$18 otherwise), 3-flash-preview, 2.5-pro, 2.5-flash, 2.5-flash-lite
- **OpenAI GPT**: gpt-5.1-chat-latest (Instant), gpt-5.1 (Thinking), gpt-5, gpt-4.1
- **Anthropic Claude**: sonnet-4-5, haiku-4-5, opus-4-1

---

## Deployment

**Vercel (Recommended):**

```bash
vercel login
vercel --prod
```

Set environment variables in Vercel Dashboard:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CHAT_ADMIN_SECRET` _(random string used to authenticate internal admin calls: chat runner trigger, rate limiter, summary trigger)_
- `SUMMARY_GENERATION_SECRET` _(used for summary-only node function calls)_
- `CRON_SECRET` _(Bearer token used by trigger routes)_
- `CHAT_JOB_RUNNER_BATCH_LIMIT` _(optional, default 2)_
- `INTERNAL_API_ORIGIN` _(Required in deployed non-local environments; set to your canonical app URL)_
- `VERCEL_AUTOMATION_BYPASS_SECRET` _(optional; only if Vercel Automation Protection is enabled)_

**GitHub Integration:** Auto-deploys on push to main branch.

### Self-Hosting Options

When forking this project to deploy on your own Vercel account, the following options are available.

#### Import Queue

RBX imports no longer use the legacy compatibility license/source attestation flow. The only required import-side secrets are `CHAT_ADMIN_SECRET` and `CRON_SECRET` for the background runner/trigger pair.

---

## Known Limitations / Next Steps

- **Job status polling maintained**: Messages stream via Realtime, but `GET /api/chat/jobs/[jobId]` polling continues for completion timing/token aggregation. Will remove polling once runner completion event-based triggers are ready.
- **Runner automation**: Works via Vercel Cron, but high-load projects should migrate to dedicated queue services (SQS, Cloud Tasks, etc.).

---

## License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](./LICENSE) file for details.

Copyright 2025 RebelAI Contributors

---

**Built with Next.js 15, Supabase, and Vercel AI SDK**
