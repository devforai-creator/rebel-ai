# Long-Term Memory Strategy

Updated: 2026-04-20

This document is the active doctrine for RebelAI's long-term memory direction.

Use this document when deciding:

- what the first-class long-chat path should optimize for now,
- what role summaries, ATR, and episodic RAG each play,
- which memory paths are core vs secondary vs experimental, and
- what kind of future memory-policy model would actually fit the product philosophy.

This is not a line-by-line implementation spec.
Use code, tests, and narrower design notes for exact behavior.

## 1. Current Direction

The current operating direction is:

- `prefix_live_blocks` for the operator-default chat memory mode
- summary-backed sealed memory as the durable long-term substrate
- ATR as the preferred path for recovering exact older detail when needed
- episodic RAG as a secondary, lower-priority path that stays available but is not treated as the main answer

In practical terms:

- the first-class long-chat path should be able to work well with `prefix_live_blocks + summaries + ATR`
- episodic RAG should not be required for the maintained default path
- cost and operational simplicity now matter more than preserving episodic RAG as a first-class surface

## 2. Why Episodic RAG Is Being Demoted

The current concern is not that embeddings are useless in general.
The concern is that, in long chat histories, embeddings-backed episodic retrieval is too expensive relative to the quality it reliably provides.

Observed failure mode:

- as chats become very long, semantic top-k retrieval tends to collapse toward recent semantically similar facts
- this often misses older but actually reply-shaping events
- the system keeps paying for fact extraction, embedding generation, and retrieval infrastructure even when the practical gain is low

This is treated as a memory-topology problem more than an embedding-model-quality problem.
The failure is not only "the embedding model is weak."
The deeper issue is that one retrieval layer is being asked to do too much:

- discover what old information matters,
- rank it correctly under current conversational pressure,
- and recover enough detail for the final answer

That is too much responsibility for semantic similarity alone.

## 3. The Real Problem To Solve

"Provide context that fits the current state" is not the same problem as "find semantically similar text."

The real task is:

- identify which older information would materially change the next answer,
- decide whether compressed memory is enough,
- and escalate to exact source recovery only when needed

That means the core problem is better described as **context admission policy** or **context assembly policy**, not just retrieval.

## 4. Evolution Of Context Selection

The current doctrine should be read as a three-stage shift:

- past: rely heavily on embedding-backed semantic retrieval to decide which older context should come back
- present: let the main LLM, with summaries plus ATR, do more of the judgment about whether older exact source detail is actually needed
- future: build a smaller planner / reranker / distilled policy layer whose explicit job is deciding what context should be admitted

This is the main philosophical change.
The real target is not "better retrieval" in the abstract.
The real target is a system that is specialized for selecting the right context for the next answer.

## 5. Role Split

The current intended role split is:

- summaries: durable compression and broad long-history continuity
- `prefix_live_blocks`: stable raw recent context with lower churn and better cache behavior
- ATR: bounded exact-source verification when older detail really matters
- episodic RAG: optional heuristic candidate discovery, not the main long-term memory contract

This is the key doctrine shift:

- ATR is closer to the preferred "exactness recovery" mechanism
- episodic RAG is no longer the primary answer to long-term memory quality

## 6. Support Stance

Current stance:

- first-class: `prefix_live_blocks + summaries + ATR`
- maintained fallback: `summary_window`
- secondary / low-priority experimental surface: episodic RAG and facts-based semantic retrieval

Implications:

- episodic RAG can remain in the codebase without being treated as the product's main long-memory promise
- it should be safe to reduce investment there when the cost/benefit is poor
- future changes should avoid making episodic RAG a hidden dependency of the first-class path

## 7. Current Product Policy

Near-term policy:

- keep episodic RAG available for explicit evaluation and niche cases
- keep it off by default unless there is a specific reason to enable it
- do not require episodic RAG for the operator-default long-chat experience
- prefer spending complexity budget on ATR quality, summary quality, and sealed-memory structure before spending it on making episodic RAG more elaborate

When episodic RAG is disabled:

- new episodic facts are not generated
- embedding vectors are not created
- stored episodic facts are not injected into prompt context

This makes the toggle meaning clearer and avoids paying ongoing cost for a path that is not active.

## 8. Future Target

The future target is not "a better embedding stack" by itself.
The future target is a smaller memory-policy model that decides how context should be assembled.

Working idea:

- a planner / reranker / distilled policy model outputs a **context assembly plan**
- that plan decides whether the current answer needs:
  - only recent raw context,
  - only summaries,
  - persistent state,
  - ATR over a bounded older source range,
  - or some combination

This is intentionally different from the final response model.
Its job is not to answer the user directly.
Its job is to decide what historical material is worth admitting into the answering context.

## 9. What "Future Planner" Means Here

This does **not** mean training a brand-new large foundation model first.

The realistic progression is:

- keep the current summary + ATR path as the main operating system
- collect clearer heuristics and failure cases
- eventually build a smaller planner/reranker or distilled policy layer
- keep ATR as the exact-source recovery tool under that planner

So the likely future stack is:

- summaries/facts as compressed memory artifacts
- a memory-policy model for admission planning
- ATR for exact source verification
- the main chat model for final generation

## 10. Historical Notes

Older docs are still useful, but they are no longer the best single statement of the current doctrine.

- [memory-modes-v1.md](./memory-modes-v1.md): historical implementation/design note for the memory-mode split
- [experimental-agentic-transcript-recall.md](./experimental-agentic-transcript-recall.md): ATR experiment contract and isolation rules

Read those as implementation context, not as the current top-level strategy.
