# RBX Authoring with Claude

RebelAI can import `.rbx` packages directly, but someone still needs to author those packages. This repository now includes an official Claude-importable skill bundle for RBX authoring at [`skills/rebelai-rbx.skill`](../skills/rebelai-rbx.skill).

## What the skill is for

- creating new RebelAI-native `.rbx` packages
- generating or refining `manifest.json`
- designing `extract` regex entries for structured status output
- applying current RebelAI rules for `ui_card`, `ui_cards`, and `image_display`
- checking package structure with the bundled `rbx_tools.py` helper after extraction

## Basic flow

1. Download [`skills/rebelai-rbx.skill`](../skills/rebelai-rbx.skill) from this repository.
2. Import that file through Claude's skill import flow.
3. Ask Claude to create or modify an RBX package, manifest, or status-card design.
4. Import the resulting `.rbx` file into RebelAI from the character import screen.

## Example prompts

- `RebelAI용 판타지 tavern 시뮬레이션 캐릭터 카드 .rbx를 설계해줘. 멀티 NPC 구조와 첫 greeting도 포함해줘.`
- `이 캐릭터 설정을 RebelAI RBX v1.1 manifest.json으로 바꿔줘.`
- `이 출력 포맷에 맞는 extract regex와 ui_card 상태창을 설계해줘.`
- `기존 .rbx 구성을 검토해서 현재 RebelAI import contract에 맞지 않는 필드를 고쳐줘.`

## Notes

- The bundled skill metadata has been sanitized for public distribution and does not include local filesystem paths.
- The skill bundle includes the maintained working RBX reference used for model-assisted
  authoring. [`docs/rbx-spec.md`](./rbx-spec.md) stays as a lightweight repository entrypoint that
  points to the active code surfaces.
- Optional Safe UGC UI validation is not bundled in the skill package. If you want separate validator-level checks, run them from your own Safe UGC UI toolchain.
