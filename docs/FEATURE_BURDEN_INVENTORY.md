# Feature Burden Inventory

Created: 2026-07-04

This is a first-pass memory aid for features that may have outlived the product
assumption that created them.

It is not a removal plan and not an exact source of truth. Code, tests,
migrations, generated types, and the active deployment still define exact
behavior.

Use this document to answer:

- what feature surfaces currently exist
- which ones still fit the current first-class operating mode
- which ones are useful but should stay isolated
- which ones may be forgotten, parked, or candidates for future removal

## Current Product Lens

The current first-class shape is:

- closed or maintainer-operated deployment
- self-hosted / BYOK / data-ownership-first
- `RBX + SUU` as the native character and rendering direction
- authenticated chat request -> queue -> runner -> durable turn state
- private asset delivery
- operator memory default: `prefix_live_blocks + summaries + ATR`
- public default, when public mode exists later: `summary_window`

Anything outside that lens can still be valuable, but it should pay rent through
clear current use, low maintenance burden, or a credible path back into the
main product.

## Classification

- `core`: belongs to the maintained first-class path
- `supported-secondary`: supports the current operating contract or realistic
  maintainer operation
- `quarantined`: useful or plausible, but should stay opt-in, isolated, and
  easy to disable
- `parked`: preserve data/code for now, but stop presenting it as active product
  surface unless usage proves it should return
- `removal-candidate`: no new investment; isolate first, then delete when safe
- `decision-needed`: the code, docs, or current usage picture is not clear
  enough to classify honestly

## Audit Questions

Ask these before expanding, hiding, or removing a feature:

1. Does this serve the current maintainer-operated first-class path?
2. Is the maintainer actively using it now?
3. Does it touch request admission, runner execution, durable writes, secrets,
   or operator health?
4. Does it add schema, RLS, provider, background job, or test surface area?
5. Can it fail without changing core chat success?
6. Can it be disabled without data repair?
7. Is there a smaller way to keep the value while reducing user-facing or
   runner-facing complexity?

## First-Pass Inventory

| Surface                                              | Current read                                                                                               | Burden now                                                                                                                                                                    | Suggested stance                                  | Next check                                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `RBX + SUU` import/rendering                         | Native product direction and reduced trust surface.                                                        | Parser, importer, assets, renderer, validation, docs.                                                                                                                         | `core`                                            | Keep extending this instead of reopening raw HTML/script-like surfaces.                                                                      |
| Authenticated queued chat path                       | Main product loop: request, persistence, queue, runner, assistant finalization.                            | High, but justified.                                                                                                                                                          | `core`                                            | Keep verification concentrated in `npm run verify:core`.                                                                                     |
| Private asset delivery                               | Current storage contract for character/module assets.                                                      | Storage policy, signed/authenticated delivery, janitors.                                                                                                                      | `core`                                            | Keep one backend path until measured pressure exists.                                                                                        |
| `prefix_live_blocks + summaries + ATR`               | Current operator memory direction. ATR is strategically important, but still has experimental-style gates. | Runner context assembly, summary state, ATR env/account/chat gates, provider tool paths.                                                                                      | `core direction / decision-needed implementation` | Decide whether ATR should appear as its own support-tier feature or remain under memory strategy.                                            |
| `summary_window`                                     | Public-safe and system fallback memory mode.                                                               | Summary generation and fallback summary status.                                                                                                                               | `supported-secondary`                             | Keep as maintained fallback; do not treat as disposable.                                                                                     |
| Summary generation and summary status                | Supports both operator default and fallback.                                                               | Internal route, model preference, trigger health, summary UI.                                                                                                                 | `supported-secondary`                             | Keep durable triage evidence for failures.                                                                                                   |
| Local maintainer RBX import                          | Solves real oversized-archive operator pain without widening normal import UX.                             | Local-only route, script, env guardrails.                                                                                                                                     | `supported-secondary`                             | Keep maintainer-prefixed command as the supported name.                                                                                      |
| Health, triage, smoke checks, janitors               | Required for low-cost operation and post-deploy confidence.                                                | Internal routes, durable service health, smoke script.                                                                                                                        | `supported-secondary`                             | Continue aligning triage stages with actual failure stages.                                                                                  |
| Chat usage stats panel                               | Cost visibility for BYOK operation. Disabled by default to avoid extra background requests.                | Usage events, stats route, account toggle, UI panel.                                                                                                                          | `supported-secondary`                             | Keep as visibility, not as a public cost guardrail substitute.                                                                               |
| Episodic RAG / `chat_facts` / embeddings             | Previously important long-term memory path; now demoted by doctrine.                                       | Tables, embeddings, Voyage key settings, fact extraction, retrieval RPC, realtime, eval/backfill scripts.                                                                     | `quarantined`                                     | Check live usage: `enable_episodic_rag`, `chat_facts`, embedding columns, and recent eval activity before parking deeper.                    |
| Bilingual Memory / translation                       | Previously useful token-cost idea; now apparently rarely used. Still user-visible and runner-adjacent.     | `profiles.translation_api_key_id`, `messages.content_en`, account UI, translate action, public/internal routes, runner context query, post-generation trigger, triage signal. | `parked candidate`                                | First consider hiding or developer-gating UI/actions. Before schema removal, check non-null `translation_api_key_id` and `content_en` usage. |
| Message reprocess                                    | Experimental rewrite/styling path for assistant messages.                                                  | Account settings, message action, standalone invocation service, route/tests, writes back to messages.                                                                        | `quarantined`                                     | Decide whether it belongs in normal message actions or only developer/advanced mode.                                                         |
| Message translate action                             | Direct user-facing translation route overlaps with Bilingual Memory infrastructure.                        | Visible on every persisted message, even when translation is not configured.                                                                                                  | `parked candidate`                                | Consider hiding until translation is configured, or moving behind advanced/developer controls.                                               |
| Anthropic Batch chat mode                            | Provider-specific alternate delivery mode, env-gated and explicitly not first-class.                       | Delivery-mode admission, batch orchestrator, job polling, result finalization, provider-specific tests.                                                                       | `quarantined`                                     | Keep only if actively tested or expected to matter soon; otherwise park more visibly.                                                        |
| Google explicit cache                                | Optional optimization adapter with known boundary risks.                                                   | Provider-specific cache creation, request strategy, error fallback, ATR/tool compatibility concerns.                                                                          | `quarantined optimization`                        | Preserve the removable adapter contract from `GOOGLE_CACHE_BOUNDARY.md`.                                                                     |
| OpenAI / Anthropic prompt-cache knobs                | Optional cost/performance tuning. Mostly env-gated and adapter-shaped.                                     | Provider option logic, debug/cost metadata, tests.                                                                                                                            | `quarantined optimization`                        | Keep out of product UX unless current operation depends on it.                                                                               |
| Alternate models / secondary API key mode            | Chat model config supports alternating primary/secondary keys. Current product value is unclear.           | Chat settings state, persisted model config, UI controls, tests.                                                                                                              | `decision-needed`                                 | Decide whether this is still a real workflow, or whether response-variant/model comparison should replace it later.                          |
| Response variant history/browser                     | Data model now retains variants, but UI browser is parked.                                                 | Turn/message variant model is core-adjacent; browser UI is not built.                                                                                                         | `parked`                                          | Reopen only from real usage need; start with read-only latest-turn browser.                                                                  |
| Personas                                             | User identity/persona layer used in current chat experience.                                               | Persona CRUD, prompt injection, chat linkage.                                                                                                                                 | `core`                                            | Upcoming `character_saves` work should reduce misuse of personas as cross-session canon.                                                     |
| Character saves                                      | Not implemented; parked product decision for cross-session canon.                                          | Future schema/UI/runner prompt injection.                                                                                                                                     | `parked future core candidate`                    | Promote only after current recent-characters backlog frees the active slot.                                                                  |
| Modules / lorebook overrides / RisuAI module support | Supports richer character portability and RBX/Risu imports.                                                | Multiple tables, asset ownership, module management UI, lorebook runtime, override identity.                                                                                  | `supported-secondary / decision-needed`           | Audit whether all preset/module/global-variable surfaces are still needed for the current RBX+SUU center.                                    |
| Character import queues and upload staging           | Standard import UX and background processing.                                                              | Upload buckets, import jobs, runners, timeouts, rights metadata.                                                                                                              | `core / supported-secondary`                      | Keep, but distinguish native RBX import from legacy compatibility/import staging.                                                            |
| Custom system prompt override                        | Advanced chat-level customization.                                                                         | Chat setting, prompt builder, route/tests.                                                                                                                                    | `supported-secondary`                             | Keep if actively useful; low concern if it stays isolated from core admission.                                                               |
| Announcements                                        | Admin-operated banner surface.                                                                             | Admin flag, announcements table, API/UI.                                                                                                                                      | `decision-needed`                                 | Decide whether closed personal deployment still needs this or whether it is public-product residue.                                          |
| Feedback box                                         | Captures user feedback in dashboard.                                                                       | `user_feedback` table and dashboard form.                                                                                                                                     | `decision-needed`                                 | If this is single-operator only, decide whether it still earns UI space.                                                                     |
| Provider expansion: DeepSeek / OpenRouter            | Broadens BYOK provider choice.                                                                             | Provider catalog, model factory, key rules, pricing, tests.                                                                                                                   | `decision-needed`                                 | Keep providers that are actively used; avoid treating provider count as free.                                                                |
| Legacy asset URL compatibility                       | Explicitly marked removal-tier compatibility.                                                              | Fuzzy asset lookup and old template compatibility branches.                                                                                                                   | `removal-candidate`                               | Measure whether current assets still depend on it; isolate then delete when safe.                                                            |
| Raw HTML / unsafe legacy card surfaces               | Mostly removed/rejected, but tests and docs still guard against regression.                                | Compatibility tests and validation rules.                                                                                                                                     | `removal-candidate guardrail`                     | Keep rejection tests; do not re-expand execution-like surfaces.                                                                              |

## Immediate Recommendations

1. Do not start by deleting schema-heavy features.
2. Start by reducing user-facing and runner-facing surface for features that are
   not actively used.
3. Treat Bilingual Memory as the first concrete audit candidate because it has
   visible UI, DB columns, runner contact, background triggers, routes, and
   triage surface.
4. Treat episodic RAG as the first memory-topology audit candidate because the
   current doctrine already demotes it.
5. Treat alternate models as the first UX-workflow audit candidate because its
   relationship to future variant/model comparison is unclear.
6. Keep optional provider-cache work behind removable adapters, not product
   promises.

## Useful Usage Checks

Run these against the active database before moving a feature from
`quarantined` to `parked` or `removal-candidate`:

```sql
select count(*) from public.profiles where translation_api_key_id is not null;
select count(*) from public.messages where content_en is not null;
select count(*) from public.profiles where enable_episodic_rag = true;
select count(*) from public.chat_facts;
select count(*) from public.chat_facts where embedding is not null;
select count(*) from public.chat_generation_jobs where delivery_mode = 'anthropic_batch';
select count(*) from public.chats where model_config ? 'alternateModels';
select count(*) from public.user_feedback;
select count(*) from public.announcements;
```

These counts do not make the decision by themselves. They tell us whether a
cleanup is only code cleanup, or whether it needs data migration, user
communication, or a temporary compatibility path.

## Open Unknowns

- Which optional features are used in the maintainer's real deployment today?
- Which features are valuable only because they are visible and easy to reach?
- Which features would still be missed if the UI affordance disappeared for a
  month?
- Which provider-specific paths are worth carrying for BYOK identity, and which
  are mostly leftover experiments?
- Should ATR graduate from "experimental implementation path" into a clearer
  support-tier feature because it is part of the operator memory direction?

## Next Pass

For the next pass, pick one surface and write a small burden note:

- current usage evidence
- exact UI/API/DB/runner/test touch points
- failure behavior when disabled
- smallest reversible de-emphasis step
- conditions for keeping, parking, or removal

Suggested first surface: Bilingual Memory.
