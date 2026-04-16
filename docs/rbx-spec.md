# RBX Format Notes

> Lightweight entry point for the current RBX contract.
> Reference only. The exact accepted RBX contract lives in code and the maintained authoring workflow, not in this markdown file.

RBX is RebelAI's native character exchange format.

This repository intentionally keeps this page short. The accepted RBX contract changes with the
active parser, importer, and authoring tooling, and maintaining a second long-form field-by-field
spec here created drift.

## Current Implementation References

Use these as the current implementation references when you need exact behavior:

- [src/types/rbx.types.ts](../src/types/rbx.types.ts): accepted manifest schema and contract-level
  validation rules
- [src/lib/rbx-parser.ts](../src/lib/rbx-parser.ts): archive layout, manifest loading, and
  parse-time checks
- [src/lib/rbx-importer.ts](../src/lib/rbx-importer.ts): import-time normalization, storage
  mapping, and rejection behavior
- [skills/rebelai-rbx.skill](../skills/rebelai-rbx.skill): bundled RBX authoring skill, including
  the maintained working reference used for model-assisted RBX authoring

## What This Means In Practice

- `.rbx` remains the recommended target for new RebelAI-native character packages.
- The runtime contract is defined by code, not by a frozen duplicate markdown schema.
- The bundled authoring skill is the best maintained human/LLM-facing reference for package
  construction.

## Related Docs

- [docs/RBX_AUTHORING_WITH_CLAUDE.md](./RBX_AUTHORING_WITH_CLAUDE.md): how to use the bundled skill
  to create or refine `.rbx` packages
- [README.md](../README.md): project-level overview and documentation map
- [docs/README.md](./README.md): active docs index
