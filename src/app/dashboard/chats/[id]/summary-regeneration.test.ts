import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const fetchMock = vi.fn()

const hoistedMocks = vi.hoisted(() => ({
  buildInternalApiUrlMock: vi.fn(),
  resolveSummaryModelPreferenceMock: vi.fn(),
}))

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrl: (...args: unknown[]) => hoistedMocks.buildInternalApiUrlMock(...args),
}))

vi.mock('@/lib/chat/summary-model-preference', () => ({
  resolveSummaryModelPreference: (...args: unknown[]) =>
    hoistedMocks.resolveSummaryModelPreferenceMock(...args),
}))

function buildSupabase(options?: {
  usageEvents?: Array<Record<string, unknown>>
  apiKeys?: Array<Record<string, unknown>>
}) {
  return createSupabaseMock({
    tables: {
      chat_usage_events: {
        rows: options?.usageEvents ?? [],
        primaryKeys: ['id'],
      },
      api_keys: {
        rows: options?.apiKeys ?? [],
        primaryKeys: ['id'],
      },
    },
  })
}

describe('summary regeneration helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.unstubAllEnvs()
    fetchMock.mockReset()
    hoistedMocks.buildInternalApiUrlMock.mockReset()
    hoistedMocks.resolveSummaryModelPreferenceMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('builds chunk and meta regeneration payloads from summary levels', async () => {
    const { buildSummaryRegenerationPayload } = await import('./summary-regeneration')

    expect(buildSummaryRegenerationPayload({ level: 0, start_seq: 1, end_seq: 10 })).toEqual({
      regenerate: {
        chunkRanges: [{ startSeq: 1, endSeq: 10 }],
      },
    })
    const fallbackSummary = {
      level: 0,
      start_seq: 1,
      end_seq: 10,
      summary_status: 'fallback' as const,
    }
    expect(buildSummaryRegenerationPayload(fallbackSummary)).toEqual({
      regenerate: {
        chunkRanges: [{ startSeq: 1, endSeq: 10 }],
      },
    })
    expect(buildSummaryRegenerationPayload({ level: 1, start_seq: 11, end_seq: 20 })).toEqual({
      regenerate: {
        metaRanges: [{ startSeq: 11, endSeq: 20 }],
      },
    })
    expect(buildSummaryRegenerationPayload({ level: 2, start_seq: 21, end_seq: 30 })).toEqual({
      error: 'This summary type does not support regeneration.',
    })
  })

  it('prefers an explicit summary model preference over usage-event fallback', async () => {
    const supabase = buildSupabase()
    hoistedMocks.resolveSummaryModelPreferenceMock.mockResolvedValue({
      provider: 'openai',
      modelName: 'gpt-4.1-mini',
      apiKeyId: 'preferred-key',
    })
    const { resolveSummaryRegenerationModelConfig } = await import('./summary-regeneration')

    await expect(
      resolveSummaryRegenerationModelConfig(supabase as never, 'chat-1', 'user-1'),
    ).resolves.toEqual({
      provider: 'openai',
      modelName: 'gpt-4.1-mini',
      apiKeyId: 'preferred-key',
    })
  })

  it('falls back to the latest usage event and active API key when no preference exists', async () => {
    const supabase = buildSupabase({
      usageEvents: [
        {
          id: 'usage-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          api_key_id: 'api-key-1',
          model_provider: 'anthropic',
          model_name: null,
          created_at: '2026-04-14T00:00:00.000Z',
        },
      ],
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'anthropic',
          model_preference: 'claude-haiku-4-5',
          is_active: true,
        },
      ],
    })
    hoistedMocks.resolveSummaryModelPreferenceMock.mockResolvedValue(null)
    const { resolveSummaryRegenerationModelConfig } = await import('./summary-regeneration')

    await expect(
      resolveSummaryRegenerationModelConfig(supabase as never, 'chat-1', 'user-1'),
    ).resolves.toEqual({
      provider: 'anthropic',
      modelName: 'claude-haiku-4-5',
      apiKeyId: 'api-key-1',
    })
  })

  it('reuses the latest usage model while it remains registered', async () => {
    const supabase = buildSupabase({
      usageEvents: [
        {
          id: 'usage-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          api_key_id: 'api-key-1',
          model_provider: 'anthropic',
          model_name: 'claude-haiku-4-5',
          created_at: '2026-04-14T00:00:00.000Z',
        },
      ],
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'anthropic',
          model_preference: 'claude-opus-4-5',
          is_active: true,
        },
      ],
    })
    hoistedMocks.resolveSummaryModelPreferenceMock.mockResolvedValue(null)
    const { resolveSummaryRegenerationModelConfig } = await import('./summary-regeneration')

    await expect(
      resolveSummaryRegenerationModelConfig(supabase as never, 'chat-1', 'user-1'),
    ).resolves.toEqual({
      provider: 'anthropic',
      modelName: 'claude-haiku-4-5',
      apiKeyId: 'api-key-1',
    })
  })

  it('falls back to the active key default when the historical model was retired', async () => {
    const supabase = buildSupabase({
      usageEvents: [
        {
          id: 'usage-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          api_key_id: 'api-key-1',
          model_provider: 'google',
          model_name: 'gemini-3-pro-preview',
          created_at: '2026-04-14T00:00:00.000Z',
        },
      ],
      apiKeys: [
        {
          id: 'api-key-1',
          user_id: 'user-1',
          provider: 'google',
          model_preference: null,
          is_active: true,
        },
      ],
    })
    hoistedMocks.resolveSummaryModelPreferenceMock.mockResolvedValue(null)
    const { resolveSummaryRegenerationModelConfig } = await import('./summary-regeneration')

    await expect(
      resolveSummaryRegenerationModelConfig(supabase as never, 'chat-1', 'user-1'),
    ).resolves.toEqual({
      provider: 'google',
      modelName: 'gemini-2.5-flash',
      apiKeyId: 'api-key-1',
    })
  })

  it('sends regeneration requests with auth headers and returns API error bodies', async () => {
    hoistedMocks.buildInternalApiUrlMock.mockReturnValue(
      'https://internal.example.com/api/summaries/generate',
    )
    fetchMock.mockResolvedValue(Response.json({ error: 'Queue unavailable' }, { status: 503 }))
    vi.stubEnv('SUMMARY_GENERATION_SECRET', 'summary-secret')
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'bypass-secret')

    const { requestSummaryRegeneration } = await import('./summary-regeneration')

    await expect(
      requestSummaryRegeneration({
        chatId: 'chat-1',
        userId: 'user-1',
        provider: 'openai',
        modelName: 'gpt-4.1-mini',
        apiKeyId: 'api-key-1',
        regenerate: {
          chunkRanges: [{ startSeq: 1, endSeq: 10 }],
        },
      }),
    ).resolves.toEqual({ error: 'Queue unavailable' })

    expect(fetchMock).toHaveBeenCalledWith('https://internal.example.com/api/summaries/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer summary-secret',
        'x-vercel-protection-bypass': 'bypass-secret',
      },
      body: JSON.stringify({
        chatId: 'chat-1',
        userId: 'user-1',
        provider: 'openai',
        modelName: 'gpt-4.1-mini',
        apiKeyId: 'api-key-1',
        regenerate: {
          chunkRanges: [{ startSeq: 1, endSeq: 10 }],
        },
      }),
      cache: 'no-store',
    })
  })
})
