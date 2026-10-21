# Chat prompt context and cache preservation

The memory layer returns a provider-independent `requestContext` alongside the existing
system blocks and conversation. It distinguishes stable instructions (including effective
always-active and pinned lore), conversation memory, and conditional lore for the current turn.
Lore activation, overrides, and ordering within each partition use the existing renderer.
The legacy combined lore ordering remains available for other provider adapters.

Google's adapter sends stable instructions as `systemInstruction`. Memory, conditional lore,
and the current ATR range inventory are attached to the latest user request in a labelled
application context block. Earlier conversation messages are unchanged. These temporary
blocks never enter canonical messages, summaries, lore keyword scanning, or bilingual history.
Assistant continuations receive a temporary user continuation message.

The explicit cache adapter consumes this same canonical request. It caches the system and
history, leaving the latest user request and its current context live. Cache creation failure
falls back to the identical canonical request. Argon remains implicit-cache-only. ATR attaches
tools without adding its instruction to the system a second time.

Prefix-mode user drafts reuse the common context builder and Google cache adapter.
For explicit cache preparation only, the draft builder puts the selected conditional lore
in its own application context block after the reference history, followed by a live block
containing only the writing instruction and draft task. This includes conditional lore in
the per-request cache without changing its precedence relative to history. Cache-off,
unsupported models (including Argon), and cache-create failures keep the original common
prefix request with conditional lore and the writing instruction together in the live tail.

Anthropic retains its existing system blocks and static cache breakpoint. Other providers
retain their current layout. Translation and summarization requests do not use chat lore or
this context layout. Future changes to their adapters should be tested independently.

`actualPayload.contextFingerprint` records versioned SHA-256 hashes of Google's stable system,
earlier conversation, and latest request. It follows the existing debug retention policy and
does not introduce a new prompt archive. Compare these alongside native cached input usage;
unchanged hashes do not guarantee a cache hit. Provider eviction, time gaps, model changes,
edited history, bilingual replacements, and summary rollovers can still invalidate reuse.

Changing the placement of conditional lore changes its precedence relative to history. Validate
card formatting, scene continuity, newly activated lore, and player agency with live outputs.
An initial request after this layout change usually needs to warm a new cache.
