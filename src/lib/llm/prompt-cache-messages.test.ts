import { describe, expect, it } from 'vitest'
import { buildChatContextRequest } from '@/lib/chat-memory/prompt-context'
import { buildConversationCacheMessages } from './prompt-cache'

const openai = { openai: { promptCacheBreakpoint: { mode: 'explicit' } } }
const request = () =>
  buildChatContextRequest({
    context: {
      instructions: 'System',
      memory: null,
      turnContext: 'Current lore and writing instruction',
    },
    messages: [
      { role: 'user', content: 'Stable setting and sealed memory' },
      { role: 'user', content: 'First question' },
      { role: 'user', content: 'Labelled NPC reply' },
    ],
  })

describe('conversation cache boundary projection', () => {
  it('preserves every reference endpoint for OpenAI drafts without caching the live tail', () => {
    const original = request()
    const snapshot = structuredClone(original)
    const before = buildConversationCacheMessages(original, openai, {
      preserveOpenAIMessageBoundaries: true,
    })
    const grown = buildChatContextRequest({
      context: {
        instructions: 'System',
        memory: null,
        turnContext: 'Changed lore and instruction',
      },
      messages: [
        ...original.messages.slice(0, original.cacheableMessageCount),
        { role: 'user', content: 'New question' },
        { role: 'user', content: 'New labelled NPC reply' },
      ],
    })
    const after = buildConversationCacheMessages(grown, openai, {
      preserveOpenAIMessageBoundaries: true,
    })
    expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, -1))
    for (const message of after.slice(1, -1)) {
      expect(message.content).toEqual([
        { type: 'text', text: expect.any(String), providerOptions: openai },
      ])
    }
    expect(after.at(-1)).toEqual(grown.messages.at(-1))
    expect(original).toEqual(snapshot)
  })

  it('keeps callers without the preservation option on the last-message policy', () => {
    const messages = buildConversationCacheMessages(request(), openai)
    expect(messages[1].content).toBe('Stable setting and sealed memory')
    expect(messages.at(-2)!.content).toEqual([
      { type: 'text', text: 'Labelled NPC reply', providerOptions: openai },
    ])
    expect(messages.at(-1)!.content).toContain('Current lore')
  })

  it('does not expand Anthropic breakpoints even if the OpenAI option is passed', () => {
    const anthropic = { anthropic: { cacheControl: { type: 'ephemeral' } } }
    expect(
      buildConversationCacheMessages(request(), anthropic, {
        preserveOpenAIMessageBoundaries: true,
      }),
    ).toEqual(buildConversationCacheMessages(request(), anthropic))
  })

  it('leaves a temporary-only request without a message breakpoint', () => {
    const empty = buildChatContextRequest({
      context: { instructions: 'System', memory: null, turnContext: 'Writing instruction' },
      messages: [],
    })
    const messages = buildConversationCacheMessages(empty, openai, {
      preserveOpenAIMessageBoundaries: true,
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'system', providerOptions: openai })
    expect(messages[1]).toEqual(empty.messages[0])
  })
})
