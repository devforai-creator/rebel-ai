# RebelAI

**Self-hosted character chat for people who want their own keys, data, and control.**

[![CI](https://github.com/devforai-creator/rebel-ai/actions/workflows/test.yml/badge.svg)](https://github.com/devforai-creator/rebel-ai/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

> RebelAI is a self-hosted character chat stack for people who want to bring their own API keys and keep conversations on infrastructure they control. It is built around ownership, portability, and explicit product boundaries rather than platform lock-in.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdevforai-creator%2Frebel-ai&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,CHAT_ADMIN_SECRET,SUMMARY_GENERATION_SECRET,CRON_SECRET,INTERNAL_API_ORIGIN)

## What RebelAI Optimizes For

- **Your keys**: bring your own model API keys and control your own cost surface
- **Your data**: keep conversations, characters, and assets in infrastructure you operate
- **Your server**: self-host the app instead of depending on a platform-owned runtime
- **Portable character stack**: use RebelAI-native `RBX + SUU` instead of raw HTML/script card execution
- **Boundary-conscious design**: separate `core`, `fallback`, `experimental`, and `removal` paths instead of treating every feature as equally trusted

## Who This Is For

- People who want **BYOK** instead of platform-managed model billing
- People who care about **data ownership** and self-hosting more than instant hosted convenience
- Character chat users who want **less platform lock-in**
- Power users and developers who care about **format boundaries, trust boundaries, and deployability**

## Who This Is Not For

- People looking for a fully hosted sign-up-and-go chat service
- People who want the simplest possible setup with no deployment or operations responsibility
- People who expect experimental features to have the same support promise as the core path

## What Makes It Different

Many chat products can offer one or two of these. RebelAI is explicitly trying to keep them together:

- self-hosted deployment
- bring-your-own-key cost control
- data ownership
- a portable native character format
- trust-boundary-first engineering choices

This is also why RebelAI avoids broad security marketing claims. The goal is not to claim perfect safety. The goal is to keep the trust surface explicit, narrow, and reviewable.

## Current Operating Mode

- Public signup is still **closed by default**.
- The active first-class mode is a **maintainer-operated closed / low-cost deployment**.
- `Vercel Pro + Supabase Pro` is still documented as a **future public-serving profile**, not as the current day-to-day default.
- Exact behavior should be treated as **code-first**. README is the entry point, not the exact source of truth.

If you want the current doctrine behind support levels and experimentation boundaries, read [docs/SUPPORT_BOUNDARIES.md](./docs/SUPPORT_BOUNDARIES.md).  
If you want the current operating defaults and public-opening gates, read [docs/OPERATING_PLAN.md](./docs/OPERATING_PLAN.md).

## Quick Start

### Prerequisites

- Node.js 20.x
- Supabase account
- At least one supported model API key

### Minimal Setup

```bash
git clone https://github.com/devforai-creator/rebel-ai.git
cd rebel-ai
nvm use
npm install
cp .env.example .env.local
npm run dev
```

For the actual environment and Supabase setup flow, use:

- [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)

## Read Next

- [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md): fastest route from checkout to a working local or closed deployment
- [docs/HOSTING_PROFILES.md](./docs/HOSTING_PROFILES.md): low-cost closed profile vs future managed public profile
- [docs/SUPPORT_BOUNDARIES.md](./docs/SUPPORT_BOUNDARIES.md): stable doctrine for `core / fallback / experimental / removal`
- [docs/FIRST_CLASS_SMOKE_CHECKS.md](./docs/FIRST_CLASS_SMOKE_CHECKS.md): post-deploy verification for the current first-class mode
- [docs/OPERATING_PLAN.md](./docs/OPERATING_PLAN.md): maintainer operating note for current defaults and public-opening gates
- [SECURITY.md](./SECURITY.md): security model, reporting policy, and self-hosting requirements
- [docs/README.md](./docs/README.md): full docs map

## Implementation Notes

The repo still includes a lot of engineering detail, but that detail now lives in docs and code instead of the landing page. In practice:

- runtime behavior lives in active code paths and tests
- schema truth lives in `supabase/migrations/`, `supabase/schema.sql`, and generated types
- maintainer operating decisions live in `docs/OPERATING_PLAN.md`
- stable support philosophy lives in `docs/SUPPORT_BOUNDARIES.md`

## License

Apache 2.0. See [LICENSE](./LICENSE).
