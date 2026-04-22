import { describe, expect, it } from 'vitest'

import { parseSummaryWarningInfo, resolveVisibleSummaryWarning } from './summary-warning'

describe('parseSummaryWarningInfo', () => {
  it('extracts structured warning fields from debug_info', () => {
    expect(
      parseSummaryWarningInfo({
        summaryWarning: {
          error: 'summary failed',
          attempts: 2,
          timestamp: '2026-04-22T00:00:00.000Z',
        },
      }),
    ).toEqual({
      error: 'summary failed',
      attempts: 2,
      timestamp: '2026-04-22T00:00:00.000Z',
    })
  })

  it('returns null for unrelated or malformed payloads', () => {
    expect(parseSummaryWarningInfo(null)).toBeNull()
    expect(parseSummaryWarningInfo({})).toBeNull()
    expect(parseSummaryWarningInfo({ summaryWarning: 'bad' })).toBeNull()
  })
})

describe('resolveVisibleSummaryWarning', () => {
  it('keeps warnings visible when no newer memory artifacts exist', () => {
    expect(
      resolveVisibleSummaryWarning(
        {
          error: 'summary failed',
          attempts: 2,
          timestamp: '2026-04-22T10:00:00.000Z',
        },
        [{ created_at: '2026-04-22T09:59:00.000Z' }, { created_at: '2026-04-22T09:58:00.000Z' }],
      ),
    ).toEqual({
      error: 'summary failed',
      attempts: 2,
      timestamp: '2026-04-22T10:00:00.000Z',
    })
  })

  it('hides warnings once a newer memory artifact exists', () => {
    expect(
      resolveVisibleSummaryWarning(
        {
          error: 'summary failed',
          attempts: 2,
          timestamp: '2026-04-22T10:00:00.000Z',
        },
        [{ created_at: '2026-04-22T10:05:00.000Z' }],
      ),
    ).toBeNull()
  })
})
