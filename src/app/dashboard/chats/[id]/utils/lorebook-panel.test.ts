import { describe, expect, it } from 'vitest'
import type { LorebookEntry } from '@/types/lorebook.types'
import {
  filteredListFromGrouped,
  formatKeywordPreview,
  getOverrideMode,
  stripMarkdownForPreview,
} from './lorebook-panel'

function makeEntry(overrides: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    key: 'alpha, beta, gamma, delta',
    content: 'Entry content',
    comment: 'Entry label',
    mode: 'normal',
    insertorder: 10,
    alwaysActive: false,
    selective: false,
    useRegex: false,
    ...overrides,
  }
}

describe('filteredListFromGrouped', () => {
  it('flattens folder groups while preserving folder order', () => {
    const first = makeEntry({ key: 'first' })
    const second = makeEntry({ key: 'second' })
    const third = makeEntry({ key: 'third' })

    expect(
      filteredListFromGrouped({
        folderOrder: ['folder-b', 'folder-a'],
        folderMap: new Map([
          ['folder-a', [second, third]],
          ['folder-b', [first]],
        ]),
      }).map((entry) => entry.key),
    ).toEqual(['first', 'second', 'third'])
  })
})

describe('getOverrideMode', () => {
  it('returns auto when no override is stored', () => {
    const entry = makeEntry({ key: 'entry-key' })

    expect(getOverrideMode(entry, new Map())).toBe('auto')
  })
})

describe('formatKeywordPreview', () => {
  it('shows the first three keywords and tracks the remainder count', () => {
    expect(formatKeywordPreview('alpha, beta, gamma, delta')).toEqual({
      shown: ['alpha', 'beta', 'gamma'],
      hiddenCount: 1,
    })
  })
})

describe('stripMarkdownForPreview', () => {
  it('removes fenced blocks and markdown punctuation from preview text', () => {
    expect(
      stripMarkdownForPreview(
        '# Header\n> quote\n[Link](https://example.com)\n```ts\nconst a = 1\n```',
      ),
    ).toBe('Header quote Link')
  })
})
