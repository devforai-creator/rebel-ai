import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText, type LanguageModel } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model-factory'
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
    vi.unstubAllGlobals()
  })

  it('runs regeneration with canonical chunk size and creates canonical chunks through sealedThroughSeq', async () => {
    getLastSummaryEndMock.mockResolvedValue(10)
    const supabase = createSupabaseMock({
      profilePrompts: {
        chunk_summary_prompt: 'chunk-prompt',
        meta_summary_prompt: 'meta-prompt',
        fact_extraction_prompt: 'fact-prompt',
      },
      enableRag: true,
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
        enableFactGeneration: true,
        chunkSize: 10,
      }),
    )
    expect(processChunkSummariesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totalMessages: 106,
        previousEnd: 10,
        chunkPrompt: 'chunk-prompt',
        factPrompt: 'fact-prompt',
        enableFactGeneration: true,
      }),
    )
    expect(processMetaSummariesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metaPrompt: 'meta-prompt',
      }),
    )
  })

  it('applies the saved summary preference to regeneration, chunks, facts, and meta summaries', async () => {
    getLastSummaryEndMock.mockResolvedValue(0)
    const supabase = createSupabaseMock({
      profilePrompts: { summary_reasoning_effort: 'max' },
      enableRag: true,
    })
    const { updateCanonicalSealedMemoryArtifacts } = await import('./sealed-memory-writer')
    await updateCanonicalSealedMemoryArtifacts({
      supabase: supabase as unknown as SupabaseClientType,
      chatId: 'chat-1',
      userId: 'user-1',
      model: buildLanguageModel({
        provider: 'deepseek',
        modelName: 'deepseek-v4-pro',
        apiKey: 'test-key',
      }),
      provider: 'deepseek',
      modelName: 'deepseek-v4-pro',
      regenerate: { chunkRanges: [{ startSeq: 1, endSeq: 10 }] },
      sealedThroughSeq: 100,
    })
    const fetchMock = vi.fn().mockImplementation(async () =>
      Response.json({
        id: 'summary-test',
        created: 1,
        model: 'deepseek-v4-pro',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'summary' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    for (const invocation of [
      processRegenerationRequestsMock.mock.calls[0][0],
      processChunkSummariesMock.mock.calls[0][0],
      processMetaSummariesMock.mock.calls[0][0],
    ]) {
      await generateText({ model: invocation.model, prompt: 'Summarize' })
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body)).toMatchObject({
        thinking: { type: 'enabled' },
        reasoning_effort: 'max',
      })
    }
  })

  it('returns after regeneration when there is not yet a full canonical chunk to seal', async () => {
    const supabase = createSupabaseMock({ profilePrompts: null, enableRag: false })
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

    expect(processRegenerationRequestsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enableFactGeneration: false,
      }),
    )
    expect(processChunkSummariesMock).not.toHaveBeenCalled()
    expect(processMetaSummariesMock).not.toHaveBeenCalled()
  })
})

function createSupabaseMock({
  profilePrompts,
  enableRag,
}: {
  profilePrompts: Record<string, string> | null
  enableRag: boolean
}) {
  return {
    from(table: string) {
      if (table !== 'profiles') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: profilePrompts
                ? {
                    ...profilePrompts,
                    enable_episodic_rag: enableRag,
                    voyage_embedding_api_key_id: enableRag ? 'voyage-key-1' : null,
                  }
                : {
                    enable_episodic_rag: enableRag,
                    voyage_embedding_api_key_id: enableRag ? 'voyage-key-1' : null,
                  },
              error: null,
            }),
          }),
        }),
      }
    },
  }
}
