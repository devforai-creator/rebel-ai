import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import type { SupabaseClientType } from '@/tests/mocks/supabase'

const mockModel = {} as LanguageModel

const getMessageCountMock = vi.fn()
const updateCanonicalSealedMemoryArtifactsMock = vi.fn()

vi.mock('./db-helpers', () => ({
  getMessageCount: (...args: unknown[]) => getMessageCountMock(...args),
}))

vi.mock('./sealed-memory-writer', () => ({
  updateCanonicalSealedMemoryArtifacts: (...args: unknown[]) =>
    updateCanonicalSealedMemoryArtifactsMock(...args),
}))

describe('updateSummaries orchestrator', () => {
  beforeEach(() => {
    vi.resetModules()
    getMessageCountMock.mockReset()
    updateCanonicalSealedMemoryArtifactsMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns early when total messages are below chunk threshold', async () => {
    getMessageCountMock.mockResolvedValue(5)
    const supabase = createSupabaseMock({ profilePrompts: null })
    const { updateSummaries } = await import('./index')

    await updateSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      regenerate: undefined,
    })

    expect(updateCanonicalSealedMemoryArtifactsMock).not.toHaveBeenCalled()
  }, 10_000)

  it('delegates canonical sealed-memory generation with the summary-window cutoff', async () => {
    getMessageCountMock.mockResolvedValue(25)
    const supabase = createSupabaseMock({ profilePrompts: null })
    const { updateSummaries } = await import('./index')

    await updateSummaries({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      regenerate: { regenerateAll: true },
    })

    expect(updateCanonicalSealedMemoryArtifactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        userId: 'user-1',
        sealedThroughSeq: 15,
        regenerate: { regenerateAll: true },
      }),
    )
  })

  it('throws when the projected conversation size cannot be determined', async () => {
    getMessageCountMock.mockResolvedValue(null)
    const supabase = createSupabaseMock({ profilePrompts: null })
    const { updateSummaries } = await import('./index')

    await expect(
      updateSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        regenerate: undefined,
      }),
    ).rejects.toThrow('Failed to determine projected conversation size for summary update')

    expect(updateCanonicalSealedMemoryArtifactsMock).not.toHaveBeenCalled()
  })

  it('propagates canonical sealed-memory writer failures', async () => {
    getMessageCountMock.mockResolvedValue(25)
    updateCanonicalSealedMemoryArtifactsMock.mockRejectedValue(new Error('writer failed'))
    const supabase = createSupabaseMock({ profilePrompts: null })
    const { updateSummaries } = await import('./index')

    await expect(
      updateSummaries({
        supabase: supabase as unknown as SupabaseClientType,
        chatId: 'chat-1',
        userId: 'user-1',
        model: mockModel,
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        regenerate: undefined,
      }),
    ).rejects.toThrow('writer failed')
  })
})

function createSupabaseMock({ profilePrompts }: { profilePrompts: Record<string, string> | null }) {
  return {
    from(table: string) {
      if (table !== 'profiles') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: profilePrompts,
              error: null,
            }),
          }),
        }),
      }
    },
  }
}
