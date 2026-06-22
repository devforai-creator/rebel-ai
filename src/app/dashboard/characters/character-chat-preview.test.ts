import { describe, expect, it } from 'vitest'
import { toCharacterChatPreview } from './character-chat-preview'

describe('toCharacterChatPreview', () => {
  it('keeps only a short normalized preview of the latest message', () => {
    const content = ` ${'alpha '.repeat(80)}\n\nomega `

    const result = toCharacterChatPreview({
      id: 'chat-1',
      title: 'Imported chat',
      updated_at: '2026-06-22T01:00:00.000Z',
      created_at: '2026-06-22T00:00:00.000Z',
      messages: [{ role: 'user', content }],
    })

    expect(result).toMatchObject({
      id: 'chat-1',
      title: 'Imported chat',
      lastMessage: {
        role: 'user',
      },
    })
    expect(result.lastMessage?.content.length).toBeLessThanOrEqual(243)
    expect(result.lastMessage?.content.endsWith('...')).toBe(true)
    expect(result.lastMessage?.content).not.toContain('\n')
  })

  it('drops malformed latest message data', () => {
    expect(
      toCharacterChatPreview({
        id: 'chat-1',
        title: null,
        updated_at: '2026-06-22T01:00:00.000Z',
        created_at: '2026-06-22T00:00:00.000Z',
        messages: [{ role: null, content: 'hello' }],
      }).lastMessage,
    ).toBeNull()
  })
})
