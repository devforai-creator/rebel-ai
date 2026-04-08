import { describe, expect, it, vi } from 'vitest'

import { createChatJobRunnerSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { runPostGenerationPipeline } from './post-generation-pipeline'
import type { UsageMetrics } from './usage-debug'

async function flushSummaryBackgroundTask() {
  await Promise.resolve()
  await Promise.resolve()
}

function buildUsageMetrics(overrides: Partial<UsageMetrics> = {}): UsageMetrics {
  return {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    cachedInputTokens: null,
    reasoningTokens: null,
    ...overrides,
  }
}

describe('runPostGenerationPipeline', () => {
  it('finalizes existing assistant message and uses default summary model config', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      initialMessages: [
        {
          id: 'assistant-1',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'draft',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: null,
          user_id: 'user-1',
        },
        {
          id: 'assistant-old',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'old',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: { stale: true },
          user_id: 'user-1',
        },
      ],
    })

    const resolveSummaryModelPreferenceFn = vi.fn(async () => null)
    const triggerSummaryGenerationFn = vi.fn(async () => ({ success: true, attempts: 1 }))
    const triggerMessageTranslationFn = vi.fn()
    const debugInfo = { requestId: 'req-1' }
    const timeline = [100, 130, 200, 250]
    const now = () => timeline.shift() ?? 250
    const supabaseClient = supabase as unknown as SupabaseClientType

    const result = await runPostGenerationPipeline({
      supabase: supabaseClient,
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      origin: 'https://internal.example.com',
      requestId: 'req-1',
      assistantText: 'final answer',
      assistantMessageId: 'assistant-1',
      turnId: null,
      regenerateAssistantMessageId: null,
      promptTokens: 11,
      completionTokens: 22,
      debugInfo,
      bilingualEnabled: false,
      messageInsertDuration: 9,
      usage: buildUsageMetrics(),
      usageCost: null,
      triggerMessageTranslationFn,
      resolveSummaryModelPreferenceFn,
      triggerSummaryGenerationFn,
      now,
    })

    expect(result).toEqual({
      assistantMessageId: 'assistant-1',
      messageInsertDuration: 9,
      usageEventInsertDurationMs: 30,
      summaryTriggerDurationMs: 0,
    })

    expect(resolveSummaryModelPreferenceFn).toHaveBeenCalledWith({
      supabase,
      userId: 'user-1',
    })
    await flushSummaryBackgroundTask()
    expect(triggerSummaryGenerationFn).toHaveBeenCalledWith({
      origin: 'https://internal.example.com',
      chatId: 'chat-1',
      userId: 'user-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      apiKeyId: 'key-1',
    })
    expect(triggerMessageTranslationFn).not.toHaveBeenCalled()
    expect(supabase.usageEvents).toHaveLength(1)

    const finalized = supabase.messages.find((row) => row.id === 'assistant-1')
    expect(finalized).toMatchObject({
      content: 'final answer',
      model_used: 'gpt-4o-mini',
      prompt_tokens: 11,
      completion_tokens: 22,
      debug_info: debugInfo,
    })

    const oldAssistant = supabase.messages.find((row) => row.id === 'assistant-old')
    expect(oldAssistant).toMatchObject({
      debug_info: { stale: true },
    })
  })

  it('creates a new assistant variant for regeneration and keeps the prior variant as superseded', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      initialTurns: [
        {
          id: 'turn-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          turn_index: 1,
          user_message_id: 'user-1-msg',
          active_assistant_message_id: 'assistant-old',
        },
      ],
      initialMessages: [
        {
          id: 'user-1-msg',
          chat_id: 'chat-1',
          role: 'user',
          content: 'hello',
          turn_id: 'turn-1',
          variant_index: null,
          supersedes_message_id: null,
          message_status: 'completed',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: null,
          user_id: 'user-1',
        },
        {
          id: 'assistant-old',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'old answer',
          turn_id: 'turn-1',
          variant_index: 1,
          supersedes_message_id: null,
          message_status: 'completed',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: null,
          user_id: 'user-1',
        },
        {
          id: 'assistant-prev',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'older answer',
          turn_id: 'other-turn',
          variant_index: 1,
          supersedes_message_id: null,
          message_status: 'completed',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: { stale: true },
          user_id: 'user-1',
        },
      ],
    })

    const resolveSummaryModelPreferenceFn = vi.fn(async () => ({
      provider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
      apiKeyId: 'summary-key',
    }))
    const triggerSummaryGenerationFn = vi.fn(async () => ({
      success: false,
      error: 'summary failed',
      attempts: 2,
    }))
    const triggerMessageTranslationFn = vi.fn()
    const debugInfo = { requestId: 'req-2' }
    const timeline = [0, 10, 20, 32, 40, 55]
    const now = () => timeline.shift() ?? 55
    const supabaseClient = supabase as unknown as SupabaseClientType

    const result = await runPostGenerationPipeline({
      supabase: supabaseClient,
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      origin: 'https://internal.example.com',
      requestId: 'req-2',
      assistantText: 'new answer',
      assistantMessageId: null,
      turnId: 'turn-1',
      regenerateAssistantMessageId: 'assistant-old',
      promptTokens: 7,
      completionTokens: 12,
      debugInfo,
      bilingualEnabled: true,
      messageInsertDuration: null,
      usage: buildUsageMetrics({
        promptTokens: 7,
        completionTokens: 12,
        totalTokens: 19,
      }),
      usageCost: null,
      triggerMessageTranslationFn,
      resolveSummaryModelPreferenceFn,
      triggerSummaryGenerationFn,
      now,
    })

    expect(result.messageInsertDuration).toBe(10)
    expect(result.usageEventInsertDurationMs).toBe(12)
    expect(result.summaryTriggerDurationMs).toBe(0)
    expect(supabase.usageEvents).toHaveLength(1)

    await flushSummaryBackgroundTask()
    expect(triggerSummaryGenerationFn).toHaveBeenCalledWith({
      origin: 'https://internal.example.com',
      chatId: 'chat-1',
      userId: 'user-1',
      provider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
      apiKeyId: 'summary-key',
    })

    expect(triggerMessageTranslationFn).toHaveBeenCalledWith(result.assistantMessageId, 'user-1')

    const inserted = supabase.messages.find((row) => row.id === result.assistantMessageId)
    expect(inserted).toMatchObject({
      content: 'new answer',
      turn_id: 'turn-1',
      variant_index: 2,
      supersedes_message_id: 'assistant-old',
      message_status: 'completed',
      prompt_tokens: 7,
      completion_tokens: 12,
      debug_info: expect.objectContaining({
        requestId: 'req-2',
        summaryWarning: expect.objectContaining({
          error: 'summary failed',
          attempts: 2,
        }),
      }),
    })

    const superseded = supabase.messages.find((row) => row.id === 'assistant-old')
    expect(superseded).toMatchObject({
      message_status: 'superseded',
    })

    const staleAssistant = supabase.messages.find((row) => row.id === 'assistant-prev')
    expect(staleAssistant).toMatchObject({
      debug_info: { stale: true },
    })

    const updatedTurn = (supabase.state.chatTurns as Array<Record<string, unknown>>).find(
      (row) => row.id === 'turn-1',
    )
    expect(updatedTurn).toMatchObject({
      active_assistant_message_id: result.assistantMessageId,
    })
  })
})
