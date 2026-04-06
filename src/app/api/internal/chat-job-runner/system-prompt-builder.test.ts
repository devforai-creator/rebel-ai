import { describe, expect, it } from 'vitest'

describe('buildSystemPrompt', () => {
  it('composes default prompt, post-history instructions, character prompt, and persona info', async () => {
    const { buildSystemPrompt } = await import('./system-prompt-builder')

    const result = await buildSystemPrompt({
      character: {
        id: 'char-1',
        name: 'Hero',
        system_prompt: 'CHAR PROMPT',
        post_history_instructions: 'POST HISTORY',
      },
      persona: { name: 'Bob', description: 'Loves coffee' },
      defaultSystemPrompt: 'GLOBAL PROMPT',
      customSystemPrompt: null,
    })

    expect(result).toBe(
      'GLOBAL PROMPT\n\n---\n\nPOST HISTORY\n\n---\n\nCHAR PROMPT\n\n---\n\n[User Information]\nYour name is: Bob\n\nLoves coffee',
    )
  })

  it('prefers custom system prompt over the default prompt and trims blank fields', async () => {
    const { buildSystemPrompt } = await import('./system-prompt-builder')

    const result = await buildSystemPrompt({
      character: {
        id: 'char-1',
        name: 'Hero',
        system_prompt: '   CHAR PROMPT   ',
        post_history_instructions: '   ',
      },
      persona: null,
      defaultSystemPrompt: 'GLOBAL PROMPT',
      customSystemPrompt: '   CUSTOM PROMPT   ',
    })

    expect(result).toBe('CUSTOM PROMPT\n\n---\n\nCHAR PROMPT')
  })

  it('uses only the active plain-text prompt fields', async () => {
    const { buildSystemPrompt } = await import('./system-prompt-builder')

    const result = await buildSystemPrompt({
      character: {
        id: 'char-1',
        name: 'Hero',
        system_prompt: 'CHAR PROMPT',
        post_history_instructions: 'POST HISTORY',
      },
      persona: { name: 'Alice', description: null },
      defaultSystemPrompt: 'GLOBAL PROMPT',
      customSystemPrompt: null,
    })

    expect(result).toBe(
      'GLOBAL PROMPT\n\n---\n\nPOST HISTORY\n\n---\n\nCHAR PROMPT\n\n---\n\n[User Information]\nYour name is: Alice',
    )
  })
})
