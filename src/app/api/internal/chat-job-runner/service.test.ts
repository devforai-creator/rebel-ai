import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'
import { DEFAULT_OPENAI_TEXT_VERBOSITY } from '@/lib/llm/provider-options'

const claimPendingJobMock = vi.fn()
const parseChatJobPayloadMock = vi.fn()
const decryptSecretMock = vi.fn()
const buildMemoryPlanMock = vi.fn()
const countProjectedConversationMessagesMock = vi.fn()
const loadGenerationTranscriptMock = vi.fn()
const loadProjectedConversationTailMock = vi.fn()
const streamTextMock = vi.fn()
const triggerSummaryGenerationMock = vi.fn()
const resolveGoogleCacheDecisionMock = vi.fn()
const isGoogleExplicitCacheEnabledMock = vi.fn()
const createGoogleCacheMock = vi.fn()
const createAnthropicMessageBatchMock = vi.fn()
const retrieveAnthropicMessageBatchMock = vi.fn()
const retrieveAnthropicBatchResultMock = vi.fn()
const resolveAgenticTranscriptRecallRuntimeConfigMock = vi.fn()
const deriveAgenticTranscriptRecallSourceHintsMock = vi.fn()
const loadAgenticTranscriptRecallSourceMapMock = vi.fn()
const extractTextFromAnthropicBatchMessageMock = vi.fn((message: { content?: unknown[] }) =>
  (message.content ?? [])
    .map((part) =>
      part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
        ? part.text
        : '',
    )
    .join(''),
)
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
vi.mock('@/lib/chat-memory', () => ({
  buildMemoryPlan: (...args: unknown[]) => buildMemoryPlanMock(...args),
}))
vi.mock('@/lib/chat/turns', () => ({
  countProjectedConversationMessages: (...args: unknown[]) =>
    countProjectedConversationMessagesMock(...args),
  loadGenerationTranscript: (...args: unknown[]) => loadGenerationTranscriptMock(...args),
  loadProjectedConversationTail: (...args: unknown[]) => loadProjectedConversationTailMock(...args),
}))
buildMemoryPlanMock.mockResolvedValue({
  mode: 'summary_window',
  promptBlocks: [
    {
      role: 'system',
      content: 'CTX',
      cachePreference: 'prefer-cache',
      stability: 'static',
    },
    {
      role: 'user',
      content: 'Hello',
      cachePreference: 'avoid-cache',
      stability: 'live',
    },
  ],
  fallbackSystemPrompt: 'CTX',
  fallbackMessages: [{ role: 'user', content: 'Hello' }],
  staticSystemPrompt: 'CTX',
  dynamicContext: null,
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
vi.mock('@/lib/llm/google-cache', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/llm/google-cache')>('@/lib/llm/google-cache')

  return {
    ...actual,
    createGoogleCache: (...args: unknown[]) => createGoogleCacheMock(...args),
    resolveGoogleCacheDecision: (...args: unknown[]) => resolveGoogleCacheDecisionMock(...args),
    isGoogleExplicitCacheEnabled: (...args: unknown[]) => isGoogleExplicitCacheEnabledMock(...args),
  }
})
vi.mock('@/lib/llm/anthropic-batch', () => ({
  createAnthropicMessageBatch: (...args: unknown[]) => createAnthropicMessageBatchMock(...args),
  retrieveAnthropicMessageBatch: (...args: unknown[]) => retrieveAnthropicMessageBatchMock(...args),
  retrieveAnthropicBatchResult: (...args: unknown[]) => retrieveAnthropicBatchResultMock(...args),
  extractTextFromAnthropicBatchMessage: (message: { content?: unknown[] }) =>
    extractTextFromAnthropicBatchMessageMock(message),
}))
vi.mock('@/lib/chat/bilingual-context', () => ({
  applyBilingualContext: vi.fn(async ({ messages }) => messages),
  isBilingualEnabled: vi.fn(async () => false),
}))
vi.mock('@/lib/experimental/agentic-transcript-recall/config', () => ({
  resolveAgenticTranscriptRecallRuntimeConfig: (...args: unknown[]) =>
    resolveAgenticTranscriptRecallRuntimeConfigMock(...args),
}))
vi.mock('@/lib/experimental/agentic-transcript-recall/source-hints', () => ({
  deriveAgenticTranscriptRecallSourceHints: (...args: unknown[]) =>
    deriveAgenticTranscriptRecallSourceHintsMock(...args),
}))
vi.mock('@/lib/experimental/agentic-transcript-recall/source-map', () => ({
  loadAgenticTranscriptRecallSourceMap: (...args: unknown[]) =>
    loadAgenticTranscriptRecallSourceMapMock(...args),
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

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')

  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    APICallError: MockAPICallError,
  }
})
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
    turnId: null,
    isRegeneration: false,
    regenerateAssistantMessageId: null,
    ...overrides,
  }
}

function buildAgenticTranscriptRecallRuntimeConfig(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    accountDefaultEnabled: false,
    preferenceSource: 'chat_override',
    globallyEnabled: true,
    providerSupported: true,
    providerAllowed: true,
    enabled: true,
    skipReason: null,
    maxToolCalls: 2,
    maxMessagesPerCall: 12,
    maxTotalMessages: 12,
    providerAllowlist: ['google'],
    ...overrides,
  }
}

function buildAgenticTranscriptRecallSourceHints(overrides: Record<string, unknown> = {}) {
  return {
    rawContextStartOrdinal: 21,
    cutoffOrdinal: 20,
    hints: [
      {
        kind: 'summary',
        label: 'summary',
        startSeq: 1,
        endSeq: 10,
        preview: 'Older promise context',
      },
    ],
    ...overrides,
  }
}

function buildAgenticTranscriptRecallSourceMap(overrides: Record<string, unknown> = {}) {
  return {
    rawContextStartOrdinal: 21,
    cutoffOrdinal: 20,
    directFetchRanges: [
      {
        kind: 'summary',
        label: 'summary',
        startSeq: 1,
        endSeq: 10,
        preview: 'Older promise context',
      },
    ],
    navigationParents: [],
    ...overrides,
  }
}

async function flushSummaryBackgroundTask() {
  await Promise.resolve()
  await Promise.resolve()
}

type RecordedFilter = {
  field: string
  value: unknown
}

type MockError = {
  message: string
  code?: string | null
}

function matchesFilters(filters: RecordedFilter[], expected: RecordedFilter[]) {
  return expected.every(({ field, value }) =>
    filters.some((filter) => filter.field === field && filter.value === value),
  )
}

function wrapMutationBuilder(
  builder: {
    eq: (field: string, value: unknown) => unknown
    then: (...args: unknown[]) => Promise<unknown>
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

describe('processChatJobs', () => {
  beforeEach(() => {
    claimPendingJobMock.mockReset()
    parseChatJobPayloadMock.mockReset()
    decryptSecretMock.mockReset()
    buildMemoryPlanMock.mockReset()
    countProjectedConversationMessagesMock.mockReset()
    loadGenerationTranscriptMock.mockReset()
    loadProjectedConversationTailMock.mockReset()
    triggerSummaryGenerationMock.mockClear()
    streamTextMock.mockClear()
    resolveGoogleCacheDecisionMock.mockReset()
    isGoogleExplicitCacheEnabledMock.mockReset()
    createGoogleCacheMock.mockReset()
    createAnthropicMessageBatchMock.mockReset()
    retrieveAnthropicMessageBatchMock.mockReset()
    retrieveAnthropicBatchResultMock.mockReset()
    resolveAgenticTranscriptRecallRuntimeConfigMock.mockReset()
    deriveAgenticTranscriptRecallSourceHintsMock.mockReset()
    loadAgenticTranscriptRecallSourceMapMock.mockReset()
    extractTextFromAnthropicBatchMessageMock.mockClear()
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
    countProjectedConversationMessagesMock.mockResolvedValue(0)
    loadProjectedConversationTailMock.mockResolvedValue([])
    buildMemoryPlanMock.mockResolvedValue({
      mode: 'summary_window',
      promptBlocks: [
        {
          role: 'system',
          content: 'CTX',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'user',
          content: 'Hello',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
      ],
      fallbackSystemPrompt: 'CTX',
      fallbackMessages: [{ role: 'user', content: 'Hello' }],
      staticSystemPrompt: 'CTX',
      dynamicContext: null,
      ragInfo: null,
    })
    resolveGoogleCacheDecisionMock.mockReturnValue({ enabled: false, minTokens: null })
    isGoogleExplicitCacheEnabledMock.mockReturnValue(true)
    createGoogleCacheMock.mockResolvedValue({ success: false, error: 'cache disabled' })
    createAnthropicMessageBatchMock.mockResolvedValue({
      id: 'batch-1',
      type: 'message_batch',
      processing_status: 'in_progress',
      created_at: '2026-04-10T00:00:00Z',
      ended_at: null,
      expires_at: '2026-04-11T00:00:00Z',
      cancel_initiated_at: null,
      results_url: null,
    })
    retrieveAnthropicMessageBatchMock.mockResolvedValue({
      id: 'batch-1',
      type: 'message_batch',
      processing_status: 'in_progress',
      created_at: '2026-04-10T00:00:00Z',
      ended_at: null,
      expires_at: '2026-04-11T00:00:00Z',
      cancel_initiated_at: null,
      results_url: null,
    })
    retrieveAnthropicBatchResultMock.mockResolvedValue(null)
    loadGenerationTranscriptMock.mockResolvedValue([{ role: 'user', content: 'Hello' }])
    resolveAgenticTranscriptRecallRuntimeConfigMock.mockReturnValue(
      buildAgenticTranscriptRecallRuntimeConfig({
        configured: false,
        preferenceSource: 'account_default',
        globallyEnabled: false,
        enabled: false,
        skipReason: 'disabled_by_global_flag',
      }),
    )
    deriveAgenticTranscriptRecallSourceHintsMock.mockReturnValue(
      buildAgenticTranscriptRecallSourceHints({ hints: [] }),
    )
    loadAgenticTranscriptRecallSourceMapMock.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('returns zero processed when no pending jobs exist', async () => {
    claimPendingJobMock.mockResolvedValue(null)
    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(2)

    expect(result.processedCount).toBe(0)
    expect(claimPendingJobMock).toHaveBeenCalled()
  }, 10_000)

  it('defaults to processing a single job when the requested limit is invalid', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    claimPendingJobMock.mockResolvedValue({ id: 'job-1', payload: { bad: 'data' } })
    parseChatJobPayloadMock.mockReturnValue(null)

    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(0)

    expect(result.processedCount).toBe(1)
    expect(claimPendingJobMock).toHaveBeenCalledTimes(1)
  })

  it('caps batch processing to five jobs even when a larger limit is requested', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    claimPendingJobMock
      .mockResolvedValueOnce({ id: 'job-1', payload: { bad: 'data' } })
      .mockResolvedValueOnce({ id: 'job-2', payload: { bad: 'data' } })
      .mockResolvedValueOnce({ id: 'job-3', payload: { bad: 'data' } })
      .mockResolvedValueOnce({ id: 'job-4', payload: { bad: 'data' } })
      .mockResolvedValueOnce({ id: 'job-5', payload: { bad: 'data' } })
      .mockResolvedValueOnce({ id: 'job-6', payload: { bad: 'data' } })
    parseChatJobPayloadMock.mockReturnValue(null)

    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(99)

    expect(result.processedCount).toBe(5)
    expect(claimPendingJobMock).toHaveBeenCalledTimes(5)
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
      lifecycle_stage: 'invalid_payload',
      failure_stage: 'invalid_payload',
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

  it('surfaces job error status persistence failures instead of swallowing them', async () => {
    let attempts = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const supabase = withFromOverride(
        createChatJobRunnerSupabaseMock({
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
        }),
        (table, handler) => {
          if (table !== 'chat_generation_jobs') {
            return null
          }

          return {
            ...handler,
            update: (payload: Record<string, unknown>) => {
              const baseBuilder = (
                handler.update as (payload: Record<string, unknown>) => {
                  eq: (field: string, value: unknown) => unknown
                  then: (...args: unknown[]) => Promise<unknown>
                }
              )(payload)

              if (payload.status !== 'error') {
                return baseBuilder
              }

              return wrapMutationBuilder(
                baseBuilder,
                (filters) => {
                  if (matchesFilters(filters, [{ field: 'id', value: 'job-api-key-missing' }])) {
                    attempts += 1
                    return true
                  }

                  return false
                },
                { message: 'job update failed', code: 'XX001' },
              )
            },
          }
        },
      )
      createAdminClientMock.mockReturnValue(supabase)

      parseChatJobPayloadMock.mockReturnValue(buildValidPayload())
      claimPendingJobMock.mockResolvedValueOnce({
        id: 'job-api-key-missing',
        payload: { ok: true },
      })
      claimPendingJobMock.mockResolvedValueOnce(null)

      const { processChatJobs } = await import('./service')
      const result = await processChatJobs(1)

      expect(result.results[0]).toMatchObject({
        jobId: 'job-api-key-missing',
        status: 'error',
      })
      expect(result.results[0].error).toContain('Failed to persist chat job error status')
      expect(result.results[0].error).toContain('Original job error: API key not found or inactive')
      expect(attempts).toBe(3)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
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

  it('surfaces success status persistence failures after generating a response', async () => {
    let attempts = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const supabase = withFromOverride(
        createChatJobRunnerSupabaseMock({
          rpc: { get_decrypted_secret: () => decryptSecretMock() },
        }),
        (table, handler) => {
          if (table !== 'chat_generation_jobs') {
            return null
          }

          return {
            ...handler,
            update: (payload: Record<string, unknown>) => {
              const baseBuilder = (
                handler.update as (payload: Record<string, unknown>) => {
                  eq: (field: string, value: unknown) => unknown
                  then: (...args: unknown[]) => Promise<unknown>
                }
              )(payload)

              if (payload.status !== 'success') {
                return baseBuilder
              }

              return wrapMutationBuilder(
                baseBuilder,
                (filters) => {
                  if (matchesFilters(filters, [{ field: 'id', value: 'job-1' }])) {
                    attempts += 1
                    return true
                  }

                  return false
                },
                { message: 'job update failed', code: '40001' },
              )
            },
          }
        },
      )
      createAdminClientMock.mockReturnValue(supabase)

      decryptSecretMock.mockResolvedValue('sk-test')
      parseChatJobPayloadMock.mockReturnValue(buildValidPayload())
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

      expect(result.results[0]).toMatchObject({ jobId: 'job-1', status: 'error' })
      expect(result.results[0].error).toContain('Failed to persist chat job success status')
      expect(attempts).toBe(3)
      expect(supabase.messages.length).toBeGreaterThan(0)
      expect(supabase.usageEvents).toHaveLength(1)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it('submits Anthropic Batch jobs without calling the streaming API', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      apiKey: {
        id: 'key-1',
        user_id: 'user-1',
        is_active: true,
        provider: 'anthropic',
        model_preference: 'claude-opus-4-5',
        vault_secret_name: 'vault-key',
        service_tier: 'standard',
      },
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-ant-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-anthropic-batch',
        provider: 'anthropic',
        modelName: 'claude-opus-4-5',
        deliveryMode: 'anthropic_batch',
      }),
    )
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-anthropic-batch',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-anthropic-batch',
      status: 'processing',
    })
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(createAnthropicMessageBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-ant-test',
        customId: 'job-job-anthropic-batch',
        params: expect.objectContaining({
          model: 'claude-opus-4-5',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    )
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        lifecycle_stage: 'waiting_provider_batch',
        failure_stage: null,
        external_provider_job_id: 'batch-1',
        external_provider_status: 'in_progress',
        external_provider_submitted_at: '2026-04-10T00:00:00Z',
      }),
    )
  })

  it('uses the configured Anthropic cache TTL for batch explicit cache blocks', async () => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHE_MODE', 'auto')
    vi.stubEnv('ANTHROPIC_PROMPT_CACHE_TTL', '1h')

    const supabase = createChatJobRunnerSupabaseMock({
      apiKey: {
        id: 'key-1',
        user_id: 'user-1',
        is_active: true,
        provider: 'anthropic',
        model_preference: 'claude-opus-4-5',
        vault_secret_name: 'vault-key',
        service_tier: 'standard',
      },
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-ant-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-anthropic-batch-cache-ttl',
        provider: 'anthropic',
        modelName: 'claude-opus-4-5',
        deliveryMode: 'anthropic_batch',
      }),
    )
    buildMemoryPlanMock.mockResolvedValueOnce({
      mode: 'summary_window',
      promptBlocks: [
        {
          role: 'system',
          content: 'STATIC',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'system',
          content: 'DYNAMIC',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
        {
          role: 'user',
          content: 'Hello',
          cachePreference: 'prefer-cache',
          stability: 'live',
        },
      ],
      fallbackSystemPrompt: 'STATIC\nDYNAMIC',
      fallbackMessages: [{ role: 'user', content: 'Hello' }],
      staticSystemPrompt: 'STATIC',
      dynamicContext: 'DYNAMIC',
      ragInfo: null,
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-anthropic-batch-cache-ttl',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')

    const result = await processChatJobs(1)

    const call = createAnthropicMessageBatchMock.mock.calls[0]?.[0] as
      | {
          params?: {
            cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' }
            system?: Array<{ cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' } }>
          }
        }
      | undefined

    expect(result.results[0]).toMatchObject({
      jobId: 'job-anthropic-batch-cache-ttl',
      status: 'processing',
    })
    expect(call?.params?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(call?.params?.system?.[0]?.cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    })
  })

  it('polls completed Anthropic Batch jobs and records batch-priced usage', async () => {
    const batchPayload = buildValidPayload({
      requestId: 'req-batch-complete',
      provider: 'anthropic',
      modelName: 'claude-opus-4-5',
      deliveryMode: 'anthropic_batch',
    })
    const batchMetadata = {
      customId: 'job-complete-batch',
      submittedRequest: {
        model: 'claude-opus-4-5',
        max_tokens: 8192,
        messages: [{ role: 'user', content: 'Hello' }],
      },
      debug: {
        requestId: 'req-batch-complete',
        finalSystemPrompt: 'system prompt',
        recentMessages: [{ role: 'user', content: 'Hello' }],
        anthropicConversationMessages: null,
        anthropicPlaceholderAdded: false,
        promptCache: null,
        totalInputTokens: 10,
        anthropicCache: null,
        staticPromptTokens: 10,
        dynamicContext: null,
        dynamicContextTokens: 0,
        ragInfo: null,
        actualPayload: null,
        sanitizedMessageCount: 1,
        bilingualEnabled: false,
      },
    }
    const supabase = createChatJobRunnerSupabaseMock({
      apiKey: {
        id: 'key-1',
        user_id: 'user-1',
        is_active: true,
        provider: 'anthropic',
        model_preference: 'claude-opus-4-5',
        vault_secret_name: 'vault-key',
        service_tier: 'standard',
      },
      initialJobs: [
        {
          id: 'job-complete-batch',
          chat_id: 'chat-1',
          user_id: 'user-1',
          status: 'processing',
          payload: batchPayload,
          delivery_mode: 'anthropic_batch',
          external_provider_job_id: 'batch-1',
          external_provider_status: 'in_progress',
          external_provider_last_checked_at: '2026-04-10T00:00:00Z',
          external_provider_result_url: null,
          external_provider_metadata: batchMetadata,
        },
      ],
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)
    decryptSecretMock.mockResolvedValue('sk-ant-test')
    parseChatJobPayloadMock.mockReturnValue(batchPayload)
    retrieveAnthropicMessageBatchMock.mockResolvedValueOnce({
      id: 'batch-1',
      type: 'message_batch',
      processing_status: 'ended',
      created_at: '2026-04-10T00:00:00Z',
      ended_at: '2026-04-10T00:01:00Z',
      expires_at: '2026-04-11T00:00:00Z',
      cancel_initiated_at: null,
      results_url: 'https://api.anthropic.com/v1/messages/batches/batch-1/results',
    })
    retrieveAnthropicBatchResultMock.mockResolvedValueOnce({
      custom_id: 'job-complete-batch',
      result: {
        type: 'succeeded',
        message: {
          id: 'msg-batch',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-5',
          content: [{ type: 'text', text: 'batch answer' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 10,
          },
        },
      },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-complete-batch',
      status: 'success',
    })
    expect(retrieveAnthropicMessageBatchMock).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      batchId: 'batch-1',
    })
    expect(retrieveAnthropicBatchResultMock).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      resultsUrl: 'https://api.anthropic.com/v1/messages/batches/batch-1/results',
      customId: 'job-complete-batch',
    })
    expect(supabase.messages).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'batch answer',
        prompt_tokens: 100,
        completion_tokens: 20,
      }),
    )
    expect(supabase.usageEvents[0]).toMatchObject({
      request_id: 'req-batch-complete',
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
    })
    expect(Number(supabase.usageEvents[0].total_cost_usd)).toBeGreaterThan(0)
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
    buildMemoryPlanMock.mockResolvedValueOnce({
      mode: 'summary_window',
      promptBlocks: [
        {
          role: 'system',
          content: 'CTX',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'assistant',
          content: 'previous turn',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
        {
          role: 'user',
          content: 'latest user message',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
      ],
      fallbackSystemPrompt: 'CTX',
      fallbackMessages: [
        { role: 'assistant', content: 'previous turn' },
        { role: 'user', content: 'latest user message' },
      ],
      staticSystemPrompt: 'CTX',
      dynamicContext: null,
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

  it('uses google explicit cache for ATR tool-capable turns without compatibility retry', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-google-explicit-cache-tools',
        provider: 'google',
        modelName: 'gemini-2.5-flash',
      }),
    )
    resolveAgenticTranscriptRecallRuntimeConfigMock.mockReturnValue(
      buildAgenticTranscriptRecallRuntimeConfig(),
    )
    deriveAgenticTranscriptRecallSourceHintsMock.mockReturnValue(
      buildAgenticTranscriptRecallSourceHints(),
    )
    loadAgenticTranscriptRecallSourceMapMock.mockResolvedValue(
      buildAgenticTranscriptRecallSourceMap(),
    )
    buildMemoryPlanMock.mockResolvedValueOnce({
      mode: 'summary_window',
      promptBlocks: [
        {
          role: 'system',
          content: 'CTX',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
      ],
      fallbackSystemPrompt: 'CTX',
      fallbackMessages: [
        { role: 'assistant', content: '좋아. 내가 지킬게.' },
        { role: 'user', content: '지난번에 한 약속 정확히 다시 말해줘.' },
      ],
      staticSystemPrompt: 'CTX',
      dynamicContext: null,
      ragInfo: null,
    })
    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    createGoogleCacheMock.mockResolvedValueOnce({
      success: true,
      cacheName: 'cache-tools-1',
      cachedTokenCount: 2048,
    })
    streamTextMock.mockResolvedValue({
      textStream: ['cached tool answer'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-google-explicit-cache-tools',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-google-explicit-cache-tools',
      status: 'success',
    })
    const call = streamTextMock.mock.calls[0]?.[0] as {
      system?: string
      providerOptions?: Record<string, unknown>
      tools?: Record<string, unknown>
      prepareStep?: unknown
    }
    expect(call.system).toBeUndefined()
    expect((call.providerOptions?.google as { cachedContent?: string })?.cachedContent).toBe(
      'cache-tools-1',
    )
    expect(
      (
        call.providerOptions?.google as {
          rebelCachedContentOwnsRequestContract?: boolean
        }
      )?.rebelCachedContentOwnsRequestContract,
    ).toBe(true)
    expect(call.tools).toHaveProperty('fetch_source_range')
    expect(call.prepareStep).toBeUndefined()

    const latest = supabase.messages[supabase.messages.length - 1]
    expect(latest).toMatchObject({
      role: 'assistant',
      content: 'cached tool answer',
    })
    expect(latest.debug_info).toMatchObject({
      googleCache: {
        featureEnabled: true,
        cacheCreated: true,
        compatibilityRetryAttempted: false,
        compatibilityRetrySucceeded: false,
        disabledForToolUsePreflight: false,
        disabledForCompatibilityRetry: false,
      },
      experimental: {
        agenticTranscriptRecall: {
          enabled: true,
          wrapperUsed: true,
          toolAvailable: true,
          toolChoicePreflight: 'required',
          toolChoiceApplied: false,
        },
      },
    })
  })

  it('uses the uncached google core path when explicit cache is disabled', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-google-cache-off',
        provider: 'google',
        modelName: 'gemini-1.5-flash',
      }),
    )
    buildMemoryPlanMock.mockResolvedValueOnce({
      mode: 'summary_window',
      promptBlocks: [
        {
          role: 'system',
          content: 'CTX',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'assistant',
          content: 'previous turn',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
        {
          role: 'user',
          content: 'latest user message',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
      ],
      fallbackSystemPrompt: 'CTX',
      fallbackMessages: [
        { role: 'assistant', content: 'previous turn' },
        { role: 'user', content: 'latest user message' },
      ],
      staticSystemPrompt: 'CTX',
      dynamicContext: null,
      ragInfo: null,
    })
    isGoogleExplicitCacheEnabledMock.mockReturnValueOnce(false)
    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    streamTextMock.mockResolvedValue({
      textStream: ['uncached answer'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 20, outputTokens: 10, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-google-cache-off',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-google-cache-off',
      status: 'success',
    })
    expect(createGoogleCacheMock).not.toHaveBeenCalled()
    const call = streamTextMock.mock.calls[0]?.[0] as {
      system?: string
      messages?: Array<{ role: string; content: string }>
      providerOptions?: Record<string, unknown>
    }
    expect(call.system).toBe('CTX')
    expect(call.messages).toEqual([
      { role: 'assistant', content: 'previous turn' },
      { role: 'user', content: 'latest user message' },
    ])
    expect(
      (call.providerOptions?.google as { cachedContent?: string } | undefined)?.cachedContent,
    ).toBeUndefined()

    const latest = supabase.messages[supabase.messages.length - 1]
    expect(latest).toMatchObject({
      role: 'assistant',
      content: 'uncached answer',
    })
    expect(latest.debug_info).toMatchObject({
      googleCache: {
        featureEnabled: false,
        cacheCreated: false,
        meetsMinTokens: true,
        disabledForToolUsePreflight: false,
        disabledForCompatibilityRetry: false,
      },
    })
  })

  it('retries cached Google tool-capable turns without cache after a provider compatibility conflict', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-google-cache-retry',
        provider: 'google',
        modelName: 'gemini-2.5-flash',
      }),
    )
    resolveAgenticTranscriptRecallRuntimeConfigMock.mockReturnValue(
      buildAgenticTranscriptRecallRuntimeConfig(),
    )
    deriveAgenticTranscriptRecallSourceHintsMock.mockReturnValue(
      buildAgenticTranscriptRecallSourceHints(),
    )
    loadAgenticTranscriptRecallSourceMapMock.mockResolvedValue(
      buildAgenticTranscriptRecallSourceMap(),
    )
    buildMemoryPlanMock.mockResolvedValueOnce({
      mode: 'summary_window',
      promptBlocks: [
        {
          role: 'system',
          content: 'CTX',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'assistant',
          content: 'previous turn',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
        {
          role: 'user',
          content: 'latest user message',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
      ],
      fallbackSystemPrompt: 'CTX',
      fallbackMessages: [
        { role: 'assistant', content: '좋아. 내가 지킬게.' },
        { role: 'user', content: '지난번에 한 약속 정확히 다시 말해줘.' },
      ],
      staticSystemPrompt: 'CTX',
      dynamicContext: null,
      ragInfo: null,
    })
    resolveGoogleCacheDecisionMock.mockReturnValue({ enabled: true, minTokens: 1024 })
    createGoogleCacheMock.mockResolvedValueOnce({
      success: true,
      cacheName: 'cache-1',
      cachedTokenCount: 777,
    })
    streamTextMock
      .mockResolvedValueOnce({
        textStream: [],
        fullStream: (async function* () {
          yield {
            type: 'error',
            error: {
              message: 'cached content is not compatible with function calling',
              code: 'INVALID_ARGUMENT',
            },
          }
        })(),
        finishReason: Promise.resolve('error'),
        providerMetadata: Promise.resolve({}),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      })
      .mockResolvedValueOnce({
        textStream: ['retried answer'],
        finishReason: Promise.resolve('stop'),
        providerMetadata: Promise.resolve({}),
        usage: Promise.resolve({ inputTokens: 20, outputTokens: 10, totalTokens: 30 }),
      })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-google-cache-retry',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-google-cache-retry',
      status: 'success',
    })
    expect(createGoogleCacheMock).toHaveBeenCalledTimes(1)
    expect(streamTextMock).toHaveBeenCalledTimes(2)

    const firstCall = streamTextMock.mock.calls[0]?.[0] as {
      system?: string
      providerOptions?: Record<string, unknown>
      tools?: Record<string, unknown>
      prepareStep?: unknown
    }
    const secondCall = streamTextMock.mock.calls[1]?.[0] as {
      system?: string
      providerOptions?: Record<string, unknown>
      tools?: Record<string, unknown>
      prepareStep?: unknown
    }

    expect(firstCall.system).toBeUndefined()
    expect((firstCall.providerOptions?.google as { cachedContent?: string })?.cachedContent).toBe(
      'cache-1',
    )
    expect(
      (
        firstCall.providerOptions?.google as {
          rebelCachedContentOwnsRequestContract?: boolean
        }
      )?.rebelCachedContentOwnsRequestContract,
    ).toBe(true)
    expect(firstCall.tools).toHaveProperty('fetch_source_range')
    expect(firstCall.prepareStep).toBeUndefined()
    expect(secondCall.system).toContain('Experimental Transcript Recall')
    expect(secondCall.tools).toHaveProperty('fetch_source_range')
    expect(typeof secondCall.prepareStep).toBe('function')
    expect(
      (secondCall.providerOptions?.google as { cachedContent?: string } | undefined)?.cachedContent,
    ).toBeUndefined()

    const latest = supabase.messages[supabase.messages.length - 1]
    expect(latest).toMatchObject({
      role: 'assistant',
      content: 'retried answer',
    })
    expect(latest.debug_info).toMatchObject({
      googleCache: {
        featureEnabled: false,
        cacheCreated: false,
        compatibilityRetryAttempted: true,
        compatibilityRetrySucceeded: true,
        compatibilityRetryReason: 'cached content is not compatible with function calling',
        disabledForCompatibilityRetry: true,
      },
    })
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
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        status: 'error',
        lifecycle_stage: 'empty_response',
        failure_stage: 'empty_response',
      }),
    )
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

  it('maps OpenAI rate limit stream errors to a user-facing message', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-openai-rate-limit',
        provider: 'openai',
        modelName: 'gpt-5-mini',
      }),
    )
    streamTextMock.mockResolvedValue({
      textStream: [],
      fullStream: (async function* () {
        yield {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            code: 'rate_limit_exceeded',
            message: "We're currently processing too many requests — please try again later.",
            param: null,
          },
        }
      })(),
      finishReason: Promise.resolve('error'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    })

    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-openai-rate-limit',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-openai-rate-limit',
      status: 'error',
    })
    expect(result.results[0].error).toContain('OpenAI is currently rate limiting requests')
    expect(result.results[0].error).not.toContain('empty response')
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        status: 'error',
        lifecycle_stage: 'provider_stream_error',
        failure_stage: 'provider_stream_error',
      }),
    )
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

  it('passes through unknown upstream API messages when no known mapping exists', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-unknown-upstream-error',
        provider: 'openai',
        modelName: 'gpt-5-mini',
      }),
    )

    const unknownUpstreamError = new MockAPICallError({
      message: 'custom upstream failure',
      responseBody: JSON.stringify({
        error: {
          type: 'weird_provider_error',
          code: 'custom_failure',
          message: 'custom upstream failure',
          param: null,
        },
      }),
    })
    streamTextMock.mockRejectedValue(unknownUpstreamError)

    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-unknown-upstream-error',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-unknown-upstream-error',
      status: 'error',
    })
    expect(result.results[0].error).toContain('custom upstream failure')
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
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        status: 'error',
        lifecycle_stage: 'persisting_response',
        failure_stage: 'persisting_response',
      }),
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
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        status: 'error',
        lifecycle_stage: 'provider_stream_error',
        failure_stage: 'provider_stream_error',
      }),
    )
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
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        status: 'error',
        lifecycle_stage: 'empty_response',
        failure_stage: 'empty_response',
      }),
    )
    expect(supabase.messages).toHaveLength(0)
  })

  it('marks blocked empty Gemini responses as content-filtered failures', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-gemini-filtered-empty',
        provider: 'google',
        modelName: 'gemini-1.5',
      }),
    )
    streamTextMock.mockResolvedValue({
      textStream: [],
      finishReason: Promise.resolve('content-filter'),
      providerMetadata: Promise.resolve({
        google: {
          finishReason: 'SAFETY',
          safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT' }],
        },
      }),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 0, totalTokens: 10 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-gemini-filtered-empty',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({
      jobId: 'job-gemini-filtered-empty',
      status: 'error',
    })
    expect(result.results[0].error).toContain('Blocked by Google Gemini content filter')
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        status: 'error',
        lifecycle_stage: 'content_filtered',
        failure_stage: 'content_filtered',
      }),
    )
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

    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSystemPrompt: expect.stringContaining('Your name is: Bob'),
      }),
    )
    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSystemPrompt: expect.stringContaining('I like coffee.'),
      }),
    )
  })

  it('omits temperature and sets low OpenAI text verbosity by default', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-omit-temperature',
        provider: 'openai',
        modelName: 'gpt-5.1-chat-latest',
      }),
    )
    streamTextMock.mockResolvedValue({
      textStream: ['hello world'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-omit-temperature',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    await processChatJobs(1)

    const call = streamTextMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).not.toHaveProperty('temperature')
    expect(call.providerOptions).toMatchObject({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
      },
    })
  })

  it('passes active lorebook as extra dynamic context into memory planning', async () => {
    const moduleData: unknown = {
      id: 'module-1',
      user_id: 'user-1',
      name: 'Lorebook Module',
      description: null,
      lorebook: [
        {
          key: 'magic',
          content: 'Magic lore block',
          insertorder: 10,
        },
      ],
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
      modules: [{ module_id: 'module-1', modules: moduleData }],
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    parseChatJobPayloadMock.mockReturnValue({
      version: 1,
      requestId: 'req-lorebook',
      chatId: 'chat-1',
      userId: 'user-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      sanitizedMessages: [{ role: 'user', content: 'Tell me about magic' }],
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
      id: 'job-lorebook',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')

    await processChatJobs(1)

    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extraDynamicContext: ['=== Active Lorebook Entries ===\nMagic lore block'],
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

  it('supports turn-based regeneration and updates debug_info on summary failure', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      initialTurns: [
        {
          id: 'turn-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          turn_index: 1,
          user_message_id: 'user-1-msg',
          active_assistant_message_id: 'assistant-1',
        },
      ],
      initialMessages: [
        {
          id: 'user-1-msg',
          chat_id: 'chat-1',
          role: 'user',
          content: 'old question',
          turn_id: 'turn-1',
          model_used: null,
          prompt_tokens: null,
          completion_tokens: null,
          debug_info: null,
          user_id: 'user-1',
        },
        {
          id: 'assistant-1',
          chat_id: 'chat-1',
          role: 'assistant',
          content: 'old reply',
          turn_id: 'turn-1',
          variant_index: 1,
          message_status: 'completed',
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
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-3',
        turnId: 'turn-1',
        sanitizedMessages: [
          { role: 'user', content: 'old question' },
          { role: 'assistant', content: 'old reply' },
        ],
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
      }),
    )
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
    expect(supabase.messages.find((msg) => msg.id === 'assistant-1')).toMatchObject({
      message_status: 'superseded',
    })
    await vi.waitFor(() => {
      const latest = supabase.messages[supabase.messages.length - 1]
      expect(latest).toMatchObject({
        content: 'new answer',
        turn_id: 'turn-1',
        supersedes_message_id: 'assistant-1',
      })
      expect(latest.debug_info).toMatchObject({
        summaryWarning: expect.objectContaining({
          error: 'summary failed',
          attempts: 2,
        }),
      })
    })
  })

  it('excludes the superseded assistant from the actual stream payload during prefix-mode regeneration', async () => {
    const supabase = createChatJobRunnerSupabaseMock({
      rpc: { get_decrypted_secret: () => decryptSecretMock() },
      initialTurns: [
        {
          id: 'turn-1',
          chat_id: 'chat-1',
          turn_index: 1,
          user_message_id: 'user-1',
          active_assistant_message_id: 'assistant-1',
        },
      ],
      initialMessages: [
        {
          id: 'user-1',
          chat_id: 'chat-1',
          turn_id: 'turn-1',
          role: 'user',
          content: 'old question',
          message_status: 'completed',
          user_id: 'user-1',
        },
        {
          id: 'assistant-1',
          chat_id: 'chat-1',
          turn_id: 'turn-1',
          role: 'assistant',
          content: 'old active assistant',
          message_status: 'completed',
          user_id: 'user-1',
        },
      ],
    })
    createAdminClientMock.mockReturnValue(supabase)

    decryptSecretMock.mockResolvedValue('sk-test')
    countProjectedConversationMessagesMock.mockResolvedValue(2)
    loadProjectedConversationTailMock.mockResolvedValue([
      { id: 'user-1', role: 'user', content: 'latest user message' },
    ])
    buildMemoryPlanMock.mockImplementation(
      async ({ baseSystemPrompt, sanitizedMessages }: Record<string, unknown>) => ({
        mode: 'prefix_live_blocks',
        promptBlocks: [
          {
            role: 'system',
            content: baseSystemPrompt as string,
            cachePreference: 'prefer-cache',
            stability: 'static',
          },
          ...((sanitizedMessages as Array<{ role: string; content: string }>) ?? []).map(
            (message) => ({
              role: message.role,
              content: message.content,
              cachePreference: 'prefer-cache',
              stability: 'live',
            }),
          ),
        ],
        fallbackSystemPrompt: baseSystemPrompt as string,
        fallbackMessages: sanitizedMessages,
        staticSystemPrompt: baseSystemPrompt as string,
        dynamicContext: null,
        ragInfo: null,
      }),
    )
    parseChatJobPayloadMock.mockReturnValue(
      buildValidPayload({
        requestId: 'req-prefix-regen',
        turnId: 'turn-1',
        sanitizedMessages: [
          { role: 'user', content: 'old question' },
          { role: 'assistant', content: 'old active assistant' },
        ],
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
      }),
    )
    streamTextMock.mockResolvedValue({
      textStream: ['regenerated answer'],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve({ inputTokens: 5, outputTokens: 10, totalTokens: 15 }),
    })
    claimPendingJobMock.mockResolvedValueOnce({
      id: 'job-prefix-regen',
      payload: { ok: true },
    })
    claimPendingJobMock.mockResolvedValueOnce(null)

    const { processChatJobs } = await import('./service')
    const result = await processChatJobs(1)

    expect(result.results[0]).toMatchObject({ status: 'success', jobId: 'job-prefix-regen' })
    expect(countProjectedConversationMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
      }),
    )
    expect(loadProjectedConversationTailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        limitMessages: 1,
        excludeAssistantForTurnId: 'turn-1',
      }),
    )
    expect(loadGenerationTranscriptMock).not.toHaveBeenCalled()
    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sanitizedMessages: [{ role: 'user', content: 'latest user message', messageId: 'user-1' }],
      }),
    )

    const call = streamTextMock.mock.calls[0]?.[0] as {
      messages?: Array<{ content: string; messageId?: string; role: string }>
    }
    expect(call.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'latest user message' }),
      ]),
    )
    expect(call.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'old active assistant' }),
      ]),
    )
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

    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
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
