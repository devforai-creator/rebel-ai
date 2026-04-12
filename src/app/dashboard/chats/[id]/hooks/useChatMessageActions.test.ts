import { describe, expect, it } from 'vitest'

import { buildDeleteMessageDescription } from './useChatMessageActions'

describe('buildDeleteMessageDescription', () => {
  it('returns a neutral fallback when no message is pending', () => {
    expect(buildDeleteMessageDescription(null)).toBe(
      'This message will be removed from the chat history.',
    )
  })

  it('normalizes whitespace and truncates long previews', () => {
    const longContent = `First line\n\nSecond line   with extra spacing ${'x'.repeat(160)}`

    const description = buildDeleteMessageDescription({
      id: 'message-1',
      role: 'assistant',
      content: longContent,
    })

    expect(description).toContain(
      'This permanently deletes the selected message.\n\n"First line Second line with extra spacing ',
    )
    expect(description.endsWith('…"')).toBe(true)
  })

  it('drops the preview when the content is blank', () => {
    expect(
      buildDeleteMessageDescription({
        id: 'message-2',
        role: 'user',
        content: '   ',
      }),
    ).toBe('This permanently deletes the selected message.')
  })
})
