import { describe, expect, it, vi } from 'vitest'

import { createChatJobRunnerSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import type { SummaryModelConfig } from '@/lib/chat/summary-model-preference'
import { runPostGenerationPipeline } from './post-generation-pipeline'
import type { UsageMetrics } from './usage-debug'

type RecordedFilter = {
  field: string
  value: unknown
  op?: 'eq' | 'neq' | 'not' | 'in' | 'gte' | 'lte'
  operator?: string
}

type MockError = {
  message: string
  code?: string | null
}

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

function matchesFilters(filters: RecordedFilter[], expected: RecordedFilter[]) {
  return expected.every(({ field, value }) =>
    filters.some((filter) => filter.field === field && filter.value === value),
  )
}

function wrapMutationBuilder(
  builder: {
    eq: (field: string, value: unknown) => unknown
    neq?: (field: string, value: unknown) => unknown
    not?: (field: string, operator: string, value: unknown) => unknown
    in?: (field: string, values: unknown[]) => unknown
    gte?: (field: string, value: unknown) => unknown
    lte?: (field: string, value: unknown) => unknown
    then: (...args: unknown[]) => Promise<unknown>
    select?: (columns?: string) => {
      single: () => Promise<{ data: Record<string, unknown> | null; error: MockError | null }>
      maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: MockError | null }>
    }
  },
  shouldFail: (filters: RecordedFilter[]) => boolean,
  error: MockError,
) {
  const filters: RecordedFilter[] = []

  const wrapped = {
    eq(field: string, value: unknown) {
      filters.push({ field, value, op: 'eq' })
      builder.eq(field, value)
      return wrapped
    },
    neq(field: string, value: unknown) {
      filters.push({ field, value, op: 'neq' })
      builder.neq?.(field, value)
      return wrapped
    },
    not(field: string, operator: string, value: unknown) {
      filters.push({ field, value, op: 'not', operator })
      builder.not?.(field, operator, value)
      return wrapped
    },
    in(field: string, values: unknown[]) {
      filters.push({ field, value: values, op: 'in' })
      builder.in?.(field, values)
      return wrapped
    },
    gte(field: string, value: unknown) {
      filters.push({ field, value, op: 'gte' })
      builder.gte?.(field, value)
      return wrapped
    },
    lte(field: string, value: unknown) {
      filters.push({ field, value, op: 'lte' })
      builder.lte?.(field, value)
      return wrapped
    },
    select(columns?: string) {
      if (shouldFail(filters)) {
        return {
          single: async () => ({ data: null, error }),
          maybeSingle: async () => ({ data: null, error }),
        }
      }
      return (
        builder.select?.(columns) ?? {
          single: async () => ({ data: null, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        }
      )
    },
    then<TResult1 = { error: null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { error: MockError | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (shouldFail(filters)) {
        return Promise.resolve({ error }).then(onfulfilled, onrejected)
      }
      return builder.then(onfulfilled, onrejected)
    },
  }

  return wrapped
}

function wrapQueryBuilder(
  builder: {
    eq: (field: string, value: unknown) => unknown
    order: (field: string, options?: { ascending?: boolean }) => unknown
    limit: (count: number) => unknown
    maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: MockError | null }>
    single: () => Promise<{ data: Record<string, unknown> | null; error: MockError | null }>
  },
  shouldFail: (filters: RecordedFilter[]) => boolean,
  error: MockError,
) {
  const filters: RecordedFilter[] = []

  const wrapped = {
    eq(field: string, value: unknown) {
      filters.push({ field, value })
      builder.eq(field, value)
      return wrapped
    },
    order(field: string, options?: { ascending?: boolean }) {
      builder.order(field, options)
      return wrapped
    },
    limit(count: number) {
      builder.limit(count)
      return wrapped
    },
    maybeSingle: async () => {
      if (shouldFail(filters)) {
        return { data: null, error }
      }
      return builder.maybeSingle()
    },
    single: async () => {
      if (shouldFail(filters)) {
        return { data: null, error }
      }
      return builder.single()
    },
  }

  return wrapped
}

function withFromOverride<T extends { from: (table: string) => unknown }>(
  supabase: T,
  override: (table: string, handler: Record<string, unknown>) => Record<string, unknown> | null,
): T {
  const originalFrom = supabase.from.bind(supabase)

  ;(supabase as T).from = ((table: string) => {
    const handler = originalFrom(table) as Record<string, unknown>
    return override(table, handler) ?? handler
  }) as T['from']

  return supabase
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
      debug_info: null,
    })
  })

  it('logs and continues when post-generation metadata writes fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const supabase = withFromOverride(createChatJobRunnerSupabaseMock(), (table, handler) => {
        if (table === 'api_keys') {
          return {
            ...handler,
            update: (payload: Record<string, unknown>) =>
              wrapMutationBuilder(
                (
                  handler.update as (payload: Record<string, unknown>) => {
                    eq: (field: string, value: unknown) => unknown
                    then: (...args: unknown[]) => Promise<unknown>
                  }
                )(payload),
                () => true,
                { message: 'api key update failed', code: 'XX001' },
              ),
          }
        }

        if (table === 'chat_usage_events') {
          const failedInsertResult = {
            data: [] as Array<Record<string, unknown>>,
            error: { message: 'usage insert failed', code: 'XX002' },
          }

          return {
            ...handler,
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: failedInsertResult.error,
                }),
              }),
              then<TResult1 = typeof failedInsertResult, TResult2 = never>(
                onfulfilled?:
                  | ((value: typeof failedInsertResult) => TResult1 | PromiseLike<TResult1>)
                  | null
                  | undefined,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve(failedInsertResult).then(onfulfilled, onrejected)
              },
            }),
          }
        }

        return null
      })

      const triggerSummaryGenerationFn = vi.fn(async () => ({ success: true, attempts: 1 }))
      const result = await runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-postgen-warn',
        assistantText: 'final answer',
        assistantMessageId: 'assistant-1',
        turnId: null,
        regenerateAssistantMessageId: null,
        promptTokens: 11,
        completionTokens: 22,
        debugInfo: { requestId: 'req-postgen-warn' },
        bilingualEnabled: false,
        messageInsertDuration: 9,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn,
        now: () => 0,
      })

      expect(result).toMatchObject({
        assistantMessageId: 'assistant-1',
        messageInsertDuration: 9,
        summaryTriggerDurationMs: 0,
      })
      expect(supabase.usageEvents).toHaveLength(0)
      await flushSummaryBackgroundTask()
      expect(triggerSummaryGenerationFn).toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        '[Chat Job Runner] Failed to update api key last_used_at',
        expect.objectContaining({
          chatId: 'chat-1',
          userId: 'user-1',
          apiKeyId: 'key-1',
          requestId: 'req-postgen-warn',
          error: 'api key update failed',
        }),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[Chat Job Runner] Failed to insert chat usage event',
        expect.objectContaining({
          chatId: 'chat-1',
          userId: 'user-1',
          apiKeyId: 'key-1',
          requestId: 'req-postgen-warn',
          error: 'usage insert failed',
        }),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('treats duplicate usage event inserts as idempotent and does not warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const supabase = withFromOverride(createChatJobRunnerSupabaseMock(), (table, handler) => {
        if (table === 'chat_usage_events') {
          const duplicateInsertResult = {
            data: [] as Array<Record<string, unknown>>,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' },
          }

          return {
            ...handler,
            insert: () => ({
              then<TResult1 = typeof duplicateInsertResult, TResult2 = never>(
                onfulfilled?:
                  | ((value: typeof duplicateInsertResult) => TResult1 | PromiseLike<TResult1>)
                  | null
                  | undefined,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve(duplicateInsertResult).then(onfulfilled, onrejected)
              },
            }),
          }
        }

        return null
      })

      const result = await runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-postgen-duplicate',
        assistantText: 'final answer',
        assistantMessageId: 'assistant-1',
        turnId: null,
        regenerateAssistantMessageId: null,
        promptTokens: 11,
        completionTokens: 22,
        debugInfo: { requestId: 'req-postgen-duplicate' },
        bilingualEnabled: false,
        messageInsertDuration: 9,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      })

      expect(result).toMatchObject({
        assistantMessageId: 'assistant-1',
        messageInsertDuration: 9,
        summaryTriggerDurationMs: 0,
      })
      expect(supabase.usageEvents).toHaveLength(0)
      expect(warnSpy).not.toHaveBeenCalledWith(
        '[Chat Job Runner] Failed to insert chat usage event',
        expect.anything(),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('logs and continues when stale assistant debug_info cleanup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const supabase = withFromOverride(
        createChatJobRunnerSupabaseMock({
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
        }),
        (table, handler) => {
          if (table !== 'messages') {
            return null
          }

          return {
            ...handler,
            update: (payload: Record<string, unknown>) =>
              wrapMutationBuilder(
                (
                  handler.update as (payload: Record<string, unknown>) => {
                    eq: (field: string, value: unknown) => unknown
                    neq?: (field: string, value: unknown) => unknown
                    not?: (field: string, operator: string, value: unknown) => unknown
                    then: (...args: unknown[]) => Promise<unknown>
                  }
                )(payload),
                (filters) =>
                  payload.debug_info === null &&
                  matchesFilters(filters, [
                    { field: 'chat_id', value: 'chat-1' },
                    { field: 'role', value: 'assistant' },
                    { field: 'user_id', value: 'user-1' },
                  ]),
                { message: 'cleanup failed', code: 'XX003' },
              ),
          }
        },
      )

      const result = await runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-cleanup-warn',
        assistantText: 'final answer',
        assistantMessageId: 'assistant-1',
        turnId: null,
        regenerateAssistantMessageId: null,
        promptTokens: 11,
        completionTokens: 22,
        debugInfo: { requestId: 'req-cleanup-warn' },
        bilingualEnabled: false,
        messageInsertDuration: 9,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      })

      expect(result).toMatchObject({
        assistantMessageId: 'assistant-1',
        messageInsertDuration: 9,
      })
      expect(supabase.messages.find((row) => row.id === 'assistant-old')).toMatchObject({
        debug_info: { stale: true },
      })
      expect(warnSpy).toHaveBeenCalledWith(
        '[Chat Job Runner] Failed to clear stale assistant debug_info',
        expect.objectContaining({
          chatId: 'chat-1',
          userId: 'user-1',
          apiKeyId: 'key-1',
          requestId: 'req-cleanup-warn',
          error: 'cleanup failed',
        }),
      )
    } finally {
      warnSpy.mockRestore()
    }
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

    const resolveSummaryModelPreferenceFn = vi.fn(
      async (): Promise<SummaryModelConfig> => ({
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet',
        apiKeyId: 'summary-key',
      }),
    )
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
      debug_info: null,
    })

    const updatedTurn = (supabase.state.chatTurns as Array<Record<string, unknown>>).find(
      (row) => row.id === 'turn-1',
    )
    expect(updatedTurn).toMatchObject({
      active_assistant_message_id: result.assistantMessageId,
    })
  })

  it('removes the old assistant message for legacy regeneration without turn state', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      initialMessages: [
        {
          id: 'assistant-old',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'old answer',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: null,
          user_id: 'user-1',
        },
      ],
    })

    const result = await runPostGenerationPipeline({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      origin: 'https://internal.example.com',
      requestId: 'req-legacy-regen',
      assistantText: 'replacement answer',
      assistantMessageId: null,
      turnId: null,
      regenerateAssistantMessageId: 'assistant-old',
      promptTokens: 3,
      completionTokens: 4,
      debugInfo: { requestId: 'req-legacy-regen' },
      bilingualEnabled: false,
      messageInsertDuration: null,
      usage: buildUsageMetrics({
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      }),
      usageCost: null,
      triggerMessageTranslationFn: vi.fn(),
      resolveSummaryModelPreferenceFn: vi.fn(async () => null),
      triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
      now: () => 0,
    })

    expect(supabase.messages.find((row) => row.id === 'assistant-old')).toBeUndefined()
    expect(supabase.messages.find((row) => row.id === result.assistantMessageId)).toMatchObject({
      content: 'replacement answer',
      message_status: 'completed',
      turn_id: null,
    })
  })

  it('throws when legacy regeneration cannot remove the old assistant message', async () => {
    const supabase = withFromOverride(createChatJobRunnerSupabaseMock(), (table, handler) => {
      if (table !== 'messages') {
        return null
      }

      return {
        ...handler,
        delete: () =>
          wrapMutationBuilder(
            (
              handler.delete as () => {
                eq: (field: string, value: unknown) => unknown
                then: (...args: unknown[]) => Promise<unknown>
              }
            )(),
            (filters) =>
              matchesFilters(filters, [
                { field: 'id', value: 'assistant-old' },
                { field: 'chat_id', value: 'chat-1' },
                { field: 'user_id', value: 'user-1' },
              ]),
            { message: 'delete failed', code: 'XX001' },
          ),
      }
    })

    await expect(
      runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-delete-fail',
        assistantText: 'replacement answer',
        assistantMessageId: null,
        turnId: null,
        regenerateAssistantMessageId: 'assistant-old',
        promptTokens: 1,
        completionTokens: 1,
        debugInfo: { requestId: 'req-delete-fail' },
        bilingualEnabled: false,
        messageInsertDuration: null,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      }),
    ).rejects.toThrow('Failed to remove assistant message for regeneration')
  })

  it('throws when the chat turn cannot be loaded for assistant finalization', async () => {
    const supabase = withFromOverride(
      createChatJobRunnerSupabaseMock({
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
      }),
      (table, handler) => {
        if (table !== 'chat_turns') {
          return null
        }

        return {
          ...handler,
          select: (columns?: string) =>
            wrapQueryBuilder(
              (
                handler.select as (columns?: string) => {
                  eq: (field: string, value: unknown) => unknown
                  order: (field: string, options?: { ascending?: boolean }) => unknown
                  limit: (count: number) => unknown
                  maybeSingle: () => Promise<{
                    data: Record<string, unknown> | null
                    error: MockError | null
                  }>
                  single: () => Promise<{
                    data: Record<string, unknown> | null
                    error: MockError | null
                  }>
                }
              )(columns),
              (filters) =>
                matchesFilters(filters, [
                  { field: 'id', value: 'turn-1' },
                  { field: 'chat_id', value: 'chat-1' },
                ]),
              { message: 'turn lookup failed', code: 'XX001' },
            ),
        }
      },
    )

    await expect(
      runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-turn-load',
        assistantText: 'new answer',
        assistantMessageId: null,
        turnId: 'turn-1',
        regenerateAssistantMessageId: null,
        promptTokens: 2,
        completionTokens: 2,
        debugInfo: { requestId: 'req-turn-load' },
        bilingualEnabled: false,
        messageInsertDuration: null,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      }),
    ).rejects.toThrow('Failed to load chat turn for assistant finalization')
  })

  it('throws when the regeneration target is no longer the active assistant message', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      initialTurns: [
        {
          id: 'turn-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          turn_index: 1,
          user_message_id: 'user-1-msg',
          active_assistant_message_id: 'assistant-newest',
        },
      ],
      initialMessages: [
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
      ],
    })

    await expect(
      runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-stale-regen',
        assistantText: 'new answer',
        assistantMessageId: null,
        turnId: 'turn-1',
        regenerateAssistantMessageId: 'assistant-old',
        promptTokens: 2,
        completionTokens: 2,
        debugInfo: { requestId: 'req-stale-regen' },
        bilingualEnabled: false,
        messageInsertDuration: null,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      }),
    ).rejects.toThrow('Regeneration target is no longer the active assistant message')
  })

  it('rolls back the inserted assistant when updating the active assistant pointer fails', async () => {
    const supabase = withFromOverride(
      createChatJobRunnerSupabaseMock({
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
        ],
      }),
      (table, handler) => {
        if (table !== 'chat_turns') {
          return null
        }

        return {
          ...handler,
          update: (payload: Record<string, unknown>) =>
            wrapMutationBuilder(
              (
                handler.update as (payload: Record<string, unknown>) => {
                  eq: (field: string, value: unknown) => unknown
                  then: (...args: unknown[]) => Promise<unknown>
                }
              )(payload),
              (filters) =>
                payload.active_assistant_message_id !== 'assistant-old' &&
                matchesFilters(filters, [
                  { field: 'id', value: 'turn-1' },
                  { field: 'chat_id', value: 'chat-1' },
                ]),
              { message: 'turn update failed', code: 'XX001' },
            ),
        }
      },
    )

    await expect(
      runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-pointer-fail',
        assistantText: 'new answer',
        assistantMessageId: null,
        turnId: 'turn-1',
        regenerateAssistantMessageId: null,
        promptTokens: 2,
        completionTokens: 2,
        debugInfo: { requestId: 'req-pointer-fail' },
        bilingualEnabled: false,
        messageInsertDuration: null,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      }),
    ).rejects.toThrow('Failed to update active assistant variant for turn')

    expect(supabase.messages.find((row) => row.content === 'new answer')).toBeUndefined()
    expect((supabase.state.chatTurns as Array<Record<string, unknown>>)[0]).toMatchObject({
      active_assistant_message_id: 'assistant-old',
    })
  })

  it('reverts the turn pointer and deletes the inserted assistant when superseding fails', async () => {
    const supabase = withFromOverride(
      createChatJobRunnerSupabaseMock({
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
        ],
      }),
      (table, handler) => {
        if (table !== 'messages') {
          return null
        }

        return {
          ...handler,
          update: (payload: Record<string, unknown>) =>
            wrapMutationBuilder(
              (
                handler.update as (payload: Record<string, unknown>) => {
                  eq: (field: string, value: unknown) => unknown
                  then: (...args: unknown[]) => Promise<unknown>
                }
              )(payload),
              (filters) =>
                payload.message_status === 'superseded' &&
                matchesFilters(filters, [
                  { field: 'id', value: 'assistant-old' },
                  { field: 'chat_id', value: 'chat-1' },
                ]),
              { message: 'supersede failed', code: 'XX001' },
            ),
        }
      },
    )

    await expect(
      runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-supersede-fail',
        assistantText: 'new answer',
        assistantMessageId: null,
        turnId: 'turn-1',
        regenerateAssistantMessageId: null,
        promptTokens: 2,
        completionTokens: 2,
        debugInfo: { requestId: 'req-supersede-fail' },
        bilingualEnabled: false,
        messageInsertDuration: null,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      }),
    ).rejects.toThrow('Failed to supersede previous assistant variant')

    expect((supabase.state.chatTurns as Array<Record<string, unknown>>)[0]).toMatchObject({
      active_assistant_message_id: 'assistant-old',
    })
    expect(supabase.messages.find((row) => row.content === 'new answer')).toBeUndefined()
    expect(supabase.messages.find((row) => row.id === 'assistant-old')).toMatchObject({
      message_status: 'completed',
    })
  })

  it('throws when loading the latest assistant variant fails unexpectedly', async () => {
    const supabase = withFromOverride(
      createChatJobRunnerSupabaseMock({
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
        ],
      }),
      (table, handler) => {
        if (table !== 'messages') {
          return null
        }

        return {
          ...handler,
          select: (columns?: string) =>
            wrapQueryBuilder(
              (
                handler.select as (columns?: string) => {
                  eq: (field: string, value: unknown) => unknown
                  order: (field: string, options?: { ascending?: boolean }) => unknown
                  limit: (count: number) => unknown
                  maybeSingle: () => Promise<{
                    data: Record<string, unknown> | null
                    error: MockError | null
                  }>
                  single: () => Promise<{
                    data: Record<string, unknown> | null
                    error: MockError | null
                  }>
                }
              )(columns),
              (filters) =>
                matchesFilters(filters, [
                  { field: 'turn_id', value: 'turn-1' },
                  { field: 'role', value: 'assistant' },
                ]),
              { message: 'variant lookup failed', code: 'XX001' },
            ),
        }
      },
    )

    await expect(
      runPostGenerationPipeline({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        origin: 'https://internal.example.com',
        requestId: 'req-variant-load',
        assistantText: 'new answer',
        assistantMessageId: null,
        turnId: 'turn-1',
        regenerateAssistantMessageId: null,
        promptTokens: 2,
        completionTokens: 2,
        debugInfo: { requestId: 'req-variant-load' },
        bilingualEnabled: false,
        messageInsertDuration: null,
        usage: buildUsageMetrics(),
        usageCost: null,
        triggerMessageTranslationFn: vi.fn(),
        resolveSummaryModelPreferenceFn: vi.fn(async () => null),
        triggerSummaryGenerationFn: vi.fn(async () => ({ success: true, attempts: 1 })),
        now: () => 0,
      }),
    ).rejects.toThrow('Failed to load current assistant variants for turn')
  })
})
