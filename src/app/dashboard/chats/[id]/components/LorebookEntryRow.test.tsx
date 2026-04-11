import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LorebookEntryRow } from './LorebookEntryRow'

describe('LorebookEntryRow', () => {
  it('renders expanded entry preview and default override badge', () => {
    const html = renderToStaticMarkup(
      <LorebookEntryRow
        entry={{
          key: 'alpha, beta, gamma, delta',
          content: '# Heading\nSome **preview** text',
          comment: 'Entry Label',
          mode: 'normal',
          insertorder: 3,
          alwaysActive: false,
          selective: false,
          useRegex: false,
        }}
        overrideMap={new Map()}
        showPreview
        setEntryOverride={vi.fn(async () => null)}
        isExpanded
        onToggleExpand={vi.fn()}
      />,
    )

    expect(html).toContain('Entry Label')
    expect(html).toContain('Default')
    expect(html).toContain('+1')
    expect(html).toContain('Heading Some preview text')
    expect(html).toContain('# Heading')
  })
})
