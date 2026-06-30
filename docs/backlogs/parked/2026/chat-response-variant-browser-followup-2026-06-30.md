# Chat Response Variant Browser Follow-up

Created: 2026-06-30  
Status: Parked

## Parking Decision

Preserve the product idea without adding it to the current active backlog.

The existing turn-and-variant architecture already stores prior assistant responses, but RebelAI
does not yet expose them in the UI. A variant browser could let users compare a character's
different reactions, including responses produced by different LLM models.

## Opportunity

- inspect earlier assistant variants for the same user turn
- compare response content and `model_used` without losing the current response
- understand how different models portray the same character
- build on data that is already retained instead of introducing another response-history model

## Smallest Useful First Scope

Start with a read-only browser for the latest turn:

- show the active variant and retained superseded variants
- display position, response content, model, and generation time
- keep the current `active_assistant_message_id` unchanged
- do not alter prompt context, summaries, facts, or memory

This scope tests whether users value comparison before adding mutation or branching behavior.

## Later Scope

Only after the read-only experience proves useful, consider:

- activating a different variant for the latest turn
- generating explicit side-by-side responses with selected models
- branching a chat from a variant on an older turn
- a durable response-history or compare view

## Risks and Required Decisions

- Switching the active variant must update the active pointer and message statuses safely.
- A changed active variant can alter future prompt context.
- Switching an older turn is a branch operation because later turns were generated from a
  different response.
- Summary, fact, translation, and memory behavior must be defined before active-variant switching
  ships.
- Model comparison incurs additional provider cost and should make that cost visible to the user.

## Reopen When

Reopen this follow-up when at least one of these is true:

- repeated product use shows a real need to compare regenerated responses
- model-to-model character response comparison becomes a prioritized workflow
- a user-facing response history or branch-chat feature is being planned

When reopened, begin with the read-only latest-turn scope. Do not start with arbitrary historical
turn switching.

## Context

The implemented data model and its safety rationale are documented in
[`chat-regeneration-architecture.md`](../../../chat-regeneration-architecture.md). The active recent
conversation work remains tracked separately and should not absorb this feature.
