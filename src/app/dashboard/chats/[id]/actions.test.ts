import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'

const createClientMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

function buildSupabase({
  user,
  chats,
  personas,
  chatGenerationJobs,
}: {
  user: { id: string } | null
  chats?: Array<Record<string, unknown>>
  personas?: Array<Record<string, unknown>>
  chatGenerationJobs?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      chats: {
        rows: chats ?? [],
        primaryKeys: ['id'],
      },
      personas: {
        rows: personas ?? [],
        primaryKeys: ['id'],
      },
      chat_generation_jobs: {
        rows: chatGenerationJobs ?? [],
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

function getChatRows(supabase: ReturnType<typeof buildSupabase>) {
  return supabase.state.chats as Array<Record<string, unknown>>
}

describe('chat actions', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('returns login required when updating persona without a session', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { updateChatPersona } = await import('./actions')

    await expect(updateChatPersona('chat-1', 'persona-1')).resolves.toEqual({
      error: 'Login required',
    })
  })

  it('updates the chat persona after ownership checks pass', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', persona_id: null, model_config: null }],
      personas: [{ id: 'persona-1', user_id: 'user-1', name: 'Scout' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatPersona } = await import('./actions')

    await expect(updateChatPersona('chat-1', 'persona-1')).resolves.toEqual({ success: true })
    expect(getChatRows(supabase)).toEqual([
      {
        id: 'chat-1',
        user_id: 'user-1',
        persona_id: 'persona-1',
        model_config: null,
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })

  it('returns persona access error when the persona is not owned by the user', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', persona_id: null }],
      personas: [{ id: 'persona-1', user_id: 'user-2', name: 'Other' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatPersona } = await import('./actions')

    await expect(updateChatPersona('chat-1', 'persona-1')).resolves.toEqual({
      error: 'Persona not found or access denied',
    })
  })

  it('unsets the chat persona', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', persona_id: 'persona-1' }],
      personas: [{ id: 'persona-1', user_id: 'user-1', name: 'Scout' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatPersona } = await import('./actions')

    await expect(updateChatPersona('chat-1', null)).resolves.toEqual({ success: true })
    expect(getChatRows(supabase)[0]).toMatchObject({
      id: 'chat-1',
      persona_id: null,
    })
  })

  it('blocks persona changes while the chat has an active response', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', persona_id: 'persona-1' }],
      personas: [
        { id: 'persona-1', user_id: 'user-1', name: 'Scout' },
        { id: 'persona-2', user_id: 'user-1', name: 'Guide' },
      ],
      chatGenerationJobs: [
        {
          id: 'job-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          status: 'processing',
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatPersona } = await import('./actions')

    await expect(updateChatPersona('chat-1', 'persona-2')).resolves.toEqual({
      error: 'Wait for the current response to finish before changing personas.',
    })
    expect(getChatRows(supabase)[0]).toMatchObject({
      id: 'chat-1',
      persona_id: 'persona-1',
    })
  })

  it('stores null model_config when the normalized config is not persistable', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [
        { id: 'chat-1', user_id: 'user-1', model_config: { memory: { mode: 'summary_window' } } },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatModelConfig } = await import('./actions')

    await expect(updateChatModelConfig('chat-1', {})).resolves.toEqual({ success: true })
    expect(getChatRows(supabase)[0]).toMatchObject({
      id: 'chat-1',
      model_config: null,
    })
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/chats/chat-1')
  })

  it('normalizes and persists non-default model config', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [{ id: 'chat-1', user_id: 'user-1', model_config: null }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatModelConfig } = await import('./actions')

    const input = {
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'primary-key',
        secondaryApiKeyId: 'secondary-key',
      },
      memory: {
        mode: 'prefix_live_blocks',
        sealEveryMessages: 12.7,
        retainTailMessages: 5.2,
      },
    }

    await expect(updateChatModelConfig('chat-1', input)).resolves.toEqual({ success: true })
    const persistedModelConfig = getChatRows(supabase)[0].model_config as Record<string, unknown>

    expect(getChatRows(supabase)[0]).toMatchObject({
      id: 'chat-1',
      model_config: {
        alternateModels: {
          enabled: true,
          primaryApiKeyId: 'primary-key',
          secondaryApiKeyId: 'secondary-key',
        },
        memory: {
          mode: 'prefix_live_blocks',
          retainTailMessages: 5,
        },
      },
    })
    expect((persistedModelConfig.memory as Record<string, unknown>) ?? {}).not.toHaveProperty(
      'sealEveryMessages',
    )
  })

  it('preserves existing experimental config when callers update other model settings', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          model_config: {
            experimental: {
              agenticTranscriptRecall: {
                enabled: true,
                maxToolCalls: 1,
              },
            },
          },
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatModelConfig } = await import('./actions')

    await expect(
      updateChatModelConfig('chat-1', {
        memory: {
          mode: 'prefix_live_blocks',
        },
      }),
    ).resolves.toEqual({ success: true })

    const persistedModelConfig = getChatRows(supabase)[0].model_config as Record<string, unknown>

    expect(getChatRows(supabase)[0]).toMatchObject({
      id: 'chat-1',
      model_config: {
        memory: {
          mode: 'prefix_live_blocks',
        },
        experimental: {
          agenticTranscriptRecall: {
            enabled: true,
            maxToolCalls: 1,
          },
        },
      },
    })
    expect((persistedModelConfig.memory as Record<string, unknown>) ?? {}).not.toHaveProperty(
      'sealEveryMessages',
    )
  })

  it('persists an explicit ATR off override when callers set it directly', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          model_config: {
            alternateModels: {
              enabled: false,
              primaryApiKeyId: 'primary-key',
              primaryModelName: 'gpt-5.5',
              secondaryApiKeyId: null,
              secondaryModelName: null,
            },
            memory: {
              mode: 'prefix_live_blocks',
            },
          },
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatModelConfig } = await import('./actions')

    await expect(
      updateChatModelConfig('chat-1', {
        experimental: {
          agenticTranscriptRecall: {
            enabled: false,
          },
        },
      }),
    ).resolves.toEqual({ success: true })

    expect(getChatRows(supabase)[0]).toMatchObject({
      id: 'chat-1',
      model_config: {
        alternateModels: {
          enabled: false,
          primaryApiKeyId: 'primary-key',
          primaryModelName: 'gpt-5.5',
          secondaryApiKeyId: null,
          secondaryModelName: null,
        },
        memory: {
          mode: 'prefix_live_blocks',
        },
        experimental: {
          agenticTranscriptRecall: {
            enabled: false,
          },
        },
      },
    })
  })

  it('drops an existing ATR override when callers explicitly reset experimental config to inherit', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      chats: [
        {
          id: 'chat-1',
          user_id: 'user-1',
          model_config: {
            memory: {
              mode: 'prefix_live_blocks',
            },
            experimental: {
              agenticTranscriptRecall: {
                enabled: true,
              },
            },
          },
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateChatModelConfig } = await import('./actions')

    await expect(
      updateChatModelConfig('chat-1', {
        experimental: {},
      }),
    ).resolves.toEqual({ success: true })

    expect(getChatRows(supabase)[0]).toMatchObject({
      id: 'chat-1',
      model_config: {
        memory: {
          mode: 'prefix_live_blocks',
        },
      },
    })
    expect(getChatRows(supabase)[0]).not.toHaveProperty('model_config.experimental')
  })
})
