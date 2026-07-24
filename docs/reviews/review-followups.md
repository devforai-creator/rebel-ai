# Review Follow-ups

Status: Archived
Role: Evidence
Last reviewed: 2026-07-25
Source of truth: commits and review state captured on 2026-04-12
Revisit when: investigating the April dashboard review or deciding whether to revive a finding

This file preserves the April 2026 review closeout. It is not the current execution queue. Use
[the backlog index](../backlogs/README.md) and current GitHub issues for active work.

## Completed

- `657acd6` `Harden server action form validation`
- `f71a4c3` `Refactor character detail chat state`
- `d405529` `Validate auth and account form actions`
- Aligned RBX/SUU docs and feedback form validation with the current runtime/import contract.
- Replaced dashboard browser `alert` / `confirm` flows with shared confirmation dialogs and toast or inline feedback paths.
- `7cf3d7f` `Introduce shared dashboard UI primitives`
- Normalized the remaining account and API-key forms against the shared button/card/feedback contract.
- Normalized the chat-adjacent panels and overlays against the shared button/card/feedback contract.
- Normalized the character list/detail surfaces against the shared button/card/feedback contract.
- Locked the dashboard empty/loading/error-state language with shared state primitives across the first-class character and chat surfaces.

## Historical Next Priorities

These were the proposed next steps on 2026-04-12, not current priorities.

- Start `P3-1a`: establish the shared visual direction across the first-class dashboard shells before touching feature-specific polish.
- Then run `P3-1b`: improve the chat workspace hierarchy, since chat is the highest-frequency surface.
- Follow with `P3-1c`: improve the character discovery/detail flow.
- After that, run `P3-1d`: improve the account and API-key operator surfaces.
- Close the pass with `P3-1e`: responsive cohesion and final first-class cleanup.

## Historical Optional Follow-up

- Split [CharacterDetailView](../../src/app/dashboard/characters/[id]/CharacterDetailView.tsx)
  further into presentation-focused subcomponents if that screen grows again.
