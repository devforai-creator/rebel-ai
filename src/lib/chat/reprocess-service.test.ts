import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LLM_OUTPUT_LIMITS } from '@/lib/llm/output-limits'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const streamTextMock = vi.fn()
const resolveActiveLlmConfigForUserMock = vi.fn()
const createLanguageModelFromSecretConfigMock = vi.fn()

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
}))

vi.mock('@/lib/chat/llm-config-resolver', () => ({
  resolveActiveLlmConfigForUser: (...args: unknown[]) => resolveActiveLlmConfigForUserMock(...args),
}))

vi.mock('@/lib/llm/language-model-access', () => ({
  createLanguageModelFromSecretConfig: (...args: unknown[]) =>
    createLanguageModelFromSecretConfigMock(...args),
}))

describe('reprocessAssistantMessageForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveActiveLlmConfigForUserMock.mockResolvedValue({
      status: 'resolved',
      config: {
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-5.5',
      },
    })
    createLanguageModelFromSecretConfigMock.mockResolvedValue({ id: 'model' })
    streamTextMock.mockResolvedValue({
      textStream: (async function* () {
        yield 'new '
        yield 'response'
      })(),
    })
  })

  it('applies the utility output ceiling to reprocessing', async () => {
    const supabase = createSupabaseMock({
      tables: {
        messages: {
          rows: [
            {
              id: 'message-1',
              chat_id: 'chat-1',
              role: 'assistant',
              content: 'old response',
              content_en: 'old translation',
              user_id: 'user-1',
            },
          ],
          primaryKeys: ['id'],
        },
        profiles: {
          rows: [
            {
              id: 'user-1',
              reprocess_prompt: 'Rewrite this response',
              reprocess_api_key_id: 'key-1',
              reprocess_model_name: 'gpt-5.5',
            },
          ],
        },
        api_keys: {
          rows: [{ id: 'key-1', last_used_at: null }],
          primaryKeys: ['id'],
        },
      },
    })
    const { reprocessAssistantMessageForUser } = await import('./reprocess-service')

    const result = await reprocessAssistantMessageForUser({
      supabase: supabase as never,
      getAdminClient: () => createSupabaseMock() as never,
      userId: 'user-1',
      messageId: 'message-1',
    })

    expect(result).toEqual({ status: 'success', content: 'new response' })
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: LLM_OUTPUT_LIMITS.utility }),
    )
  })
})
