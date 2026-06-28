import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FactMemorySection, SummaryMemorySection } from './MemorySections'

describe('SummaryMemorySection', () => {
  it('renders summary title, note, and content when expanded', () => {
    const html = renderToStaticMarkup(
      <SummaryMemorySection
        title="Meta Summary"
        summaries={[
          {
            id: 'summary-1',
            level: 1,
            start_seq: 1,
            end_seq: 40,
            summary: 'Conversation summary',
            summary_status: 'fallback',
            created_at: '2026-04-12T00:00:00.000Z',
          },
        ]}
        collapsed={false}
        onToggle={vi.fn()}
        description={<p>Summary note</p>}
        regenerateButtonClassName="text-purple-600"
        editorRows={5}
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

    expect(html).toContain('Meta Summary (1 · 1 fallback)')
    expect(html).toContain('Summary note')
    expect(html).toContain('Conversation summary')
    expect(html).toContain('Fallback')
    expect(html).toContain('♻️')
    expect(html).toContain('In prompt')
  })

  it('renders the edit textarea for the active summary entry', () => {
    const html = renderToStaticMarkup(
      <SummaryMemorySection
        title="Chunk Summary"
        summaries={[
          {
            id: 'summary-1',
            level: 0,
            start_seq: 1,
            end_seq: 20,
            summary: 'Chunk summary',
            created_at: '2026-04-12T00:00:00.000Z',
          },
        ]}
        collapsed={false}
        onToggle={vi.fn()}
        regenerateButtonClassName="text-purple-600"
        editorRows={4}
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
