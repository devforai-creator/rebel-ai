import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import type { SupabaseClientType } from '@/tests/mocks/supabase'

const mockModel = {} as LanguageModel

const getMessageCountMock = vi.fn()
const getLastSummaryEndMock = vi.fn()
const processChunkSummariesMock = vi.fn()
const processMetaSummariesMock = vi.fn()
const processRegenerationRequestsMock = vi.fn()

vi.mock('./db-helpers', () => ({
  getMessageCount: (...args: unknown[]) => getMessageCountMock(...args),
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

describe('updateSummaries orchestrator', () => {
  beforeEach(() => {
    vi.resetModules()
    getMessageCountMock.mockReset()
    getLastSummaryEndMock.mockReset()
    processChunkSummariesMock.mockReset()
    processMetaSummariesMock.mockReset()
    processRegenerationRequestsMock.mockReset()
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

    expect(processChunkSummariesMock).not.toHaveBeenCalled()
    expect(processMetaSummariesMock).not.toHaveBeenCalled()
    expect(processRegenerationRequestsMock).not.toHaveBeenCalled()
  }, 10_000)

  it('runs regeneration and chunk/meta processors with custom prompts', async () => {
    getMessageCountMock.mockResolvedValue(25)
    getLastSummaryEndMock.mockResolvedValue(10)
    const supabase = createSupabaseMock({
      profilePrompts: {
        chunk_summary_prompt: 'chunk-prompt',
        meta_summary_prompt: 'meta-prompt',
        fact_extraction_prompt: 'fact-prompt',
      },
    })
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

    expect(processRegenerationRequestsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        userId: 'user-1',
        chunkPrompt: 'chunk-prompt',
        metaPrompt: 'meta-prompt',
        factPrompt: 'fact-prompt',
        regenerate: { regenerateAll: true },
      }),
    )
    expect(processChunkSummariesMock).toHaveBeenCalledWith(
      expect.objectContaining({
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
