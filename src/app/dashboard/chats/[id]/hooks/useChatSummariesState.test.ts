import { describe, expect, it } from 'vitest'

import {
  applyRealtimeCollectionChange,
  type FactEntry,
  type SummaryEntry,
} from './useChatSummariesState'

describe('applyRealtimeCollectionChange', () => {
  it('appends new records on insert and ignores duplicate inserts', () => {
    const previousItems: SummaryEntry[] = [
      {
        id: 'summary-1',
        level: 0,
        start_seq: 1,
        end_seq: 20,
        summary: 'First chunk',
        created_at: '2026-04-12T00:00:00.000Z',
      },
    ]

    const insertedItems = applyRealtimeCollectionChange(previousItems, {
      eventType: 'INSERT',
      new: {
        id: 'summary-2',
        level: 1,
        start_seq: 1,
        end_seq: 40,
        summary: 'Meta summary',
        created_at: '2026-04-12T01:00:00.000Z',
      },
      old: { id: 'summary-2' },
    })

    expect(insertedItems.map((item) => item.id)).toEqual(['summary-1', 'summary-2'])
    expect(
      applyRealtimeCollectionChange(insertedItems, {
        eventType: 'INSERT',
        new: insertedItems[1],
        old: { id: insertedItems[1].id },
      }),
    ).toEqual(insertedItems)
  })

  it('updates existing records in place on update', () => {
    const previousItems: FactEntry[] = [
      {
        id: 'fact-1',
        start_seq: 1,
        end_seq: 8,
        facts: 'Old fact',
        created_at: '2026-04-12T00:00:00.000Z',
      },
      {
        id: 'fact-2',
        start_seq: 9,
        end_seq: 16,
        facts: 'Other fact',
        created_at: '2026-04-12T01:00:00.000Z',
      },
    ]

    expect(
      applyRealtimeCollectionChange(previousItems, {
        eventType: 'UPDATE',
        new: {
          ...previousItems[0],
          facts: 'Updated fact',
        },
        old: { id: previousItems[0].id },
      }),
    ).toEqual([
      {
        ...previousItems[0],
        facts: 'Updated fact',
      },
      previousItems[1],
    ])
  })

  it('removes records on delete', () => {
    const previousItems: SummaryEntry[] = [
      {
        id: 'summary-1',
        level: 0,
        start_seq: 1,
        end_seq: 20,
        summary: 'First chunk',
        created_at: '2026-04-12T00:00:00.000Z',
      },
      {
        id: 'summary-2',
        level: 1,
        start_seq: 1,
        end_seq: 40,
        summary: 'Meta summary',
        created_at: '2026-04-12T01:00:00.000Z',
      },
    ]

    expect(
      applyRealtimeCollectionChange(previousItems, {
        eventType: 'DELETE',
        new: previousItems[1],
        old: { id: 'summary-1' },
      }),
    ).toEqual([previousItems[1]])
  })
})
