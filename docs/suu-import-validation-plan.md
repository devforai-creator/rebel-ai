# SUU Import Validation Plan

Updated: 2026-04-09

This document records the recommended design for validating SUU content during RBX import without forcing RebelAI to duplicate the full SUU schema.

## Decision

Adopt a two-layer validation model:

- RebelAI importer owns stable import-admission checks.
- SUU owns the canonical card schema and compatibility validation.

RebelAI should not embed a full copy of the evolving SUU schema in its importer.

## Why

Current RebelAI import validation rejects legacy unsafe fields such as `background_html`, but `ui_card`, `ui_cards`, and `image_display` are still accepted as `unknown`.

That creates two problems:

- malformed or hostile SUU payloads can enter storage and fail later at render time
- if RebelAI hardcodes the full SUU schema locally, importer maintenance will grow every time SUU evolves

The goal is to add an admission gate now without making RebelAI chase every SUU release.

## Goals

- Reject clearly unsafe SUU content before it is stored.
- Keep the canonical SUU schema in the SUU package, not duplicated in RebelAI.
- Allow SUU to evolve without requiring importer rewrites for every minor card feature.
- Distinguish security rejection from unsupported-but-safe compatibility issues.
- Start with a rollout path that is safe for an actively changing SUU contract.

## Non-Goals

- Fully freezing the SUU feature set today.
- Re-implementing the entire SUU validator in RebelAI.
- Making every unsupported card import successfully on day one.
- Treating all validation failures as security issues.

## Validation Layers

### 1. RebelAI Importer Layer

RebelAI should validate only stable admission concerns that do not depend on day-to-day SUU component details.

Recommended importer responsibilities:

- Reject forbidden legacy RBX fields such as raw HTML paths.
- Enforce maximum payload size for `ui_card`, `ui_cards`, and `image_display`.
- Enforce maximum structural complexity before deeper validation:
  - maximum JSON depth
  - maximum node count
  - maximum string length
- Call the SUU validator for each SUU payload.
- Map validator results to import policy:
  - `unsafe`: reject import
  - `incompatible`: warning-only at first
  - `warning`: allow import
  - `ok`: allow import

RebelAI should remain responsible for the import decision, but not for understanding every SUU field.

### 2. SUU Validator Layer

The SUU package should be the canonical source of truth for:

- card schema validity
- version compatibility
- closed-vocabulary component rules
- profile-specific safety rules for host apps such as RebelAI

Recommended validator responsibilities:

- Validate card structure for the current SUU version.
- Validate `image_display` templates and regular cards through the same canonical parser.
- Enforce profile-level rules such as:
  - no external URLs unless explicitly allowed by the host profile
  - no `data:` or `javascript:` URLs
  - no unknown executable semantics
  - no unsupported action shapes
  - asset references restricted to approved formats such as internal asset tokens
- Return normalized diagnostics with severity and machine-readable codes.

## Recommended Interface

RebelAI should depend on a single SUU validation entry point instead of local schema copies.

Example shape:

```ts
type SuuValidationOutcome = 'ok' | 'warning' | 'incompatible' | 'unsafe'

type SuuValidationIssue = {
  code: string
  message: string
  path?: Array<string | number>
  severity: 'warning' | 'error'
}

type SuuValidationResult = {
  outcome: SuuValidationOutcome
  detectedVersion?: string
  normalized?: unknown
  issues: SuuValidationIssue[]
}

validateSuuCard(input, {
  kind: 'ui_card' | 'image_display',
  profile: 'rebelai-import',
})
```

For `ui_cards`, RebelAI should validate each named card independently and aggregate the results.

## Import Policy

Validation results should be interpreted as follows.

### Reject Immediately

- `unsafe`
- malformed JSON that exceeds importer safety caps
- payloads that cannot be parsed by the validator at all

This bucket is for content that is dangerous or operationally unsafe to store and render.

### Allow With Warning

- `warning`
- `incompatible` during the initial rollout period

This bucket is for content that appears safe but is outside the currently supported RebelAI + SUU contract.

Warnings should be recorded in import logs and surfaced in job output so the operator can see exactly what was accepted with caveats.

### Allow Silently

- `ok`

## Versioning Strategy

Because SUU is still evolving quickly, the validator should treat compatibility as explicit rather than implied.

Recommended rules:

- Cards may optionally include a `suu_version` or `schema_version`.
- The validator should detect the declared or inferred version.
- RebelAI should not hardcode per-version field rules beyond the import safety caps.
- Compatibility decisions should come from the SUU validator, not from RebelAI importer code.

This keeps the version matrix in one place.

## Rollout Plan

### Phase 1: Validator Integration

- Add importer-side size and complexity caps.
- Call the SUU validator during import.
- Hard-reject only `unsafe`.
- Record `warning` and `incompatible` diagnostics, but still allow import.

### Phase 2: Evidence Gathering

- Run representative real cards through the validator.
- Review which diagnostics are frequent.
- Tighten the RebelAI import profile only where there is a clear safety or operational reason.

### Phase 3: Policy Tightening

- Optionally upgrade selected `incompatible` cases from warning to reject.
- Keep this narrow and based on observed breakage or security risk, not hypothetical purity.

## Design Principles

- Security policy should be stricter than compatibility policy.
- Unsupported does not automatically mean unsafe.
- RebelAI should own admission policy, not the full SUU grammar.
- SUU should own the canonical schema and compatibility matrix.
- New restrictions should be introduced with representative card fixtures, not only abstract rules.

## Implementation Notes

Recommended first implementation order:

1. Add this design as the source-of-truth plan.
2. Add importer complexity caps for raw SUU payloads.
3. Add a single SUU validator call path for `ui_card`, `ui_cards`, and `image_display`.
4. Persist validation warnings in import diagnostics.
5. Only after real-card evaluation, decide whether any `incompatible` cases should become hard rejects.

## Recommendation

Implement this plan, but do not start with a fully strict importer.

The right first step is:

- strict on obviously unsafe input
- warning-first on compatibility drift
- canonical schema ownership in SUU

That gives RebelAI a real admission layer now without forcing importer churn on every SUU update.
