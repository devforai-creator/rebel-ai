# Maintainer Local RBX Import

This runbook documents the local-only maintainer tool for importing oversized `.rbx` archives directly from the filesystem.

It is a supported secondary / fallback maintainer surface.
It is not the standard user import UX, and it must not silently redefine the public or dashboard import contract.

## What It Is For

Use this tool when all of the following are true:

- the archive is too large or awkward for the normal browser upload path
- you are operating the instance yourself
- you can run a local dev server against the target environment intentionally

Normal `.rbx` imports should still use the regular dashboard import flow.

## Boundaries

- opt-in only via `LOCAL_RBX_IMPORT_ENABLED=true`
- protected by a dedicated `LOCAL_RBX_IMPORT_SECRET`
- accepts loopback requests only
- disabled in production
- reads a local absolute file path and imports through the existing `parseRbxArchive() -> assertRbxRuntimeContract() -> importRbx()` path
- bypasses the queued background import job path on purpose

Important: this tool uses whatever Supabase project your current `.env.local` points at.
If your local dev server is pointed at a remote project, this tool writes to that remote project directly.

## Setup

Add these to `.env.local` only when you intentionally want the tool available:

```bash
LOCAL_RBX_IMPORT_ENABLED=true
LOCAL_RBX_IMPORT_SECRET=generate_a_strong_random_token
LOCAL_RBX_IMPORT_MAX_FILE_MB=1024
```

Then start the app locally:

```bash
npm run dev:local
```

## Usage

```bash
npm run maintainer:import:rbx:file -- "/mnt/c/Users/name/Downloads/card.rbx" <user-id> [private|draft|public]
```

Example:

```bash
npm run maintainer:import:rbx:file -- "/mnt/c/Users/name/Downloads/card.rbx" user-123 draft
```

The legacy alias `npm run import:rbx:file` still points to the same tool, but the maintainer-prefixed command is the supported name.

## Current Guardrails

- file size limit: `LOCAL_RBX_IMPORT_MAX_FILE_MB` with default `1024`
- archive asset count limit inside this tool: `10_000`
- decompressed archive limit inside this tool: `2048MB`
- manifest size limit inside this tool: `32MB`

These relaxed parser limits apply only to this maintainer route.
They do not widen the normal browser import contract.

## When Not To Use It

Do not use this tool:

- as a substitute for the standard import UX
- in production
- for routine small-card imports that should keep exercising the normal path
- without checking which Supabase project your local env is targeting
