import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoistedMocks = vi.hoisted(() => ({
  buildContextMock: vi.fn(),
}))

vi.mock('@/lib/chat-summaries', () => ({
  buildContext: (...args: unknown[]) => hoistedMocks.buildContextMock(...args),
}))

import { buildSummaryWindowMemoryPlan } from './summary-window'

describe('buildSummaryWindowMemoryPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoistedMocks.buildContextMock.mockResolvedValue({
      systemPrompt: 'BASE\n\nDYNAMIC',
      dynamicContext: 'DYNAMIC',
      recentMessages: [{ role: 'assistant', content: 'hello there', messageId: 'msg-2' }],
      ragInfo: {
        enabled: true,
        threshold: 0.75,
        topK: 3,
        results: [],
      },
    })
  })

  it('converts buildContext output into cache-aware prompt blocks', async () => {
    const result = await buildSummaryWindowMemoryPlan({
      supabase: {} as never,
      chatId: 'chat-1',
      sanitizedMessages: [{ role: 'assistant', content: 'hello there', messageId: 'msg-2' }],
      baseSystemPrompt: ' BASE ',
      extraDynamicContext: ['Lore'],
    })

    expect(hoistedMocks.buildContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        extraDynamicContext: ['Lore'],
      }),
    )
    expect(result.promptBlocks).toEqual([
      {
        role: 'system',
        content: 'BASE',
        cachePreference: 'prefer-cache',
        stability: 'static',
      },
      {
        role: 'system',
        content: 'DYNAMIC',
        cachePreference: 'avoid-cache',
        stability: 'sealed',
      },
      {
        role: 'assistant',
        content: 'hello there',
        cachePreference: 'avoid-cache',
        stability: 'live',
      },
    ])
  })
})
