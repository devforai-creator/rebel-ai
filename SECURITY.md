# Security Policy

RebelAI is a self-hostable BYOK character chat platform. Protecting user-provided API keys, authenticated user data, and privileged internal routes is the core security priority.

This public security document is intentionally short. It covers:

- how to report vulnerabilities
- which versions receive security fixes
- the current high-level security model
- the minimum self-hosting expectations

Detailed incident history and internal postmortems remain private to the archive workspace.

## Reporting a Vulnerability

If you discover a security vulnerability:

1. Do not open a public issue.
2. Use GitHub Security Advisories if available for the public repository.
3. If that is not available, contact the maintainer directly through the repository profile/contact channel.

We aim to acknowledge reports within 48 hours.

## Supported Versions

Only the latest released public version should be considered supported for security fixes.

Older versions may contain known vulnerabilities that will not be patched retroactively.

## Security Model

### BYOK secret handling

- RebelAI uses a Bring Your Own Key model.
- User API keys are stored in Supabase Vault-backed storage and decrypted only on privileged server-side paths.
- Privileged secret access is restricted to server-only code using the service-role boundary.

### Authentication and data isolation

- Supabase Auth handles authentication.
- Row Level Security is used to isolate user data.
- Server entry points must authenticate the caller and scope queries/mutations by ownership.

### Internal privileged routes

- Internal admin/runner routes are not public APIs.
- They require bearer-token authentication using deployment secrets such as `CHAT_ADMIN_SECRET` and `CRON_SECRET`.
- Service-to-service calls must use a trusted internal origin via `INTERNAL_API_ORIGIN` in deployed environments.

### Chat and summary pipeline

- Chat generation is processed through a queue/runner model rather than directly from arbitrary client input to privileged secret access.
- Summary generation is isolated behind its own guarded server-side entry point.
- Secret-bearing internal calls stay on trusted server boundaries.

### Character import surface

- RebelAI's native format is RBX.
- RBX excludes script execution by design.
- Character imports run through a staged background pipeline with ownership checks, queue limits, and archive-size guardrails.
- RBX packages reference assets by filename only. Import rewrites bundled asset binaries into RebelAI-managed storage, and runtime UI cards resolve `@assets/...` through host-generated asset mappings rather than author-supplied remote URLs.
- Legacy storage/table names may remain in the implementation, but they are internal details and not part of the public product identity.

### Frontend execution surface

- The active runtime is designed around plain text, asset references, and Safe UGC UI payloads.
- RebelAI does not rely on arbitrary user-authored script execution in the active product path.
- Content Security Policy and server-side boundaries provide additional defense in depth.

## Self-Hosting Security Requirements

If you self-host RebelAI, at minimum:

- set `SUPABASE_SERVICE_ROLE_KEY`
- set `CHAT_ADMIN_SECRET`
- set `SUMMARY_GENERATION_SECRET`
- set `CRON_SECRET`
- set `INTERNAL_API_ORIGIN` to the canonical deployed app URL
- keep storage buckets private unless you have a deliberate reason not to
- restrict access to internal routes to trusted callers only
- rotate secrets if you suspect exposure

If you deploy outside Vercel, you must also provide a trusted scheduler/worker path for the internal trigger routes or runner commands.

## Disclosure Philosophy

RebelAI does not treat security through obscurity as a strategy.

The public repository should document:

- current security boundaries
- supported versions
- reporting expectations

Detailed internal incident notes, exploit write-ups, and historical archive material may remain private when publishing them would add noise without materially helping public users patch or operate the current system safely.
