import { expect, it } from 'vitest'
import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'
import { clearStaleAssistantDebugInfo } from './post-generation-metadata'
import { buildUsageReceipt, readUsageReceipt } from '@/lib/chat/usage-receipt'
import { estimateUsageCost } from '@/lib/model-pricing'

it('removes old diagnostic prompts while retaining the answer receipt and exact legacy request identity', async () => {
  const usage = {
    promptTokens: 100,
    completionTokens: 20,
    cachedInputTokens: 200,
    cacheWriteTokens: 50,
  }
  const receipt = buildUsageReceipt({
    requestId: 'old-request',
    provider: 'anthropic',
    modelName: 'claude-opus-4-7',
    callCount: 1,
    usage,
    cost: estimateUsageCost({
      ...usage,
      provider: 'anthropic',
      modelName: 'claude-opus-4-7',
      cacheWriteTtl: '1h',
    }),
  })
  const db = createChatJobRunnerSupabaseMock({
    initialMessages: [
      {
        id: 'current',
        chat_id: 'chat',
        user_id: 'owner',
        role: 'assistant',
        debug_info: { requestId: 'current-request', fullPrompt: { system: 'current prompt' } },
      },
      {
        id: 'old',
        chat_id: 'chat',
        user_id: 'owner',
        role: 'assistant',
        debug_info: {
          requestId: 'old-request',
          usageReceipt: receipt,
          fullPrompt: { system: 'large prompt' },
          rawResponse: 'response',
        },
      },
      {
        id: 'legacy',
        chat_id: 'chat',
        user_id: 'owner',
        role: 'assistant',
        debug_info: { requestId: 'legacy-request', fullPrompt: { system: 'legacy prompt' } },
      },
      {
        id: 'other-chat',
        chat_id: 'other',
        user_id: 'owner',
        role: 'assistant',
        debug_info: { fullPrompt: { system: 'other' } },
      },
    ],
  })
  const options = {
    supabase: db as never,
    chatId: 'chat',
    userId: 'owner',
    apiKeyId: 'key',
    requestId: 'current-request',
    retainedAssistantMessageId: 'current',
  }
  await clearStaleAssistantDebugInfo(options)
  const old = db.messages.find((m) => m.id === 'old')!
  expect(old.debug_info).toEqual({
    usageOnly: true,
    requestId: 'old-request',
    usageReceipt: receipt,
  })
  expect(readUsageReceipt(old.debug_info)?.cost?.total).toBe(receipt.cost?.total)
  expect(db.messages.find((m) => m.id === 'legacy')!.debug_info).toEqual({
    usageOnly: true,
    requestId: 'legacy-request',
  })
  expect(db.messages.find((m) => m.id === 'current')!.debug_info).toHaveProperty('fullPrompt')
  expect(db.messages.find((m) => m.id === 'other-chat')!.debug_info).toHaveProperty('fullPrompt')
  await clearStaleAssistantDebugInfo(options)
  expect(old.debug_info).toEqual({
    usageOnly: true,
    requestId: 'old-request',
    usageReceipt: receipt,
  })
})
