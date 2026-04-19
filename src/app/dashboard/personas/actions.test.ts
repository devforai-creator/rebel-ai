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
}: {
  user: { id: string } | null
  personas?: Array<Record<string, unknown>>
}) {
  const supabase = createSupabaseMock({
    tables: {
      personas: {
        rows: personas ?? [],
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
})
