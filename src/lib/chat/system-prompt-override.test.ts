import { describe, expect, it } from 'vitest'
import {
  hasCustomSystemPromptOverride,
  normalizeSystemPromptOverride,
  normalizeSystemPromptValue,
  parseSystemPromptOverrideInput,
} from './system-prompt-override'

describe('system-prompt-override', () => {
  it('normalizes blank values to null', () => {
    expect(normalizeSystemPromptValue('   ')).toBeNull()
    expect(normalizeSystemPromptOverride('   ', 'default prompt')).toBeNull()
  })

  it('treats values equal to the default prompt as no override', () => {
    expect(normalizeSystemPromptOverride('  default prompt  ', 'default prompt')).toBeNull()
    expect(hasCustomSystemPromptOverride('default prompt', ' default prompt ')).toBe(false)
  })

  it('preserves trimmed custom overrides', () => {
    expect(normalizeSystemPromptOverride('  custom prompt  ', 'default prompt')).toBe(
      'custom prompt',
    )
    expect(hasCustomSystemPromptOverride('custom prompt', 'default prompt')).toBe(true)
  })

  it('parses supported raw inputs and rejects unsupported ones', () => {
    expect(parseSystemPromptOverrideInput('  custom prompt  ', 'default prompt')).toEqual({
      success: true,
      systemPrompt: 'custom prompt',
    })
    expect(parseSystemPromptOverrideInput(null, 'default prompt')).toEqual({
      success: true,
      systemPrompt: null,
    })
    expect(parseSystemPromptOverrideInput(123, 'default prompt')).toEqual({
      success: false,
    })
  })
})
