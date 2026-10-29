/** @vitest-environment jsdom */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SummaryEntry } from './hooks/useChatSummariesState'
import ChatSummariesPanel from './ChatSummariesPanel'

vi.mock('./hooks', () => ({
  useChatSummariesState: ({
    initialSummaries,
    totalMessages,
  }: {
    initialSummaries: SummaryEntry[]
    totalMessages: number
  }) => ({
    summaries: initialSummaries,
    facts: [],
    messageCount: totalMessages,
    editingSummaryId: null,
    summaryEditContent: '',
    setSummaryEditContent: vi.fn(),
    editingFactId: null,
    factEditContent: '',
    setFactEditContent: vi.fn(),
    reembeddingFactId: null,
    regeneratingSummaryId: null,
    regeneratingFactId: null,
    isRefreshingStats: false,
    refreshStats: vi.fn(),
    startSummaryEdit: vi.fn(),
    cancelSummaryEdit: vi.fn(),
    saveSummaryEdit: vi.fn(),
    startFactEdit: vi.fn(),
    cancelFactEdit: vi.fn(),
    saveFactEdit: vi.fn(),
    handleReembedFact: vi.fn(),
    handleRegenerateSummary: vi.fn(),
    handleRegenerateFacts: vi.fn(),
    handleDeleteSummary: vi.fn(),
  }),
}))

afterEach(cleanup)

function chunks(count: number): SummaryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `chunk-${index + 1}`,
    level: 0,
    start_seq: index * 10 + 1,
    end_seq: index * 10 + 10,
    summary: `chunk ${index + 1}`,
    created_at: '2026-10-29T00:00:00.000Z',
  }))
}

function panel(summaries: SummaryEntry[], totalMessages: number, retainTailMessages = 4) {
  return (
    <ChatSummariesPanel
      chatId="chat-1"
      summaries={summaries}
      facts={[]}
      totalMessages={totalMessages}
      latestSequence={totalMessages}
      memoryConfig={{ mode: 'prefix_live_blocks', retainTailMessages }}
    />
  )
}

function cardFor(summary: SummaryEntry) {
  const card = screen.getByText(summary.summary).closest('article')
  if (!card) throw new Error(`Missing summary card: ${summary.id}`)
  return within(card)
}

describe('ChatSummariesPanel prefix prompt badges', () => {
  it('marks the first five chunks In prompt at the 50-message rollover before any meta exists', () => {
    const summaries = chunks(6)
    render(panel(summaries, 64))
    fireEvent.click(screen.getByRole('button', { name: /Summary Structure/ }))

    for (const summary of summaries.slice(0, 5)) {
      expect(cardFor(summary).queryByText('In prompt')).not.toBeNull()
      expect(cardFor(summary).queryByText('Stored')).toBeNull()
    }
    expect(cardFor(summaries[5]).queryByText('Stored')).not.toBeNull()
    expect(cardFor(summaries[5]).queryByText('In prompt')).toBeNull()
  })

  it('recalculates badges when the message count or protected tail changes without new summaries', () => {
    const summaries = chunks(5)
    const { rerender } = render(panel(summaries, 53))
    fireEvent.click(screen.getByRole('button', { name: /Summary Structure/ }))
    expect(screen.queryAllByText('In prompt')).toHaveLength(0)

    rerender(panel(summaries, 54))
    expect(screen.queryAllByText('In prompt')).toHaveLength(5)

    rerender(panel(summaries, 54, 5))
    expect(screen.queryAllByText('In prompt')).toHaveLength(0)
    expect(screen.queryAllByText('Stored')).toHaveLength(5)
  })

  it('keeps chunks Stored when a missing summary prevents a safe rollover', () => {
    const summaries = chunks(5).filter((summary) => summary.start_seq !== 21)
    render(panel(summaries, 54))
    fireEvent.click(screen.getByRole('button', { name: /Summary Structure/ }))

    expect(screen.queryAllByText('In prompt')).toHaveLength(0)
    expect(screen.queryAllByText('Stored')).toHaveLength(4)
  })
})
