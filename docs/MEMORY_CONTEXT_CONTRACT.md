# Memory context contract

Conversation generation, user drafts, the memory panel loader, and the panel's stats refresh
use `src/lib/chat-memory/load-memory-state.ts`. Memory message counts include only the active
user/assistant projection from `chat_turns`. Standalone system messages, inactive variants,
pending candidates, orphan message rows, and gaps in physical `messages.sequence` do not
advance memory ordinals. Regeneration excludes the target turn's assistant only if it still
has an active assistant.

The loader returns the conversation count and all summary pages together. A generation
request reuses its computed prefix state when loading the raw tail and building the prompt;
it does not fetch a newer summary boundary halfway through that request. The browser uses
the same pure `resolvePrefixSummaryState` policy with the loaded count and summary rows.

The prefix rollover remains 50 messages, canonical chunks remain 10 messages, and canonical
meta summaries remain 100 messages. The protected raw tail and complete summary coverage
must both permit a rollover. Missing or unreadable summaries keep the affected history raw.

## Required gate

```sh
npm run test:memory-contract
npm run build
```

`npm run build` runs the contract gate before starting Next.js, including on Git-triggered
Vercel builds. The gate forces `NODE_ENV=test` only in its test subprocess, so a production
build environment still runs React interaction tests correctly. A failed contract prevents
the build from being published. CI also runs the gate explicitly, and the existing pre-push
`npm run verify` includes it through the full test suite.

The integration suite uses the actual runner context entry point, draft entry point and
outbound request, panel server loader, panel hooks, rendered badges, and stats route. Only
database transport, authentication, provider generation, Vault access, and router navigation
are replaced. Do not mock memory loading, projection, selection, or prompt assembly in this
suite, or supply a precomputed cutoff in place of the entry points.

Coverage includes the 53/54 and 103/104 boundaries, later rollovers, delayed/missing chunks,
inactive variants, system messages, non-contiguous sequences, regeneration, mode switches,
stats refresh, and summary pagination beyond 1,000 rows. It checks both server/UI agreement
and independent expected raw-message coverage, so making both sides wrong together still
fails the gate.

## Regression proof

Before closing a change to this contract, temporarily restore a known divergence, run
`npm run build`, confirm that the contract assertions fail before Next.js starts, restore
the source, and rerun the gate. For this closure the negative checks cover:

- UI selection restricted to the latest meta boundary, reproducing the old `Stored` drift.
- UI message counts taken from physical message rows instead of the active conversation.

Never commit or deploy the temporary divergent source. Record the checks and results in
the change report.

The panel describes the selection for its current loaded state. A completed response can
have used an earlier state if background summarization has since advanced; comparison of
separate requests at different times is not a same-snapshot contract violation.
