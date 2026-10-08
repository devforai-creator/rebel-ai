import { describe, expect, it } from 'vitest'
import { renderLorebook } from './lorebook-renderer'

describe('renderLorebook recent keyword history', () => {
  it('includes the tenth most recent message and ignores the eleventh', () => {
    const history = Array.from({ length: 11 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 0 ? 'forgotten' : index === 1 ? 'BOUNDARY' : 'recent',
    }))

    const result = renderLorebook({
      lorebookEntries: [
        { key: 'forgotten', content: 'Old lore', scanDepth: 100 },
        { key: 'boundary', content: 'Boundary lore' },
        { key: 'recent', content: 'Recent lore' },
      ],
      chatHistory: history,
    })

    expect(result.activeEntries.map((entry) => entry.content)).toEqual([
      'Boundary lore',
      'Recent lore',
    ])
  })

  it('does not match system context or count it toward the ten conversation messages', () => {
    const result = renderLorebook({
      lorebookEntries: [
        { key: 'boundary', content: 'Conversation lore' },
        { key: 'injected', content: 'System lore' },
      ],
      chatHistory: [
        { role: 'user', content: 'boundary' },
        ...Array.from({ length: 9 }, () => ({ role: 'assistant', content: 'recent' })),
        { role: 'system', content: 'injected' },
      ],
    })

    expect(result.text).toBe('Conversation lore')
  })
})
