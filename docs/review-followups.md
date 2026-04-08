# Review Follow-ups

Updated: 2026-04-08

## Completed

- `657acd6` `Harden server action form validation`
- `f71a4c3` `Refactor character detail chat state`
- `d405529` `Validate auth and account form actions`

## Next Priorities

- Apply the same `FormData + zod` validation pattern to [feedback actions](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/feedback/actions.ts).
- Replace `alert` / `confirm` flows with toast or dialog-based UI patterns where practical.

## Optional Follow-up

- Split [CharacterDetailView](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailView.tsx) further into presentation-focused subcomponents if that screen grows again.
