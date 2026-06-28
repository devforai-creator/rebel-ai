/** @vitest-environment jsdom */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SummaryMemoryTreeSection } from './MemorySections'

afterEach(cleanup)

describe('SummaryMemoryTreeSection interactions', () => {
  it('reveals covered child chunks when their meta parent is expanded', () => {
    render(
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
      />,
    )

    const childToggle = screen.getByRole('button', { name: 'Chunk Summaries (1)' })
    expect(childToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Covered child content')).toBeNull()

    fireEvent.click(childToggle)

    expect(childToggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('Covered child content')).not.toBeNull()
  })
})
