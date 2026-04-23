# LLM Invocation Ownership Backlog

Updated: 2026-04-23
Status: Active

This is the current execution backlog for cleaning up RebelAI's LLM invocation
ownership before adding more provider-specific behavior such as Google
tool-aware explicit cache.

This queue starts after
[google-cache-boundary-backlog-2026-04-23.md](../archive/2026/google-cache-boundary-backlog-2026-04-23.md)
made the Google uncached path primary and after
[google-tool-aware-explicit-cache-backlog-2026-04-23.md](../parked/2026/google-tool-aware-explicit-cache-backlog-2026-04-23.md)
was parked as a sequencing follow-up.

It exists to answer two narrower questions:

- which LLM invocation routes are truly separate product surfaces versus the
  same access ceremony copied into different places
- what minimum shared adapter or helper seam is worth extracting before more
  provider-specific features land

It is not:

- a broad provider abstraction rewrite
- a demand to force summary, translation, reprocess, embeddings, and chat into
  one execution path
- a reason to weaken the first-class queued chat path
- a prerequisite to redesign all memory or translation behavior

## Working Rules

- Preserve the first-class queued chat path as the maintained default contract.
- Separate invocation ownership from transport wrappers: internal trigger routes
  are not the same thing as distinct LLM execution cores.
- Prefer one shared access ceremony where duplication is real:
  config resolve -> vault decrypt -> model build -> invoke.
- Do not collapse intentionally different product semantics just to reduce file
  count.
- If a route is not first-class, keep it explicitly secondary instead of letting
  it quietly define the shared invocation contract.

## Why This Queue Exists

RebelAI's LLM usage is not one path anymore:

- the first-class queued chat runner owns streaming chat generation
- summary generation runs through a separate internal route and memory pipeline
- translation has both a user-facing route and an internal route that converge
  later
- reprocess performs its own direct streaming rewrite path
- embeddings use a separate provider client and access path

That is not automatically wrong, but the duplicated ceremony is now visible
enough that new provider-specific work risks attaching to the wrong layer.

The next useful step is not broad consolidation.
It is to decide where shared invocation setup belongs and where route-specific
semantics should stay local.

## Why Before Tool-Aware Explicit Cache

Google tool-aware explicit cache is not a tiny option toggle anymore.
It needs a clear place to own:

- cache-creation inputs
- provider-specific cached request wiring
- fallback behavior when cache support is unavailable

If RebelAI adds that now without clarifying invocation ownership, the likely
result is duplicated provider logic across chat, summary-adjacent work, or
special-case routes.

This queue should therefore land first if it stays narrow and bounded.

## Acceptance Bar

This queue is only successful if all of the following become true:

1. RebelAI has a documented map of actual LLM invocation cores, not just HTTP
   entrypoints and triggers.
2. The repo clearly distinguishes first-class chat generation from secondary
   invocation surfaces such as summary, translation, reprocess, and embeddings.
3. Shared config/decrypt/model-build ceremony is reduced where duplication is
   real and harmful.
4. Provider-specific features like Google tool-aware explicit cache have a
   clearer ownership seam after this queue than before it.
5. The queue ends with a bounded follow-up decision, not a half-finished
   framework rewrite.

## P0 Execution Order

### P0-1. Inventory Real Invocation Cores

Status: `completed`

Primary scope:

- `src/app/api/internal/chat-job-runner/**`
- `src/app/api/summaries/generate/route.ts`
- `src/lib/chat/translation-service.ts`
- `src/app/api/messages/reprocess/route.ts`
- `src/lib/embeddings.ts`

Acceptance notes:

- list actual invocation cores, wrappers, and trigger-only routes separately
- classify each core as first-class, secondary-but-supported, experimental, or
  compatibility
- identify duplicated setup ceremony with exact file ownership
- inventory captured in [LLM_INVOCATION_OWNERSHIP.md](../../LLM_INVOCATION_OWNERSHIP.md)

### P0-2. Extract The Minimum Shared Invocation Setup Seam

Status: `pending`

Primary scope:

- shared LLM config resolution / vault decrypt / model build helpers
- non-chat invocation routes only where duplication is concrete

Acceptance notes:

- extracted helpers reduce real duplication without hiding product-specific
  semantics
- the first-class chat runner does not become coupled to secondary route needs
- unsupported providers still fail closed at the right boundary

### P0-3. Tighten Secondary Invocation Ownership

Status: `pending`

Primary scope:

- translation routes and trigger path
- summary route entry and memory update entry
- reprocess invocation path

Acceptance notes:

- wrappers and triggers are visibly thinner than invocation cores
- each secondary surface has one obvious owner for LLM invocation
- secondary surfaces stay outside the maintained core chat success path

### P0-4. Decide The Next Feature Queue

Status: `pending`

Primary scope:

- queue close-out
- follow-up scoping only if needed

Acceptance notes:

- if ownership is clear enough, reopen Google tool-aware explicit cache as the
  next bounded queue
- if another invocation seam still blocks that work, write the smaller follow-up
  explicitly
- do not let this queue drift into generic provider-platform cleanup

## Explicitly Parked

Do not pull these into this queue unless the contract changes:

- Google cache TTL tuning
- broader provider cache unification across every provider
- summary algorithm redesign
- translation UX redesign
- embeddings provider migration
- unrelated model-registry additions

## End Condition

This queue should close when RebelAI's actual LLM invocation ownership is clear
enough that provider-specific work, including Google tool-aware explicit cache,
can attach to the right seam without reopening boundary confusion.
