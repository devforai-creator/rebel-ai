import { describe, expect, it } from 'vitest'

import {
  formatRecentCharacterPreview,
  formatRecentCharacterRelativeTime,
} from './recent-character-formatters'

describe('formatRecentCharacterPreview', () => {
  it('normalizes whitespace and preserves short text', () => {
    expect(formatRecentCharacterPreview(' Hello\n\nthere   friend ')).toBe('Hello there friend')
  })

  it('truncates long text with a single ellipsis', () => {
    const formatted = formatRecentCharacterPreview('a'.repeat(200))

    expect(formatted).toHaveLength(160)
    expect(formatted.endsWith('…')).toBe(true)
  })
})

describe('formatRecentCharacterRelativeTime', () => {
  const referenceTime = Date.parse('2026-08-15T12:00:00.000Z')

  it.each([
    ['2026-08-15T11:59:30.000Z', 'just now'],
    ['2026-08-15T11:58:00.000Z', '2 minutes ago'],
    ['2026-08-15T10:00:00.000Z', '2 hours ago'],
    ['2026-08-14T12:00:00.000Z', '1 day ago'],
    ['2026-08-15T12:02:00.000Z', 'in 2 minutes'],
  ])('formats %s as %s', (timestamp, expected) => {
    expect(formatRecentCharacterRelativeTime(timestamp, referenceTime)).toBe(expected)
  })

  it('handles invalid input safely', () => {
    expect(formatRecentCharacterRelativeTime('invalid', referenceTime)).toBe('Unknown time')
  })
})
