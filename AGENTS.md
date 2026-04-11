# Repository Guidelines

## Project Structure & Module Organization

`src/app/` contains the Next.js App Router UI and API routes. Put route-specific tests next to the code as `*.test.ts` or `*.test.tsx`. `src/lib/` holds shared logic for chat, RBX parsing/import, providers, security, and Supabase access. Use `src/hooks/` for reusable hooks and `src/types/` for generated and hand-written types. `tests/` is for cross-cutting integration and security coverage plus shared mocks. Static assets live in `public/`, docs in `docs/`, SQL schema and migrations in `supabase/`, and runner/backfill utilities in `scripts/`.

## Build, Test, and Development Commands

Use Node 20 to match CI. Install dependencies with `npm install`. Start locally with `npm run dev`, and verify production output with `npm run build`. Run `npm run lint` for ESLint, `npm run format:check` to verify Prettier, and `npm run format` to rewrite formatting. Run `npm run test -- --coverage` for the same Vitest flow used in CI. Use `npm run test:rls` only after `supabase start` when validating row-level security. Run `npx tsc --noEmit` before opening a PR.

## Coding Style & Naming Conventions

This repo is TypeScript-first and formatted by Prettier: 2-space indentation, no semicolons, single quotes, trailing commas, and `printWidth: 100`. Follow the ESLint rules from `next/core-web-vitals`, `next/typescript`, and `prettier`. React components use PascalCase file names such as `CharacterDetailView.tsx`; hooks use `useX.ts`; utility modules use concise lower-case names such as `model-config.ts`. Prefer the `@/` import alias for code under `src/`.

## Testing Guidelines

Vitest runs in a Node environment with globals enabled. Keep fast unit tests next to the module they exercise, and use `tests/` for broader auth, queue, and security scenarios. Use `*.integration.test.ts` for integration-style cases. When changing API routes, queue runners, RBX import logic, or Supabase policies, add or update tests in the same change.

## Operational Verification

For changes that touch internal routes, queue runners, trigger wiring, janitors, deployment assumptions, or environment-variable contracts, run `npm run ops:smoke` against the active deployment before closing the task. If the change intentionally affects runner execution paths, prefer `npm run ops:smoke:active`. Purely documentation-only changes and purely presentational UI changes can skip the smoke check.

## Commit & Pull Request Guidelines

Recent history favors short imperative commit subjects such as `Fix ...`, `Switch ...`, and `Revert ...`; an occasional conventional prefix like `fix:` is also acceptable. Keep commits focused and mention migration or environment-variable impact when needed. PRs should include a summary, linked issue if applicable, test evidence, and screenshots or GIFs for dashboard/UI changes. Call out any required updates to `.env.local`, Vercel settings, or Supabase configuration.

## Security & Configuration Tips

Never commit secrets. Start from `.env.example`, and keep `INTERNAL_API_ORIGIN`, `CHAT_ADMIN_SECRET`, `SUMMARY_GENERATION_SECRET`, and `CRON_SECRET` aligned with the environment you are testing. Review `SECURITY.md` and `SUPABASE_SETUP.md` before changing auth, Vault usage, or internal trigger routes.
