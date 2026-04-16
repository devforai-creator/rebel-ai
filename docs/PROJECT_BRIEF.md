# Project Brief

This is the shortest stable orientation document for RebelAI.
Use it when a human or LLM needs to understand what this project is before reading the codebase.

This file is intentionally not a feature inventory.
It should change only when the product identity, operating assumptions, or engineering doctrine changes.
Exact behavior still lives in code, tests, migrations, and generated types.

## One-Sentence Summary

RebelAI is a self-hosted character chat stack for people who want their own API keys, their own data, and more control over the product boundary.

## What Problem It Solves

Many AI chat products make the platform own one or more of these:

- the billing path
- the conversation store
- the character format
- the deployment model
- the trust boundary around extensions and UI

RebelAI is built for people who want those choices to stay closer to the operator.

## Who It Is For

- people who want **bring-your-own-key** cost control
- people who care about **data ownership** and self-hosting
- people who want character chat without strong platform lock-in
- power users and developers who care about portability, boundaries, and deployability

## Who It Is Not For

- people looking for a fully hosted sign-up-and-go chat service
- people who want zero deployment or operations responsibility
- people who expect every experimental feature to carry the same support promise as the core path

## Core Product Bets

- **BYOK first**: users supply their own model API keys
- **Self-hosted first**: the app is meant to run on infrastructure the operator controls
- **Data ownership**: chats, characters, and assets stay in the operator's storage stack
- **Portable native format**: RebelAI centers on `RBX + SUU` instead of raw HTML/script card execution
- **Boundary-conscious engineering**: support status and trust boundaries are treated explicitly, not implicitly

## High-Level System Shape

- Next.js App Router web app
- Supabase for auth, database, storage, Vault, and realtime
- background job runners for chat generation and RBX import
- native character packaging through `RBX`
- declarative card rendering through `Safe UGC UI`
- self-hosted and closed-deployment assumptions are stronger than mass hosted-service assumptions

## Support And Trust Boundaries

RebelAI uses two separate axes:

- **support status**: `core`, `fallback`, `experimental`, `removal`
- **trust boundary**: what a path is allowed to touch

Important rule:

`experimental` is only a support label. Safe experimentation comes from boundary design.

Experimental paths should not directly own:

- authentication or permission checks
- Vault / API key secret ownership
- admin bridge or internal trigger authorization
- destructive multi-step writes
- billing or cost commitments
- raw HTML, script execution, or equivalent arbitrary execution surfaces

For the stable doctrine, read [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md).

## What To Preserve When Changing This Repo

- Keep the project understandable as a **self-hosted, BYOK, data-ownership-first** stack
- Keep `RBX + SUU` as the center of the native character/UI direction
- Prefer explicit boundaries over convenience shortcuts that blur trust or support levels
- Avoid turning experimental paths into hidden dependencies of the core path
- Treat code, tests, and migrations as the exact contract when docs are incomplete

## What Can Change Without Updating This File

These do not usually require edits here:

- individual features
- model/provider lists
- UI details
- exact hosting profiles
- current backlog priorities
- route-level implementation details

Those belong in code, tests, runbooks, or other docs.

## When This File Should Be Updated

Update this file only when one of these changes:

- the target user meaningfully changes
- the project stops being BYOK-first or self-hosted-first
- the native format direction changes away from `RBX + SUU`
- the support/trust-boundary doctrine changes
- the project becomes primarily a hosted public service instead of an operator-controlled stack
