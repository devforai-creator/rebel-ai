import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'

const claimPendingJobMock = vi.fn()
const parseChatJobPayloadMock = vi.fn()
const decryptSecretMock = vi.fn()
const buildContextMock = vi.fn()
const streamTextMock = vi.fn()
const triggerSummaryGenerationMock = vi.fn()
const resolveGoogleCacheDecisionMock = vi.fn()
const isGoogleExplicitCacheEnabledMock = vi.fn()
const createGoogleCacheMock = vi.fn()
const createAdminClientMock = vi.fn(() => createChatJobRunnerSupabaseMock())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/chat/job-queue', () => ({
  claimPendingJob: claimPendingJobMock,
}))

vi.mock('@/lib/chat/job-payload', () => ({
  parseChatJobPayload: (...args: unknown[]) => parseChatJobPayloadMock(...args),
}))

// Avoid executing the heavy job path in these tests
vi.mock('@/lib/chat/global-system-prompt', () => ({
  getGlobalSystemPrompt: vi.fn(() => 'GLOBAL'),
}))
vi.mock('@/lib/chat-summaries', () => ({
  buildContext: (...args: unknown[]) => buildContextMock(...args),
}))
buildContextMock.mockResolvedValue({
  systemPrompt: 'CTX',
  recentMessages: [{ role: 'user', content: 'Hello' }],
  ragInfo: null,
})
vi.mock('@/lib/chat/summary-trigger', () => ({
  triggerSummaryGeneration: (...args: unknown[]) => triggerSummaryGenerationMock(...args),
}))
triggerSummaryGenerationMock.mockResolvedValue({ success: true, attempts: 1 })
vi.mock('@/lib/chat/summary-model-preference', () => ({
  resolveSummaryModelPreference: vi.fn(async () => null),
}))
vi.mock('@/lib/internal-api-origin', () => ({
  resolveInternalApiOrigin: vi.fn(() => 'https://internal.example.com'),
}))
vi.mock('@/lib/llm/google-cache', () => ({
  createGoogleCache: (...args: unknown[]) => createGoogleCacheMock(...args),
  resolveGoogleCacheDecision: (...args: unknown[]) => resolveGoogleCacheDecisionMock(...args),
  isGoogleExplicitCacheEnabled: (...args: unknown[]) => isGoogleExplicitCacheEnabledMock(...args),
}))
vi.mock('@/lib/chat/bilingual-context', () => ({
  applyBilingualContext: vi.fn(async ({ messages }) => messages),
  isBilingualEnabled: vi.fn(async () => false),
}))
vi.mock('@/lib/chat/translation-trigger', () => ({
  triggerMessageTranslation: vi.fn(),
}))

vi.mock('@/lib/openai/service-tier', () => ({
  createOpenAIWithServiceTier: () => vi.fn(() => ({})),
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => vi.fn(() => ({})),
}))
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => vi.fn(() => ({})),
}))
vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: () => vi.fn(() => ({})),
}))

class MockAPICallError extends Error {
  responseBody?: string

  constructor(
    args:
      | string
      | {
          message: string
          responseBody?: string
        },
  ) {
    const message = typeof args === 'string' ? args : args.message
    super(message)
    this.name = 'APICallError'
    this.responseBody = typeof args === 'string' ? undefined : args.responseBody
  }

  static isInstance(error: unknown): error is MockAPICallError {
    return error instanceof MockAPICallError
  }
}

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  APICallError: MockAPICallError,
}))
streamTextMock.mockResolvedValue({
  textStream: [],
  finishReason: Promise.resolve('stop'),
  providerMetadata: Promise.resolve({}),
  usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
})

function buildValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    requestId: 'req-default',
    chatId: 'chat-1',
    userId: 'user-1',
    apiKeyId: 'key-1',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    sanitizedMessages: [{ role: 'user', content: 'Hello' }],
    isRegeneration: false,
    regenerateAssistantMessageId: null,
    ...overrides,
  }
}

async function flushSummaryBackgroundTask() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('processChatJobs', () => {
  beforeEach(() => {
    claimPendingJobMock.mockReset()
    parseChatJobPayloadMock.mockReset()
    decryptSecretMock.mockReset()
    buildContextMock.mockClear()
    triggerSummaryGenerationMock.mockClear()
    streamTextMock.mockClear()
    resolveGoogleCacheDecisionMock.mockReset()
    isGoogleExplicitCacheEnabledMock.mockReset()
    createGoogleCacheMock.mockReset()
    createAdminClientMock.mockReset()
    createAdminClientMock.mockImplementation(() =>
      createChatJobRunnerSupabaseMock({
        rpc: { get_decrypted_secret: () => decryptSecretMock() },
      }),
    )
    streamTextMock.mockResolvedValue({
      textStream: [],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    resolveGoogleCacheDecisionMock.mockReturnValue({ enabled: false, minTokens: null })
    isGoogleExplicitCacheEnabledMock.mockReturnValue(true)
    createGoogleCacheMock.mockResolvedValue({ success: false, error: 'cache disabled' })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns zero processed when no pending jobs exist', async () => {
    claimPendingJobMock.mockResolvedValue(null)
    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(2)

    expect(result.processedCount).toBe(0)
    expect(claimPendingJobMock).toHaveBeenCalled()
  })

  it('marks job as error when payload parsing fails', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-1',
      payload: { bad: 'data' },
    })
    parseChatJobPayloadMock.mockReturnValueOnce(null)
    // Stop after first job
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(1)

    expect(result.processedCount).toBe(1)
    expect(result.results[0]).toMatchObject({ jobId: 'job-1', status: 'error' })
    expect(supabase.updates).toContainEqual({
      status: 'error',
      error: 'Invalid job payload',
    })
  })

  it('marks job as error when API key is missing', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      apiKey: {
        id: 'key-1',
        user_id: 'other-user',
        is_active: true,
        provider: 'openai',
        model_preference: 'gpt-4o-mini',
        vault_secret_name: 'vault-key',
        service_tier: 'standard',
      },
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    parseChatJobPayloadMock.mockReturnValue(buildValidPayload())
    claimPendingJobMock.mockResolvedValueOnce({ id: 'job-api-key-missing', payload: { ok: true } })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-api-key-missing',
      status: 'error',
      error: 'API key not found or inactive',
    })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('marks job as error when chat ownership lookup fails', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      chat: {
        id: 'chat-1',
        user_id: 'other-user',
        character_id: 'char-1',
        persona_id: null,
        max_context_messages: 20,
        custom_system_prompt: null,
      },
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    parseChatJobPayloadMock.mockReturnValue(buildValidPayload())
    claimPendingJobMock.mockResolvedValueOnce({ id: 'job-chat-missing', payload: { ok: true } })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-chat-missing',
      status: 'error',
      error: 'Chat not found',
    })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('marks job as error when character lookup fails', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      chat: {
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'missing-character',
        persona_id: null,
        max_context_messages: 20,
        custom_system_prompt: null,
      },
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(buildValidPayload())
    claimPendingJobMock.mockResolvedValueOnce({ id: 'job-char-missing', payload: { ok: true } })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-char-missing',
      status: 'error',
      error: 'Character not found',
    })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('marks job as error when vault decryption RPC returns an error', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: {
        get_decrypted_secret: () => ({
          data: null,
          error: { message: 'vault down', code: 'XX001' },
        }),
      },
    })
    createAdminClientMock.mockReturnValue(supabase)

    parseChatJobPayloadMock.mockReturnValue(buildValidPayload({ requestId: 'req-vault-error' }))
    claimPendingJobMock.mockResolvedValueOnce({ id: 'job-vault-error', payload: { ok: true } })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-vault-error',
      status: 'error',
    })
    expect(result.results[0].error).toContain('Failed to decrypt API key: vault down')
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('marks job as error when vault decryption RPC returns empty data', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: {
        get_decrypted_secret: () => ({
          data: null,
          error: null,
        }),
      },
    })
    createAdminClientMock.mockReturnValue(supabase)

    parseChatJobPayloadMock.mockReturnValue(buildValidPayload({ requestId: 'req-vault-empty' }))
    claimPendingJobMock.mockResolvedValueOnce({ id: 'job-vault-empty', payload: { ok: true } })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-vault-empty',
      status: 'error',
    })
    expect(result.results[0].error).toContain('API key decryption returned empty result')
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('marks job as error for unsupported provider payloads', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(buildValidPayload({ provider: 'unknown-provider' }))
    claimPendingJobMock.mockResolvedValueOnce({ id: 'job-bad-provider', payload: { ok: true } })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-bad-provider',
      status: 'error',
      error: 'Unsupported provider: unknown-provider',
    })
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('processes a valid job and records usage and summary trigger', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue({
      version: 1,
      requestId: 'req-1',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      sanitizedMessages: [{ role: 'user', content: 'Hello' }],
      isRegeneration: false,
      regenerateAssistantMessageId: null,
    })
    // Return a single empty chunk then end
    streamTextMock.mockResolvedValue({
      textStream: ['hello world'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-1',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({ status: 'success', jobId: 'job-1' })
    expect(decryptSecretMock).toHaveBeenCalled()
    expect(supabase.messages.length).toBeGreaterThan(0)
    expect(supabase.usageEvents).toHaveLength(1)
    await flushSummaryBackgroundTask()
    expect(triggerSummaryGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        userId: 'user-1',
      }),
    )
  })

  it('uses google explicit cache strategy when cache creation succeeds', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-google-explicit-cache',
        provider: 'google',
        modelName: 'gemini-1.5-flash',
      }),
    )
    buildContextMock.mockResolvedValueOnce({
      systemPrompt: 'CTX',
      recentMessages: [
        { role: 'assistant', content: 'previous turn' },
        { role: 'user', content: 'latest user message' },
      ],
      ragInfo: null,
    })
    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    createGoogleCacheMock.mockResolvedValueOnce({
      success: true,
      cacheName: 'cache-1',
      cachedTokenCount: 777,
    })
    streamTextMock.mockResolvedValue({
      textStream: ['cached answer'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-google-explicit-cache',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-google-explicit-cache',
      status: 'success',
    })
    expect(createGoogleCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'gemini-1.5-flash',
        systemPrompt: expect.any(String),
      }),
    )
    const call = streamTextMock.mock.calls[0]?.[0] as {
      messages?: Array<{ role: string; content: string }>
      providerOptions?: Record<string, unknown>
    }
    expect(call.messages).toEqual([{ role: 'user', content: 'latest user message' }])
    expect((call.providerOptions?.google as { cachedContent?: string })?.cachedContent).toBe(
      'cache-1',
    )
  })

  it('marks job as error when model returns empty text without content filter', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(buildValidPayload({ requestId: 'req-empty-response' }))
    streamTextMock.mockResolvedValue({
      textStream: [],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 0, totalTokens: 10 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-empty-response',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-empty-response',
      status: 'error',
    })
    expect(result.results[0].error).toContain('The assistant returned an empty response')
    expect(supabase.messages).toHaveLength(0)
  })

  it('marks job as error when assistant message insert fails', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    const baseFrom = supabase.from.bind(supabase)
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table !== 'messages') {
        return baseFrom(table as never)
      }

      const baseMessages = baseFrom('messages' as never) as Record<string, unknown>
      return {
        ...baseMessages,
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { message: 'insert failed', code: '23505' },
            }),
          }),
        }),
      } as never
    }) as never)
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(buildValidPayload({ requestId: 'req-insert-failure' }))
    streamTextMock.mockResolvedValue({
      textStream: ['first chunk'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-insert-failure',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-insert-failure',
      status: 'error',
    })
    expect(result.results[0].error).toContain('Failed to insert assistant message')
    expect(supabase.messages).toHaveLength(0)
  })

  it('maps Gemini PROHIBITED_CONTENT API errors to a provider guidance message', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-gemini-prohibited',
        provider: 'google',
        modelName: 'gemini-1.5',
      }),
    )

    const { APICallError } = await import('ai')
    const prohibitedError = new APICallError({
      message: 'blocked',
      url: 'https://api.example.com',
      requestBodyValues: {},
      responseBody: JSON.stringify({
        promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
      }),
    }) as Error & { responseBody?: string }
    streamTextMock.mockRejectedValue(prohibitedError)

    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-gemini-prohibited',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-gemini-prohibited',
      status: 'error',
    })
    expect(result.results[0].error).toContain('Google Gemini blocked the prompt as prohibited')
    expect(supabase.messages).toHaveLength(0)
  })

  it('rethrows original API error when Gemini response body is not parseable JSON', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-gemini-bad-json',
        provider: 'google',
        modelName: 'gemini-1.5',
      }),
    )

    const { APICallError } = await import('ai')
    const malformedJsonError = new APICallError({
      message: 'upstream api failure',
      url: 'https://api.example.com',
      requestBodyValues: {},
      responseBody: '{not-json',
    }) as Error & {
      responseBody?: string
    }
    streamTextMock.mockRejectedValue(malformedJsonError)

    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-gemini-bad-json',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-gemini-bad-json',
      status: 'error',
    })
    expect(result.results[0].error).toContain('upstream api failure')
    expect(supabase.messages).toHaveLength(0)
  })

  it('rolls back inserted assistant message when stream update fails', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    const baseFrom = supabase.from.bind(supabase)
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table !== 'messages') {
        return baseFrom(table as never)
      }

      const baseMessages = baseFrom('messages' as never) as Record<string, unknown>
      return {
        ...baseMessages,
        update: () => ({
          eq: () => ({
            eq: async () => ({
              error: { message: 'update failed', code: '40001' },
            }),
          }),
        }),
      } as never
    }) as never)
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(buildValidPayload({ requestId: 'req-update-failure' }))
    streamTextMock.mockResolvedValue({
      textStream: ['partial answer'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-update-failure',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-update-failure',
      status: 'error',
    })
    expect(result.results[0].error).toContain(
      'Failed to update assistant message content: update failed',
    )
    expect(supabase.messages).toHaveLength(0)
  })

  it('rolls back inserted assistant message when stream fails mid-generation', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(buildValidPayload({ requestId: 'req-stream-failure' }))
    streamTextMock.mockResolvedValue({
      textStream: (async function* () {
        yield 'partial answer'
        throw new Error('stream exploded')
      })(),
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 10, totalTokens: 20 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-stream-failure',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-stream-failure',
      status: 'error',
    })
    expect(result.results[0].error).toContain('stream exploded')
    expect(supabase.messages).toHaveLength(0)
  })

  it('deletes whitespace-only assistant message before returning empty-response error', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({ requestId: 'req-whitespace-response' }),
    )
    streamTextMock.mockResolvedValue({
      textStream: ['   '],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 1, totalTokens: 11 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-whitespace-response',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-whitespace-response',
      status: 'error',
    })
    expect(result.results[0].error).toContain('The assistant returned an empty response')
    expect(supabase.messages).toHaveLength(0)
  })

  it('passes persona name into template context and user info', async () => {
    const moduleData: unknown = {
      id: 'module-1',
      user_id: 'user-1',
      name: 'Module',
      description: null,
      toggle_definitions: {},
      lorebook: [],
      regex: [],
      triggers: [],
      assets: [],
      hide_icon: false,
      source_file: null,
      created_at: '',
      updated_at: '',
    }
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
      modules: [{ modules: moduleData }],
      chat: {
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'char-1',
        persona_id: 'persona-1',
        max_context_messages: 20,
        custom_system_prompt: null,
      },
      personas: [
        {
          id: 'persona-1',
          user_id: 'user-1',
          name: 'Bob',
          description: 'I like coffee.',
        },
      ],
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue({
      version: 1,
      requestId: 'req-3',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      sanitizedMessages: [{ role: 'user', content: 'Hello' }],
      isRegeneration: false,
      regenerateAssistantMessageId: null,
    })
    streamTextMock.mockResolvedValue({
      textStream: ['hello world'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-1',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')

    await processChatJobs(1)

    expect(buildContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSystemPrompt: expect.stringContaining('Your name is: Bob'),
      }),
    )
    expect(buildContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSystemPrompt: expect.stringContaining('I like coffee.'),
      }),
    )
  })

  it('handles Gemini content filter by returning error status without storing system message', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue({
      version: 1,
      requestId: 'req-2',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'google',
      modelName: 'gemini-1.5',
      sanitizedMessages: [{ role: 'user', content: 'Hello' }],
      isRegeneration: false,
      regenerateAssistantMessageId: null,
    })
    streamTextMock.mockResolvedValue({
      textStream: [], // no chunks returned
      finishReason: Promise.resolve('content-filter'),
      providerMetadata: Promise.resolve({ google: { finishReason: 'SAFETY' } }),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-2',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(1)

    // Error is returned in job status, not stored as system message
    expect(result.results[0]).toMatchObject({ status: 'error', jobId: 'job-2' })
    expect(result.results[0].error).toContain('Blocked by Google Gemini content filter')
    // No system message should be stored - error is shown via toast popup
    const systemMessage = supabase.messages.find((msg) => msg.role === 'system')
    expect(systemMessage).toBeUndefined()
  })

  it('supports regeneration by removing old assistant message and updating debug_info on summary failure', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      initialMessages: [
        {
          id: 'assistant-1',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'old reply',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: null,
          user_id: 'user-1',
        },
      ],
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    triggerSummaryGenerationMock.mockResolvedValueOnce({
      success: false,
      error: 'summary failed',
      attempts: 2,
    })
    parseChatJobPayloadMock.mockReturnValue({
      version: 1,
      requestId: 'req-3',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      sanitizedMessages: [{ role: 'user', content: 'new question' }],
      isRegeneration: true,
      regenerateAssistantMessageId: 'assistant-1',
    })
    streamTextMock.mockResolvedValue({
      textStream: ['new answer'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 5, outputTokens: 10, totalTokens: 15 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-3',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({ status: 'success', jobId: 'job-3' })
    expect(supabase.messages.find((msg) => msg.id === 'assistant-1')).toBeUndefined()
    await vi.waitFor(() => {
      const latest = supabase.messages[supabase.messages.length - 1]
      expect(latest.debug_info).toMatchObject({
        summaryWarning: expect.objectContaining({
          error: 'summary failed',
          attempts: 2,
        }),
      })
    })
  })

  it('uses split-system strategy for Anthropic prompt caching', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue({
      version: 1,
      requestId: 'req-4',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
      sanitizedMessages: [{ role: 'user', content: 'Hello' }],
      isRegeneration: false,
      regenerateAssistantMessageId: null,
    })
    streamTextMock.mockResolvedValue({
      textStream: ['response'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({
        anthropic: {
          usage: {
            cache_read_input_tokens: 12,
            cache_creation_input_tokens: 7,
            input_tokens: 33,
          },
        },
      }),
      usage: Promise.resolve({
        inputTokens: 5,
        outputTokens: 10,
        totalTokens: 15,
        cachedInputTokens: 3,
      }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-4',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    await processChatJobs(1)

    const call = streamTextMock.mock.calls[0]?.[0] as {
      messages?: Array<{ content: string; role: string }>
    }
    // First message should be system (static prompt)
    expect(call.messages?.[0]).toMatchObject({ role: 'system' })
    // Last message should be the user message from sanitizedMessages
    expect(call.messages?.[call.messages.length - 1]).toMatchObject({
      role: 'user',
      content: 'Hello',
    })
  })

  it('ignores preset/module runtime data during chat generation', async () => {
    const presetData: unknown = {
      id: 'preset-1',
      user_id: 'user-1',
      name: 'Preset',
      prompt_template: [],
      promptTemplate: [{ type: 'plain', text: 'viaPromptTemplate' }],
      config: { temperature: 111 },
      toggle_definitions: [
        ['preset_toggle', { type: 'toggle', value: true }],
        ['preset_text', { type: 'text', value: 'from-preset' }],
        ['group', { type: 'group', value: true }],
      ],
      source_file: null,
      risup_version: 1,
      created_at: '',
      updated_at: '',
    }
    const moduleData: unknown = {
      id: 'module-1',
      user_id: 'user-1',
      name: 'Module',
      description: null,
      toggle_definitions: {
        module_flag: { type: 'toggle', value: false },
        module_divider: { type: 'divider', value: true },
        bool_inline: true,
      },
      lorebook: [],
      regex: [],
      triggers: [],
      assets: [],
      hide_icon: false,
      source_file: null,
      created_at: '',
      updated_at: '',
    }
    const supabase = createChatJobRunnerSupabaseMock({
      presetLink: { preset_id: 'preset-1', presets: presetData },
      modules: [{ modules: moduleData }],
      globalVariables: [
        { user_id: 'user-1', chat_id: 'chat-1', key: 'preset_text', value: 'keep-existing' },
      ],
      metadata: {
        default_variables: {
          metadata_var: 42,
          preset_toggle: 'meta-should-not-override',
        },
      },
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue({
      version: 1,
      requestId: 'req-preset',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      sanitizedMessages: [{ role: 'user', content: 'Hello' }],
      isRegeneration: false,
      regenerateAssistantMessageId: null,
    })
    streamTextMock.mockResolvedValue({
      textStream: ['preset-path'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 5, outputTokens: 10, totalTokens: 15 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-5',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    await processChatJobs(1)

    expect(buildContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSystemPrompt: 'GLOBAL\n\n---\n\nCHAR PROMPT',
      }),
    )
    expect(supabase.globalVariables).toEqual([
      {
        user_id: 'user-1',
        chat_id: 'chat-1',
        key: 'preset_text',
        value: 'keep-existing',
      },
    ])
  })
})
