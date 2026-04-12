# Review Follow-ups

Updated: 2026-04-12

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

## Next Priorities

- Start `P3-1`: run the first intentional product UI improvement pass now that the shared action, card, and state contracts are in place.

## Optional Follow-up

- Split [CharacterDetailView](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailView.tsx) further into presentation-focused subcomponents if that screen grows again.
