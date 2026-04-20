import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChatMemoryConfig } from '@/lib/chat/model-config'
import ChatSummariesPanel, {
  getEmptyStateText,
  getMemoryDescription,
  getNextMemoryCheckpoint,
} from './ChatSummariesPanel'
vi.mock('./hooks', () => ({
  useChatSummariesState: () => ({
    summaries: [
      {
        id: 'summary-1',
        level: 1,
        start_seq: 1,
        end_seq: 100,
        summary: 'Meta summary content',
        created_at: '2026-04-20T00:00:00.000Z',
      },
    ],
    facts: [
      {
        id: 'fact-1',
        start_seq: 11,
        end_seq: 20,
        facts: 'Fact content',
        created_at: '2026-04-20T00:00:00.000Z',
      },
    ],
    messageCount: 104,
    currentLatestSequence: 104,
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

function createMemoryConfig(overrides: Required<ChatMemoryConfig>): Required<ChatMemoryConfig> {
  return overrides
}

describe('ChatSummariesPanel memory stats copy', () => {
  it('uses canonical chunk checkpoints for summary_window', () => {
    const memoryConfig = createMemoryConfig({
      mode: 'summary_window',
      sealEveryMessages: 100,
      retainTailMessages: 4,
    })

    expect(getNextMemoryCheckpoint(0, memoryConfig)).toBe(20)
    expect(getNextMemoryCheckpoint(19, memoryConfig)).toBe(20)
    expect(getNextMemoryCheckpoint(20, memoryConfig)).toBe(30)
    expect(getNextMemoryCheckpoint(223, memoryConfig)).toBe(230)
  })

  it('uses canonical chunk checkpoints for prefix mode instead of legacy 96-message blocks', () => {
    const memoryConfig = createMemoryConfig({
      mode: 'prefix_live_blocks',
      sealEveryMessages: 100,
      retainTailMessages: 4,
    })

    expect(getNextMemoryCheckpoint(0, memoryConfig)).toBe(14)
    expect(getNextMemoryCheckpoint(13, memoryConfig)).toBe(14)
    expect(getNextMemoryCheckpoint(14, memoryConfig)).toBe(24)
    expect(getNextMemoryCheckpoint(223, memoryConfig)).toBe(224)
  })

  it('describes prefix mode using canonical chunk generation language', () => {
    const memoryConfig = createMemoryConfig({
      mode: 'prefix_live_blocks',
      sealEveryMessages: 100,
      retainTailMessages: 4,
    })

    expect(getMemoryDescription(memoryConfig)).toContain('latest 4 messages raw')
    expect(getMemoryDescription(memoryConfig)).toContain('canonical 10-message memory chunks')
    expect(getMemoryDescription(memoryConfig)).not.toContain(
      'live conversation raw until 100 messages',
    )
    expect(getEmptyStateText(memoryConfig)).toContain('after 14 messages')
  })

  it('starts summary sections collapsed by default', () => {
    const html = renderToStaticMarkup(
      <ChatSummariesPanel
        chatId="chat-1"
        summaries={[]}
        facts={[]}
        totalMessages={104}
        latestSequence={104}
        memoryConfig={createMemoryConfig({
          mode: 'prefix_live_blocks',
          sealEveryMessages: 100,
          retainTailMessages: 4,
        })}
      />,
    )

    expect(html).toContain('Meta Summary (1)')
    expect(html).toContain('Episodic Memory (1)')
    expect(html).toContain('▶')
    expect(html).not.toContain('Meta summary content')
    expect(html).not.toContain('Fact content')
  })
})
