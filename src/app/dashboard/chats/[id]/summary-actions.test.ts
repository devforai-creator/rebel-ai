import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()
const revalidatePathMock = vi.fn()
const fetchMock = vi.fn()

const hoistedMocks = vi.hoisted(() => ({
  buildInternalApiUrlMock: vi.fn(),
  generateFactEmbeddingMock: vi.fn(),
  resolveSummaryModelPreferenceMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

vi.mock('@/lib/embeddings', () => ({
  generateFactEmbedding: (...args: unknown[]) => hoistedMocks.generateFactEmbeddingMock(...args),
}))

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrl: (...args: unknown[]) => hoistedMocks.buildInternalApiUrlMock(...args),
}))

vi.mock('@/lib/chat/summary-model-preference', () => ({
  resolveSummaryModelPreference: (...args: unknown[]) =>
    hoistedMocks.resolveSummaryModelPreferenceMock(...args),
}))

function buildSupabase({
  user,
  chats,
  summaries,
  facts,
  usageEvents,
  apiKeys,
}: {
  user: { id: string } | null
  chats?: Array<Record<string, unknown>>
  summaries?: Array<Record<string, unknown>>
  facts?: Array<Record<string, unknown>>
  usageEvents?: Array<Record<string, unknown>>
  apiKeys?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      chats: {
        rows: chats ?? [],
        primaryKeys: ['id'],
      },
      chat_summaries: {
        rows: summaries ?? [],
        primaryKeys: ['id'],
      },
      chat_facts: {
        rows: facts ?? [],
        primaryKeys: ['id'],
      },
      chat_usage_events: {
        rows: usageEvents ?? [],
        primaryKeys: ['id'],
      },
      api_keys: {
        rows: apiKeys ?? [],
        primaryKeys: ['id'],
      },
    },
  })

  Object.assign(supabase, {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  })

  return supabase
}

function getSummaryRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.chatSummaries as Array<Record<string, unknown>>
}

function getFactRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.chatFacts as Array<Record<string, unknown>>
}

describe('chat summary actions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', fetchMock)
    vi.unstubAllEnvs()
    createClientMock.mockReset()
    revalidatePathMock.mockReset()
    fetchMock.mockReset()
    hoistedMocks.buildInternalApiUrlMock.mockReset()
    hoistedMocks.generateFactEmbeddingMock.mockReset()
    hoistedMocks.resolveSummaryModelPreferenceMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns unauthorized when deleting a summary without a session', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { deleteSummary } = await import('./summary-actions')

    await expect(deleteSummary('summary-1', 'chat-1')).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('deletes an owned summary and revalidates the chat page', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      summaries: [{ id: 'summary-1', chat_id: 'chat-1', summary: 'before' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { deleteSummary } = await import('./summary-actions')

    await expect(deleteSummary('summary-1', 'chat-1')).resolves.toEqual({ success: true })
    expect(getSummaryRows(supabase)).toEqual([])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })

  it('updates fact text with a regenerated embedding', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      facts: [{ id: 'fact-1', chat_id: 'chat-1', facts: 'old', embedding: null }],
    })
    createClientMock.mockResolvedValue(supabase)
    hoistedMocks.generateFactEmbeddingMock.mockResolvedValue([0.12, 0.34])
    const { updateFact } = await import('./summary-actions')

    await expect(updateFact('fact-1', 'chat-1', '  refreshed facts  ')).resolves.toEqual({
      success: true,
    })
    expect(hoistedMocks.generateFactEmbeddingMock).toHaveBeenCalledWith(
      'refreshed facts',
      'user-1',
      supabase,
    )
    expect(getFactRows(supabase)).toEqual([
      {
        id: 'fact-1',
        chat_id: 'chat-1',
        facts: 'refreshed facts',
        embedding: [0.12, 0.34],
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })

  it('rejects blank fact updates before touching embeddings', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      facts: [{ id: 'fact-1', chat_id: 'chat-1', facts: 'old' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateFact } = await import('./summary-actions')

    await expect(updateFact('fact-1', 'chat-1', '   ')).resolves.toEqual({
      error: 'Please enter content.',
    })
    expect(hoistedMocks.generateFactEmbeddingMock).not.toHaveBeenCalled()
  })

  it('reuses the configured summary preference when regenerating a summary', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      summaries: [{ id: 'summary-1', chat_id: 'chat-1', level: 0, start_seq: 1, end_seq: 10 }],
    })
    createClientMock.mockResolvedValue(supabase)
    hoistedMocks.resolveSummaryModelPreferenceMock.mockResolvedValue({
      provider: 'openai',
      modelName: 'gpt-4.1-mini',
      apiKeyId: 'api-key-1',
    })
    hoistedMocks.buildInternalApiUrlMock.mockReturnValue(
      'https://internal.example.com/api/summaries/generate',
    )
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubEnv('SUMMARY_GENERATION_SECRET', 'summary-secret')
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'bypass-secret')
    const { regenerateSummary } = await import('./summary-actions')

    await expect(regenerateSummary('summary-1', 'chat-1')).resolves.toEqual({ success: true })
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
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })

  it('falls back to the latest usage event and returns API JSON errors during fact regeneration', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1' }],
      facts: [{ id: 'fact-1', chat_id: 'chat-1', start_seq: 11, end_seq: 20 }],
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
          model_preference: null,
          is_active: true,
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    hoistedMocks.resolveSummaryModelPreferenceMock.mockResolvedValue(null)
    hoistedMocks.buildInternalApiUrlMock.mockReturnValue(
      'https://internal.example.com/api/summaries/generate',
    )
    fetchMock.mockResolvedValue(Response.json({ error: 'Queue unavailable' }, { status: 503 }))
    vi.stubEnv('SUMMARY_GENERATION_SECRET', 'summary-secret')
    const { regenerateFacts } = await import('./summary-actions')

    await expect(regenerateFacts('fact-1', 'chat-1')).resolves.toEqual({
      error: 'Queue unavailable',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
