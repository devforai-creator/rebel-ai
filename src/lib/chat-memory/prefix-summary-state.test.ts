import { describe, expect, it, vi } from 'vitest'
import {
  CHUNK_SIZE,
  SUMMARY_GROUP_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
} from '@/lib/chat-summaries/config'
import type { ChatSummariesSupabaseClient } from '@/lib/chat-summaries/types'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import type { PrefixSummarySelectionRow } from './prefix-summary-selection'
import { resolvePrefixSummaryState } from './prefix-summary-state'
import { loadPrefixSummaryRows } from './load-memory-state'

function chunks(count: number): PrefixSummarySelectionRow[] {
  return Array.from({ length: count }, (_, index) => ({
    level: SUMMARY_LEVEL_CHUNK,
    start_seq: index * 10 + 1,
    end_seq: index * 10 + 10,
    summary: `chunk ${index + 1}`,
  }))
}

function meta(start: number, end: number): PrefixSummarySelectionRow {
  return { level: SUMMARY_LEVEL_META, start_seq: start, end_seq: end, summary: 'meta' }
}

describe('resolvePrefixSummaryState', () => {
  it.each([
    [4, 0],
    [5, 50],
    [9, 50],
    [10, 100],
    [14, 100],
    [15, 150],
    [20, 200],
  ])('rolls over %i completed chunks through message %i without requiring a meta', (count, end) => {
    const state = resolvePrefixSummaryState(chunks(count).reverse())
    expect(state.visibleSummaryEnd).toBe(end)
    expect(state.summaries).toEqual(chunks(end / 10))
    expect(CHUNK_SIZE * SUMMARY_GROUP_SIZE).toBe(100)
  })

  it.each([
    [49, 0],
    [50, 50],
    [99, 50],
    [100, 100],
    [149, 100],
    [150, 150],
  ])('respects the retained tail when summaries exist beyond cutoff %i', (cutoff, end) => {
    const state = resolvePrefixSummaryState([...chunks(15), meta(1, 100)], cutoff)
    expect(state.visibleSummaryEnd).toBe(end)
    expect(state.summaries.every((row) => row.end_seq <= end)).toBe(true)
  })

  it('keeps raw history before a missing chunk instead of trusting the latest chunk end', () => {
    const rows = chunks(10).filter((row) => row.start_seq !== 31)
    expect(resolvePrefixSummaryState(rows)).toMatchObject({
      lastChunkEnd: 100,
      visibleSummaryEnd: 0,
      summaries: [],
    })

    const laterGap = chunks(15).filter((row) => row.start_seq !== 121)
    expect(resolvePrefixSummaryState(laterGap).visibleSummaryEnd).toBe(100)
  })

  it('uses existing 100-message metas to cover missing original chunks', () => {
    const rows = [...chunks(15).slice(10), meta(1, 100)]
    const state = resolvePrefixSummaryState(rows)
    expect(state.visibleSummaryEnd).toBe(150)
    expect(state.summaries).toEqual([meta(1, 100), ...chunks(15).slice(10)])
  })

  it('preserves the existing policy of retaining recent chunks before older metas', () => {
    const rows = [...chunks(20), meta(1, 100), meta(101, 200)]
    const state = resolvePrefixSummaryState(rows)
    expect(state.summaries).toEqual([meta(1, 100), ...chunks(20).slice(10)])
  })

  it('does not use super metas, blank summaries, or disconnected metas to hide raw messages', () => {
    const rows = [
      ...chunks(5).map((row) => (row.start_seq === 31 ? { ...row, summary: ' ' } : row)),
      { ...meta(1, 400), level: SUMMARY_LEVEL_SUPER_META },
      meta(101, 200),
    ]
    expect(resolvePrefixSummaryState(rows).visibleSummaryEnd).toBe(0)
  })
})

describe('loadPrefixSummaryRows', () => {
  it('loads all pages for long chats and keeps other chats out', async () => {
    const rows = chunks(1001)
    const supabase = createSupabaseMock({
      tables: {
        chat_summaries: {
          rows: [
            ...rows.map((row) => ({ ...row, chat_id: 'chat-1' })),
            { ...meta(1, 100), chat_id: 'other-chat' },
          ],
        },
      },
    }) as unknown as ChatSummariesSupabaseClient

    expect(await loadPrefixSummaryRows(supabase, 'chat-1')).toEqual(rows)
  })

  it('discards partial results on a later page error so the caller keeps the raw transcript', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: chunks(1000), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } })
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range,
    }
    const supabase = { from: () => query } as unknown as ChatSummariesSupabaseClient

    try {
      const rows = await loadPrefixSummaryRows(supabase, 'chat-1')
      expect(resolvePrefixSummaryState(rows).visibleSummaryEnd).toBe(0)
      expect(errorSpy).toHaveBeenCalledWith(
        '[chat-memory] Failed to load prefix summaries:',
        'unavailable',
      )
    } finally {
      errorSpy.mockRestore()
    }
  })
})
