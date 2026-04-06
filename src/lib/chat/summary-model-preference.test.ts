import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSupabaseMock } from '@/tests/mocks/supabase'

const getDefaultModelForProviderMock = vi.fn((provider: string) => `default-${provider}`)

vi.mock('@/lib/llm/default-model', () => ({
  getDefaultModelForProvider: (...args: Parameters<typeof getDefaultModelForProviderMock>) =>
    getDefaultModelForProviderMock(...args),
}))

function createSummaryPreferenceSupabaseMock({
  profiles = [],
  apiKeys = [],
}: {
  profiles?: Array<Record<string, unknown>>
  apiKeys?: Array<Record<string, unknown>>
} = {}) {
  return createSupabaseMock({
    tables: {
      profiles: {
        rows: profiles,
        primaryKeys: ['id'],
      },
      api_keys: {
        rows: apiKeys,
        primaryKeys: ['id'],
      },
    },
  })
}

describe('resolveSummaryModelPreference', () => {
  beforeEach(() => {
    getDefaultModelForProviderMock.mockReset()
    getDefaultModelForProviderMock.mockImplementation((provider: string) => `default-${provider}`)
  })

  it('returns null when profile preference query fails', async () => {
    const supabase = createSummaryPreferenceSupabaseMock()
    const { resolveSummaryModelPreference } = await import('./summary-model-preference')

    const result = await resolveSummaryModelPreference({
      supabase: supabase as never,
      userId: 'user-1',
    })

    expect(result).toBeNull()
  })

  it('returns null when summary key is not configured', async () => {
    const supabase = createSummaryPreferenceSupabaseMock({
      profiles: [{ id: 'user-1', summary_api_key_id: null }],
    })
    const { resolveSummaryModelPreference } = await import('./summary-model-preference')

    const result = await resolveSummaryModelPreference({
      supabase: supabase as never,
      userId: 'user-1',
    })

    expect(result).toBeNull()
  })

  it('returns null when stored summary key is unavailable', async () => {
    const supabase = createSummaryPreferenceSupabaseMock({
      profiles: [{ id: 'user-1', summary_api_key_id: 'key-1' }],
    })
    const { resolveSummaryModelPreference } = await import('./summary-model-preference')

    const result = await resolveSummaryModelPreference({
      supabase: supabase as never,
      userId: 'user-1',
    })

    expect(result).toBeNull()
  })

  it('returns null when stored summary key is inactive', async () => {
    const supabase = createSummaryPreferenceSupabaseMock({
      profiles: [{ id: 'user-1', summary_api_key_id: 'key-1' }],
      apiKeys: [
        {
          id: 'key-1',
          user_id: 'user-1',
          provider: 'openai',
          model_preference: 'gpt-4o-mini',
          is_active: false,
        },
      ],
    })
    const { resolveSummaryModelPreference } = await import('./summary-model-preference')

    const result = await resolveSummaryModelPreference({
      supabase: supabase as never,
      userId: 'user-1',
    })

    expect(result).toBeNull()
  })

  it('returns null when stored key provider is embedding-only', async () => {
    const supabase = createSummaryPreferenceSupabaseMock({
      profiles: [{ id: 'user-1', summary_api_key_id: 'key-1' }],
      apiKeys: [
        {
          id: 'key-1',
          user_id: 'user-1',
          provider: 'voyage_embeddings',
          model_preference: null,
          is_active: true,
        },
      ],
    })
    const { resolveSummaryModelPreference } = await import('./summary-model-preference')

    const result = await resolveSummaryModelPreference({
      supabase: supabase as never,
      userId: 'user-1',
    })

    expect(result).toBeNull()
  })

  it('returns configured model preference when key is valid', async () => {
    const supabase = createSummaryPreferenceSupabaseMock({
      profiles: [{ id: 'user-1', summary_api_key_id: 'key-1' }],
      apiKeys: [
        {
          id: 'key-1',
          user_id: 'user-1',
          provider: 'openai',
          model_preference: 'gpt-4.1-mini',
          is_active: true,
        },
      ],
    })
    const { resolveSummaryModelPreference } = await import('./summary-model-preference')

    const result = await resolveSummaryModelPreference({
      supabase: supabase as never,
      userId: 'user-1',
    })

    expect(result).toEqual({
      provider: 'openai',
      modelName: 'gpt-4.1-mini',
      apiKeyId: 'key-1',
    })
    expect(getDefaultModelForProviderMock).not.toHaveBeenCalled()
  })

  it('falls back to provider default model when preference is missing', async () => {
    const supabase = createSummaryPreferenceSupabaseMock({
      profiles: [{ id: 'user-1', summary_api_key_id: 'key-1' }],
      apiKeys: [
        {
          id: 'key-1',
          user_id: 'user-1',
          provider: 'anthropic',
          model_preference: null,
          is_active: true,
        },
      ],
    })
    const { resolveSummaryModelPreference } = await import('./summary-model-preference')

    const result = await resolveSummaryModelPreference({
      supabase: supabase as never,
      userId: 'user-1',
    })

    expect(result).toEqual({
      provider: 'anthropic',
      modelName: 'default-anthropic',
      apiKeyId: 'key-1',
    })
    expect(getDefaultModelForProviderMock).toHaveBeenCalledWith('anthropic')
  })
})
