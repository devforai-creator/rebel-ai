import { describe, expect, it } from 'vitest'

import {
  accumulateSummary,
  extractRunSummary,
  normalizeExperimentalRecall,
  parseFixture,
  readRequestIdFromDebugInfo,
  renderReport,
  summarizePair,
} from './run-agentic-transcript-recall-eval.js'

describe('run-agentic-transcript-recall-eval helpers', () => {
  it('parses fixtures and rejects empty case sets', () => {
    expect(
      parseFixture(
        JSON.stringify({
          title: 'Transcript recall eval',
          cases: [
            {
              caseId: 'promise-wording',
              focus: 'Does recall preserve the exact promise wording?',
              baselineMessageId: 'message-a',
              experimentalMessageId: 'message-b',
            },
          ],
        }),
      ),
    ).toMatchObject({
      title: 'Transcript recall eval',
      cases: [{ caseId: 'promise-wording' }],
    })

    expect(() => parseFixture(JSON.stringify({ cases: [] }))).toThrow(
      'Eval fixture must contain a non-empty `cases` array.',
    )
  })

  it('extracts request ids and experimental recall metrics from debug info', () => {
    const debugInfo = {
      requestId: 'req-1',
      experimental: {
        agenticTranscriptRecall: {
          configured: true,
          enabled: true,
          wrapperUsed: true,
          fallbackToStandard: false,
          toolCallCount: 1,
          toolFetchCount: 1,
          toolBlockCount: 0,
          toolTotalMessagesFetched: 6,
          toolLastBlockReason: null,
        },
      },
    }

    expect(readRequestIdFromDebugInfo(debugInfo)).toBe('req-1')
    expect(normalizeExperimentalRecall(debugInfo)).toEqual({
      configured: true,
      enabled: true,
      wrapperUsed: true,
      fallbackToStandard: false,
      toolCallCount: 1,
      toolFetchCount: 1,
      toolBlockCount: 0,
      toolTotalMessagesFetched: 6,
      toolLastBlockReason: null,
    })
  })

  it('builds comparable run summaries from message rows and usage events', () => {
    const baseline = extractRunSummary(
      {
        id: 'message-a',
        chat_id: 'chat-1',
        content: 'baseline',
        prompt_tokens: 100,
        completion_tokens: 20,
        latency_ms: 900,
        created_at: '2026-04-20T00:00:00.000Z',
        debug_info: {
          requestId: 'req-a',
          modelConfig: { finishReason: 'stop' },
        },
      },
      {
        total_cost_usd: 0.012,
      },
    )
    const experimental = extractRunSummary(
      {
        id: 'message-b',
        chat_id: 'chat-1',
        content: 'experimental',
        prompt_tokens: 110,
        completion_tokens: 25,
        latency_ms: 1200,
        created_at: '2026-04-20T00:01:00.000Z',
        debug_info: {
          requestId: 'req-b',
          modelConfig: { finishReason: 'stop' },
          experimental: {
            agenticTranscriptRecall: {
              wrapperUsed: true,
              fallbackToStandard: false,
              toolCallCount: 1,
              toolFetchCount: 1,
              toolBlockCount: 0,
              toolTotalMessagesFetched: 4,
              toolLastBlockReason: null,
            },
          },
        },
      },
      {
        total_cost_usd: 0.015,
      },
    )

    expect(baseline.totalTokens).toBe(120)
    expect(experimental.experimentalRecall.toolFetchCount).toBe(1)
    expect(summarizePair({ baseline, experimental })).toEqual({
      latencyDeltaMs: 300,
      tokenDelta: 15,
      totalCostDeltaUsd: 0.003,
    })
  })

  it('renders a markdown report with summary and case-level details', () => {
    const cases = [
      {
        caseId: 'promise-wording',
        focus: 'Preserve the exact promise wording.',
        qualityWinner: 'experimental',
        qualityNotes: 'The experimental run cited the promise more precisely.',
        baseline: {
          messageId: 'message-a',
          latencyMs: 900,
          totalTokens: 120,
          totalCostUsd: 0.012,
          experimentalRecall: {
            wrapperUsed: null,
            fallbackToStandard: null,
            toolCallCount: null,
            toolFetchCount: null,
            toolBlockCount: null,
            toolTotalMessagesFetched: null,
            toolLastBlockReason: null,
          },
        },
        experimental: {
          messageId: 'message-b',
          latencyMs: 1200,
          totalTokens: 135,
          totalCostUsd: 0.015,
          experimentalRecall: {
            wrapperUsed: true,
            fallbackToStandard: false,
            toolCallCount: 1,
            toolFetchCount: 1,
            toolBlockCount: 0,
            toolTotalMessagesFetched: 4,
            toolLastBlockReason: null,
          },
        },
        comparison: {
          latencyDeltaMs: 300,
          tokenDelta: 15,
          totalCostDeltaUsd: 0.003,
        },
      },
    ]

    const summary = accumulateSummary(cases)
    const report = renderReport({
      title: 'Transcript recall eval',
      generatedAt: '2026-04-20T01:00:00.000Z',
      fixturePath: '/tmp/eval.json',
      cases,
      summary,
    })

    expect(report).toContain('# Experimental Transcript Recall Eval Report')
    expect(report).toContain('Quality winners: baseline 0, experimental 1, tie 0, undecided 0')
    expect(report).toContain('Experimental fallback frequency: 0/1')
    expect(report).toContain('### promise-wording')
    expect(report).toContain('keep / iterate / park: TBD')
  })
})
