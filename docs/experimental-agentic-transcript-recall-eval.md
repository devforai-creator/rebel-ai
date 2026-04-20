# Experimental Agentic Transcript Recall Eval

Status: archived sidecar

Updated: 2026-04-20

This document defines a small local comparison workflow for the experimental
transcript-recall path.

This is no longer part of the active rollout contract.
Keep it only as an optional maintainer-side script for ad hoc comparison work.
It is not a product feature and it is not a durable operator surface.

## When To Use This

Use this only if you explicitly want to compare paired baseline vs experimental
assistant replies after the fact.

Do not treat this as required for normal experimental operation.
The active product-facing surface is the runtime itself plus request-level
`debug_info.experimental.agenticTranscriptRecall`.

## Historical Goal

Produce one compact comparison between:

- baseline summary-only replies
- bounded transcript-recall replies

for the same small set of long-chat cases.

The output should be enough to answer:

- did answer quality improve in the cases where exact wording matters
- what latency increase showed up
- what token and cost increase showed up
- how often the experimental path fell back or failed to fetch

## What Exists Now

The runner already records bounded transcript-recall metrics into assistant
`debug_info.experimental.agenticTranscriptRecall` when the message is finalized.

That includes:

- whether the wrapper path was used
- whether the request fell back to the standard path
- tool-call, fetch, and block counts
- fetched-message count
- last blocked reason

The evaluation script reads those fields plus `latency_ms`, token counts, and
the matching `chat_usage_events` row for each `requestId`.

## Inputs

Create a JSON fixture with paired assistant message ids.

Recommended location:

- `docs/evals/experimental-agentic-transcript-recall-cases.local.json`

Start from the example file:

- [experimental-agentic-transcript-recall-eval.fixture.example.json](./experimental-agentic-transcript-recall-eval.fixture.example.json)

Each case should pair:

- one baseline assistant message id
- one experimental assistant message id
- one short quality focus
- optional manual winner and notes

## How To Run

Requirements:

- local or remote Supabase URL in `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- assistant messages already exist for both baseline and experimental runs

Run:

```bash
npm run eval:transcript-recall -- docs/experimental-agentic-transcript-recall-eval.fixture.example.json
```

Optional output path:

```bash
npm run eval:transcript-recall -- docs/evals/experimental-agentic-transcript-recall-cases.local.json --output docs/reviews/experimental-agentic-transcript-recall-eval-report.local.md
```

The script prints the markdown report and writes it to the chosen output file.

## Optional Manual Workflow

1. Pick `3-5` long-chat cases where exact historical wording matters.
2. Produce one baseline reply with the experiment disabled.
3. Produce one experimental reply with the experiment enabled.
4. Record the paired assistant message ids in the fixture.
5. Fill `qualityWinner` and `qualityNotes` after reading both replies.
6. Run the eval script.
7. Copy the resulting metrics into the exit report template.

## Output

Historically, the generated report was meant to support one decision only:

- keep
- iterate
- park

That is no longer a hard rollout gate.
Provider support and experimental surface decisions may now be driven by direct
runtime testing and debug telemetry instead.
