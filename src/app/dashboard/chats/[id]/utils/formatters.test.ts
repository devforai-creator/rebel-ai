import { describe, expect, it } from 'vitest'
import {
  formatServiceTierLabel,
  formatTokenValue,
  formatUsd,
  isAssistantRole,
  shouldRefreshTokenStats,
} from './formatters'

describe('chat formatter utils', () => {
  it('formats token counts and assistant-role checks', () => {
    expect(formatTokenValue(1234)).toBe('1,234')
    expect(formatTokenValue(null)).toBe('—')
    expect(isAssistantRole('assistant')).toBe(true)
    expect(isAssistantRole('user')).toBe(false)
  })

  it('formats USD values across all display tiers', () => {
    expect(formatUsd(undefined)).toBe('—')
    expect(formatUsd(0)).toBe('$0.0000')
    expect(formatUsd(0.0043)).toBe('$0.0043')
    expect(formatUsd(0.245)).toBe('$0.245')
    expect(formatUsd(12.345)).toBe('$12.35')
  })

  it('refreshes token stats only for assistant inserts, deletes, and meaningful updates', () => {
    expect(
      shouldRefreshTokenStats({
        eventType: 'INSERT',
        new: { role: 'assistant' },
        old: null,
      }),
    ).toBe(true)

    expect(
      shouldRefreshTokenStats({
        eventType: 'DELETE',
        new: null,
        old: { role: 'assistant' },
      }),
    ).toBe(true)

    expect(
      shouldRefreshTokenStats({
        eventType: 'UPDATE',
        new: { role: 'assistant', prompt_tokens: 10, completion_tokens: 20 },
        old: { role: 'assistant', prompt_tokens: 10, completion_tokens: 20 },
      }),
    ).toBe(false)

    expect(
      shouldRefreshTokenStats({
        eventType: 'UPDATE',
        new: { role: 'assistant', prompt_tokens: 12, completion_tokens: 20 },
        old: { role: 'assistant', prompt_tokens: 10, completion_tokens: 20 },
      }),
    ).toBe(true)

    expect(
      shouldRefreshTokenStats({
        eventType: 'UPDATE',
        new: { role: 'user', prompt_tokens: 12 },
        old: { role: 'user', prompt_tokens: 10 },
      }),
    ).toBe(false)
  })

  it('formats service tier labels with a standard fallback', () => {
    expect(formatServiceTierLabel()).toBe('Standard')
    expect(formatServiceTierLabel('standard')).toBe('Standard')
    expect(formatServiceTierLabel('priority')).toBe('Priority')
  })
})
