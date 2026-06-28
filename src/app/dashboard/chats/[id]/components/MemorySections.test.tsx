import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FactMemorySection, SummaryMemoryTreeSection } from './MemorySections'

describe('SummaryMemoryTreeSection', () => {
  it('renders summary status, content, and controls when expanded', () => {
    const html = renderToStaticMarkup(
      <SummaryMemoryTreeSection
        structure={{
          metaNodes: [
            {
              summary: {
                id: 'summary-1',
                level: 1,
                start_seq: 1,
                end_seq: 40,
                summary: 'Conversation summary',
                summary_status: 'fallback',
                created_at: '2026-04-12T00:00:00.000Z',
              },
              children: [],
            },
          ],
          looseChunks: [],
        }}
        collapsed={false}
        onToggle={vi.fn()}
        editingSummaryId={null}
        summaryEditContent=""
        onChangeSummaryEditContent={vi.fn()}
        regeneratingSummaryId={null}
        onStartEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
        promptStatuses={{ 'summary-1': 'in_prompt' }}
      />,
    )

    expect(html).toContain('Summary Structure (1 · 1 fallback)')
    expect(html).toContain('Conversation summary')
    expect(html).toContain('Fallback')
    expect(html).toContain('♻️')
    expect(html).toContain('In prompt')
  })

  it('renders the edit textarea for the active summary entry', () => {
    const html = renderToStaticMarkup(
      <SummaryMemoryTreeSection
        structure={{
          metaNodes: [],
          looseChunks: [
            {
              id: 'summary-1',
              level: 0,
              start_seq: 1,
              end_seq: 20,
              summary: 'Chunk summary',
              created_at: '2026-04-12T00:00:00.000Z',
            },
          ],
        }}
        collapsed={false}
        onToggle={vi.fn()}
        editingSummaryId="summary-1"
        summaryEditContent="Editing summary"
        onChangeSummaryEditContent={vi.fn()}
        regeneratingSummaryId={null}
        onStartEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain('Editing summary')
    expect(html).toContain('Save')
    expect(html).toContain('Cancel')
    expect(html).not.toContain('Chunk summary</p>')
  })

  it('renders meta parents with collapsed child chunks and visible loose chunks', () => {
    const html = renderToStaticMarkup(
      <SummaryMemoryTreeSection
        structure={{
          metaNodes: [
            {
              summary: {
                id: 'meta-1',
                level: 1,
                start_seq: 1,
                end_seq: 100,
                summary: 'Meta summary content',
                summary_status: 'fallback',
                created_at: '2026-04-12T00:00:00.000Z',
              },
              children: [
                {
                  id: 'chunk-1',
                  level: 0,
                  start_seq: 1,
                  end_seq: 10,
                  summary: 'Covered child content',
                  created_at: '2026-04-12T00:00:00.000Z',
                },
              ],
            },
          ],
          looseChunks: [
            {
              id: 'chunk-2',
              level: 0,
              start_seq: 101,
              end_seq: 110,
              summary: 'Loose chunk content',
              created_at: '2026-04-12T00:00:00.000Z',
            },
          ],
        }}
        collapsed={false}
        onToggle={vi.fn()}
        editingSummaryId={null}
        summaryEditContent=""
        onChangeSummaryEditContent={vi.fn()}
        regeneratingSummaryId={null}
        onStartEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
        promptStatuses={{ 'meta-1': 'in_prompt', 'chunk-1': 'stored', 'chunk-2': 'stored' }}
      />,
    )

    expect(html).toContain('Summary Structure (3 · 1 fallback)')
    expect(html).toContain('Meta summary content')
    expect(html).toContain('Chunk Summaries (1)')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Covered child content')
    expect(html).toContain('Loose Chunks (1)')
    expect(html).toContain('Loose chunk content')
  })
})

describe('FactMemorySection', () => {
  it('renders episodic memory facts and controls when expanded', () => {
    const html = renderToStaticMarkup(
      <FactMemorySection
        facts={[
          {
            id: 'fact-1',
            start_seq: 5,
            end_seq: 10,
            facts: 'Met at a cafe',
            created_at: '2026-04-12T00:00:00.000Z',
          },
        ]}
        collapsed={false}
        onToggle={vi.fn()}
        editingFactId={null}
        factEditContent=""
        onChangeFactEditContent={vi.fn()}
        regeneratingFactId={null}
        reembeddingFactId={null}
        onStartEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onReembed={vi.fn()}
      />,
    )

    expect(html).toContain('Episodic Memory (1)')
    expect(html).toContain('Met at a cafe')
    expect(html).toContain('🔄')
  })
})
