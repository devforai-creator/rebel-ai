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
  personas,
  chats,
  chatGenerationJobs,
}: {
  user: { id: string } | null
  personas?: Array<Record<string, unknown>>
  chats?: Array<Record<string, unknown>>
  chatGenerationJobs?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      personas: {
        rows: personas ?? [],
        primaryKeys: ['id'],
      },
      chats: {
        rows: chats ?? [],
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

describe('persona actions', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('returns unauthorized when updating without a session', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { updatePersona } = await import('./actions')

    await expect(updatePersona('persona-1', { name: 'New Name' })).resolves.toEqual({
      error: 'Unauthorized',
    })
  })

  it('returns the shared validation error when nothing is provided', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        personas: [{ id: 'persona-1', user_id: 'user-1', name: 'Old', description: 'Desc' }],
      }),
    )
    const { updatePersona } = await import('./actions')

    await expect(updatePersona('persona-1', {})).resolves.toEqual({
      error: 'Nothing to update',
    })
  })

  it('returns not found when the persona is not owned by the user', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        personas: [{ id: 'persona-1', user_id: 'user-2', name: 'Other', description: null }],
      }),
    )
    const { updatePersona } = await import('./actions')

    await expect(updatePersona('persona-1', { name: 'New Name' })).resolves.toEqual({
      error: 'Persona not found',
    })
  })

  it('updates the persona through the shared server-side path', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      personas: [{ id: 'persona-1', user_id: 'user-1', name: 'Old', description: 'Desc' }],
      chats: [{ id: 'chat-1', user_id: 'user-1', persona_id: 'persona-1' }],
      chatGenerationJobs: [
        {
          id: 'job-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          status: 'completed',
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updatePersona } = await import('./actions')

    await expect(
      updatePersona('persona-1', { name: '  New Name  ', description: '   ' }),
    ).resolves.toEqual({
      persona: {
        id: 'persona-1',
        name: 'New Name',
        description: null,
      },
    })
    expect(supabase.state.personas).toEqual([
      { id: 'persona-1', user_id: 'user-1', name: 'New Name', description: null },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/personas')
  })

  it('blocks persona updates while a linked chat has an active response', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      personas: [{ id: 'persona-1', user_id: 'user-1', name: 'Old', description: 'Desc' }],
      chats: [{ id: 'chat-1', user_id: 'user-1', persona_id: 'persona-1' }],
      chatGenerationJobs: [
        {
          id: 'job-1',
          chat_id: 'chat-1',
          user_id: 'user-1',
          status: 'pending',
        },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updatePersona } = await import('./actions')

    await expect(updatePersona('persona-1', { name: 'New Name' })).resolves.toEqual({
      error: 'Wait for active chat responses to finish before changing this persona.',
    })
    expect(supabase.state.personas).toEqual([
      { id: 'persona-1', user_id: 'user-1', name: 'Old', description: 'Desc' },
    ])
  })

  it('returns unauthorized when deleting without a session', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { deletePersona } = await import('./actions')

    await expect(deletePersona('persona-1')).resolves.toEqual({
      error: 'Unauthorized',
    })
  })

  it('returns not found when deleting a persona that is not owned by the user', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        user: { id: 'user-1' },
        personas: [{ id: 'persona-1', user_id: 'user-2', name: 'Other', description: null }],
      }),
    )
    const { deletePersona } = await import('./actions')

    await expect(deletePersona('persona-1')).resolves.toEqual({
      error: 'Persona not found or you do not have permission',
    })
  })

  it('deletes an owned persona through the shared ownership path', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      personas: [{ id: 'persona-1', user_id: 'user-1', name: 'Old', description: 'Desc' }],
    })
    createClientMock.mockResolvedValue(supabase)
    const { deletePersona } = await import('./actions')

    await expect(deletePersona('persona-1')).resolves.toEqual({
      success: true,
    })
    expect(supabase.state.personas).toEqual([])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/personas')
  })

  it('blocks persona deletion while a linked chat has an active response', async () => {
    const supabase = buildSupabase({
      user: { id: 'user-1' },
      personas: [{ id: 'persona-1', user_id: 'user-1', name: 'Old', description: 'Desc' }],
      chats: [{ id: 'chat-1', user_id: 'user-1', persona_id: 'persona-1' }],
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
    const { deletePersona } = await import('./actions')

    await expect(deletePersona('persona-1')).resolves.toEqual({
      error: 'Wait for active chat responses to finish before changing this persona.',
    })
    expect(supabase.state.personas).toHaveLength(1)
  })
})
