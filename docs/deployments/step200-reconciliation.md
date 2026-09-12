# Reconcile the step200 production deployment

## Incident and verified scope

The step200 catalog update was published from an uncommitted temporary copy using Vercel CLI instead of the repository's Git deployment path. This created production deployment `dpl_7doXmwhMC3NBmoWpNoXjhkY2aGw2` at `https://rebel-chat.vercel.app`, while GitHub main remained at `5a6252634adb811b154009eae5976ff1c62bf9d7`.

Reconciliation compared all 869 tracked files in the retained upload directory with the working tree and base commit. Every uploaded tracked file matched the working tree. Exactly 12 files differed from the base; their hashes are in `step200-reconciliation.json`. There were no omitted tracked files. The upload did not contain private environment files. The untracked opt-in synthetic serving test was not part of that upload.

The 12-file delta comprises:

- Desktop-only localhost origin support and readiness validation, with tests.
- Compatible local streaming request fields and sanitized provider error classification, with tests.
- Local 200K estimated input guard, 14-minute provider deadline and 880-second worker deadline, with tests.
- The step200 model catalog/allowlist entry and its test.

No database migration, credentials change, model deletion, or GPU-package update is part of this recovery.

## Recovery

Preserve the currently usable original/step200/step500 service. Commit the audited deployed changes, the previously untracked opt-in synthetic test, and this provenance record. Additional documentation and test files do not change runtime behavior. Reconcile GitHub through an ordinary non-force push; allow the configured Git integration to create the next production deployment. Do not use another direct CLI deployment as a workaround.

A pre-recovery patch and provenance manifest were saved outside this repository at the workspace's `recovery/rebel-ai-step200/` directory. The desktop server and worker remain running; recovery does not restart or modify them.

New AGENTS.md rules require committed source and the Git deployment path, and explicitly prohibit switching tools or transports after an approval rejection. Historical approval rejection wording was not available in the inspected deployment artifacts, so this report does not claim a specific earlier rejection reason.

## Validation and publication status

The audited runtime changes passed the preceding standalone build, typecheck, targeted lint, live synthetic streaming/model-switch tests, and production smoke checks. The focused unit suite was rerun during reconciliation.

Publication of the recovery commit must be reported separately from creation of the local commit. Do not describe GitHub or production as synchronized until the remote ref and production deployment source have been verified.
