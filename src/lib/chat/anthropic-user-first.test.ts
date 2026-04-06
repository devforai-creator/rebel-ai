import { describe, expect, it } from 'vitest'

import { ensureUserFirstForAnthropic } from './anthropic-user-first'

describe('ensureUserFirstForAnthropic', () => {
  it('returns empty input unchanged', () => {
    const result = ensureUserFirstForAnthropic([])
    expect(result.messages).toEqual([])
    expect(result.placeholderAdded).toBe(false)
  })

  it('leaves user-first conversations unchanged', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
    ]

    const result = ensureUserFirstForAnthropic(messages)

    expect(result.messages).toEqual(messages)
    expect(result.placeholderAdded).toBe(false)
  })

  it('prepends a placeholder when conversation starts with assistant', () => {
    const messages = [
      { role: 'assistant' as const, content: 'Starting response' },
      { role: 'user' as const, content: 'Question' },
    ]

    const result = ensureUserFirstForAnthropic(messages)

    expect(result.messages).toEqual([{ role: 'user', content: '(continue)' }, ...messages])
    expect(result.placeholderAdded).toBe(true)
  })
})
