import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import type { SupabaseClientType } from '@/tests/mocks/supabase'

const mockModel = {} as LanguageModel

const getLastSummaryEndMock = vi.fn()
const processChunkSummariesMock = vi.fn()
const processMetaSummariesMock = vi.fn()
const processRegenerationRequestsMock = vi.fn()

vi.mock('./db-helpers', () => ({
  getLastSummaryEnd: (...args: unknown[]) => getLastSummaryEndMock(...args),
}))

vi.mock('./chunk-summarizer', async () => {
  const actual = await vi.importActual<typeof import('./chunk-summarizer')>('./chunk-summarizer')
  return {
    ...actual,
    processChunkSummaries: (...args: unknown[]) => processChunkSummariesMock(...args),
  }
})

vi.mock('./meta-summarizer', async () => {
  const actual = await vi.importActual<typeof import('./meta-summarizer')>('./meta-summarizer')
  return {
    ...actual,
    processMetaSummaries: (...args: unknown[]) => processMetaSummariesMock(...args),
  }
})

vi.mock('./regeneration', () => ({
  processRegenerationRequests: (...args: unknown[]) => processRegenerationRequestsMock(...args),
}))

describe('updateCanonicalSealedMemoryArtifacts', () => {
  beforeEach(() => {
    vi.resetModules()
    getLastSummaryEndMock.mockReset()
    processChunkSummariesMock.mockReset()
    processMetaSummariesMock.mockReset()
    processRegenerationRequestsMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs regeneration with canonical chunk size and creates canonical chunks through sealedThroughSeq', async () => {
    getLastSummaryEndMock.mockResolvedValue(10)
    const supabase = createSupabaseMock({
      profilePrompts: {
        chunk_summary_prompt: 'chunk-prompt',
        meta_summary_prompt: 'meta-prompt',
        fact_extraction_prompt: 'fact-prompt',
      },
    })
    const { updateCanonicalSealedMemoryArtifacts } = await import('./sealed-memory-writer')

    await updateCanonicalSealedMemoryArtifacts({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-5.4',
      regenerate: { chunkRanges: [{ startSeq: 1, endSeq: 10 }] },
      sealedThroughSeq: 96,
    })

    expect(processRegenerationRequestsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkPrompt: 'chunk-prompt',
        metaPrompt: 'meta-prompt',
        factPrompt: 'fact-prompt',
        chunkSize: 10,
      }),
    )
    expect(processChunkSummariesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totalMessages: 106,
        previousEnd: 10,
        chunkPrompt: 'chunk-prompt',
        factPrompt: 'fact-prompt',
      }),
    )
    expect(processMetaSummariesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metaPrompt: 'meta-prompt',
      }),
    )
  })

  it('returns after regeneration when there is not yet a full canonical chunk to seal', async () => {
    const supabase = createSupabaseMock({ profilePrompts: null })
    const { updateCanonicalSealedMemoryArtifacts } = await import('./sealed-memory-writer')

    await updateCanonicalSealedMemoryArtifacts({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: mockModel,
      provider: 'openai',
      modelName: 'gpt-5.4',
      regenerate: { regenerateAll: true },
      sealedThroughSeq: 9,
    })

    expect(processRegenerationRequestsMock).toHaveBeenCalled()
    expect(processChunkSummariesMock).not.toHaveBeenCalled()
    expect(processMetaSummariesMock).not.toHaveBeenCalled()
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
