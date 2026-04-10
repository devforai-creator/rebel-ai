# Claude Batch Chat Mode v1

## Goal

Add an opt-in Claude Batch mode for high-cost Opus chat turns. The mode trades streaming and latency for Anthropic Message Batches API pricing, currently 50% of standard input and output token rates.

## Scope

- Expose the mode only when the selected key resolves to Anthropic Opus 4.5 or Opus 4.6.
- Keep normal streaming as the default.
- Submit one chat turn per Message Batch in v1.
- Poll the provider opportunistically from the job status endpoint and from the internal runner.
- Reuse the existing assistant finalization path so message variants, usage events, summaries, and translation triggers remain consistent.

## Non-Goals

- Do not batch multiple users' turns together in v1.
- Do not use Claude fast mode with Batch API.
- Do not make this the default for all Anthropic models.
- Do not promise a fixed completion time; Anthropic batches can run up to the provider processing window.

## Flow

1. The chat UI sends `deliveryMode: "anthropic_batch"` for supported Opus keys when the user enables slow mode.
2. `/api/chat` validates the resolved key/model and stores the job with `delivery_mode = "anthropic_batch"`.
3. The normal chat job runner claims the pending job, builds the same prompt plan used by streaming, and submits it to `/v1/messages/batches`.
4. The job remains `processing` with the external batch id and metadata needed to finalize the message later.
5. Polling checks the provider batch status. When it ends, the result JSONL is read, the assistant text and usage are finalized through `runPostGenerationPipeline`, and the job becomes `success`.

## Risks

- A user who closes the page may not drive polling until the runner is triggered again.
- Anthropic validates batch request params asynchronously, so request-shape errors arrive only after the batch ends.
- Long-running `processing` jobs must not be treated as stuck by the existing short job timeout.
