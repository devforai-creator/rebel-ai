# Experimental Agentic Transcript Recall Eval

Updated: 2026-04-20

This document defines the smallest local workflow for evaluating the
experimental transcript-recall path that now exists in the chat runner.

Use this only for the current experimental queue.
It is not a product feature and it is not a durable operator surface.

## Goal

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

## Recommended Manual Workflow

1. Pick `3-5` long-chat cases where exact historical wording matters.
2. Produce one baseline reply with the experiment disabled.
3. Produce one experimental reply with the experiment enabled.
4. Record the paired assistant message ids in the fixture.
5. Fill `qualityWinner` and `qualityNotes` after reading both replies.
6. Run the eval script.
7. Copy the resulting metrics into the exit report template.

## Result

The generated report is meant to support one decision only:

- keep
- iterate
- park

Do not widen provider scope or product surface until that decision is written
down explicitly.
