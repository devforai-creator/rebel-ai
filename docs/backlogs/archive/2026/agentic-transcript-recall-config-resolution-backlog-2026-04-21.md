# Agentic Transcript Recall Config Resolution Backlog

Updated: 2026-04-21
Status: Completed

Completion note:

- P0-1 through P1-2 landed in code, tests, schema, generated types, and UI.
- P1-3 landed as the conservative first-pass rule:
  existing explicit ATR chat rows, including legacy hidden auto-on rows, are
  left unchanged; `inherit` now applies only when the per-chat ATR config is
  absent, and future cleanup should happen through an explicit reset or
  targeted migration rather than a hidden rewrite.

This document is the current execution backlog for making ATR enablement
semantics honest, explicit, and predictable.

It turns
[experimental-agentic-transcript-recall.md](../../experimental-agentic-transcript-recall.md)
into a bounded implementation queue for configuration ownership and runtime
resolution.

This backlog exists to answer one narrow question:

- can RebelAI keep ATR experimental and fail-closed while separating operator
  gating, account defaults, and per-chat overrides cleanly

It is not:

- a new ATR quality or recall-capability queue
- transcript search, transcript embeddings, or citations work
- a memory-mode redesign
- a justification to widen ATR into a supported core contract
- a reason to silently rewrite existing chat config in bulk without an explicit
  migration rule

See [SUPPORT_BOUNDARIES.md](../../SUPPORT_BOUNDARIES.md) for the experimental
doctrine and
[experimental-agentic-transcript-recall.md](../../experimental-agentic-transcript-recall.md)
for the feature contract this queue must preserve.

## Hard Rules

- Keep ATR `experimental`, fail-closed, and removable.
- Keep the global env flag as an operator kill switch only.
- Do not use chat creation or import as a hidden ATR auto-opt-in path.
- Separate `may run`, `default preference`, and `explicit override` into
  distinct ownership layers.
- Preserve existing explicit per-chat ATR overrides across unrelated
  `model_config` writes.
- Do not let account-level default changes silently rewrite explicit per-chat
  overrides.
- Do not silently bulk-rewrite legacy chats in the first pass unless a narrow,
  auditable migration rule is defined first.
- Every behavior change lands with direct regression coverage in the same
  change.
- If this queue needs a schema change, follow
  [DB_CHANGE_WORKFLOW.md](../../DB_CHANGE_WORKFLOW.md).

## Assumptions Locked For This Queue

- operator env remains the top-level kill switch and stays default `off`
- account-level ATR default lives on `profiles`
- per-chat ATR override stays under `model_config.experimental`
- per-chat `inherit` is represented by the ATR config being absent, not by
  another hidden default write
- per-chat explicit `on` is represented by persisted ATR config with
  `enabled: true`
- per-chat explicit `off` is represented by persisted ATR config with
  `enabled: false`
- account default is initially a simple boolean default, not a full per-account
  ATR budget surface
- new and imported chats should normally start in `inherit`
- runtime ATR resolution must depend on:
  - operator env
  - per-chat explicit override, if present
  - otherwise the account default
- the first pass may keep existing legacy auto-enabled chats as-is if they are
  already explicit rows

## Why This Queue Exists

The current ATR MVP has a contract problem before it has a capability problem.

Today, the system blurs three different questions:

- is ATR allowed in this deployment right now
- should this account prefer ATR by default
- did this specific chat explicitly opt in or out

That produces the wrong semantics:

- the operator kill switch doubles as product-default behavior
- new and imported chats can become silently opted in
- account-level intent cannot be expressed cleanly
- existing chats do not have an honest `inherit / on / off` model

The next useful move is not more ATR power.
It is to restore configuration boundaries so the experiment behaves like an
experiment instead of a hidden default.

## Desired End State

At the end of this queue:

1. operator env only answers whether ATR may run at all
2. account settings expose one ATR default for chats
3. new and imported chats default to `inherit`, not hidden auto-write `on`
4. per-chat UI exposes `use account default / always on / always off`
5. runtime resolves effective ATR enablement from operator env, chat override,
   and account default in that order
6. unrelated per-chat model-config writes preserve ATR override state
7. legacy auto-on chats are handled by an explicit transition rule rather than
   an accidental side effect

## Priority Order

### P0-1. Lock Config Ownership And Resolution Semantics

Why first:

- the main bug is semantic, not mechanical
- implementation should not start until the ownership stack is explicit

Primary scope:

- [experimental-agentic-transcript-recall.md](/home/tmdduq96kr/projects/rebel-ai/docs/experimental-agentic-transcript-recall.md)
- this backlog

Done when:

- operator gate, account default, and per-chat override are defined separately
- `inherit / on / off` semantics are written down explicitly
- the queue states how `inherit` is represented in persisted chat config
- the queue states the conservative rule for legacy auto-on chats

### P0-2. Add Account-Level ATR Default

Why next:

- account preference should exist before chat UI can inherit from it
- the account setting is the new source of truth for non-overridden chats

Primary scope:

- `profiles` schema and generated types
- [src/app/dashboard/account/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/page.tsx)
- [src/app/dashboard/account/account-settings-actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/account-settings-actions.ts)

Done when:

- `profiles` can store an ATR default boolean
- account settings exposes an ATR experimental default control
- save validation and UX copy make it clear this is a default, not a global
  force-enable
- tests cover load and save behavior

### P0-3. Stop Auto-Persisting ATR At Chat Creation And Import

Why before chat UI:

- hidden opt-in at creation/import is the current boundary break
- inheritance semantics are not real until this write path is removed

Primary scope:

- [src/app/dashboard/chats/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/actions.ts)
- [src/lib/chat/model-config.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/model-config.ts)

Done when:

- new chats no longer persist ATR `enabled: true` as a default side effect
- imported chats no longer persist ATR `enabled: true` as a default side effect
- helper paths no longer imply ATR opt-in during chat creation
- tests lock the new default behavior

### P1-1. Add Per-Chat ATR Override UI

Why now:

- users need an honest way to override the account default for one chat
- the chat surface is where `inherit / on / off` becomes visible and testable

Primary scope:

- [src/app/dashboard/chats/[id]/hooks/useChatInterfaceSettings.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatInterfaceSettings.ts)
- [src/app/dashboard/chats/[id]/components/TokenStatsPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/TokenStatsPanel.tsx)
- [src/app/dashboard/chats/[id]/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/actions.ts)

Done when:

- one chat can explicitly choose:
  - use account default
  - always on
  - always off
- the persisted shape distinguishes explicit override from inherit cleanly
- unrelated memory/API-key changes do not erase ATR override state
- tests cover save and preserve behavior

### P1-2. Resolve Runtime ATR Enablement From The Ownership Stack

Why after config surfaces exist:

- runtime should consume the final contract rather than infer product semantics
- this is where the experiment becomes honestly opt-in again

Primary scope:

- [src/app/api/internal/chat-job-runner/execution-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.ts)
- [src/lib/experimental/agentic-transcript-recall/config.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall/config.ts)
- [src/lib/chat/model-config.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/model-config.ts)

Done when:

- runtime resolves ATR from operator env plus effective chat preference
- source-hint and source-map preparation are skipped unless ATR is effectively
  enabled for the request
- debug metrics still show why ATR was skipped
- tests cover:
  - env off
  - inherited off
  - inherited on
  - explicit on
  - explicit off

### P1-3. Add Conservative Legacy Transition Handling

Why last:

- legacy rows created during the hidden auto-on window should not be ignored
- they also should not be rewritten recklessly

Primary scope:

- maintainer note or small migration helper as needed
- targeted tests and release notes

Done when:

- the repo states exactly how previously auto-enabled chats are treated
- the first implementation chooses one explicit rule, for example:
  - leave existing explicit rows unchanged and add a future reset path, or
  - migrate only a narrowly identified cohort
- there is no silent broad rewrite hidden inside unrelated request paths

## Explicitly Parked

Do not pull these into this queue unless the ATR contract changes:

- transcript recall carryover between turns
- additional ATR providers or provider-specific tuning work
- ATR budgets, quality tuning, or prompt-behavior tuning beyond what this
  config queue strictly needs
- transcript search or transcript embeddings
- user-facing citation or transcript-inspector UI
- any attempt to graduate ATR into a supported memory mode

## Default Execution Rule

If a task does not make ATR configuration ownership, defaulting, or runtime
resolution more honest and predictable, it does not belong in this backlog.
