import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const redirectMock = vi.fn()
const revalidatePathMock = vi.fn()
const validateModuleOwnershipMock = vi.fn()
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

vi.mock('@/lib/modules/ownership', () => ({
  validateModuleOwnership: (...args: unknown[]) => validateModuleOwnershipMock(...args),
}))

type DbError = { message: string; code?: string }

type CharacterRow = {
  id: string
  user_id: string
  name: string
  description: string
  system_prompt: unknown
  greeting_message: unknown
  visibility?: string
}

type CharacterModuleRow = {
  character_id: string
  module_id: string
  enabled: boolean
  priority: number
}

type CharactersSupabaseOptions = {
  user?: { id: string } | null
  createCharacterError?: DbError | null
  updateCharacterError?: DbError | null
  deleteCharacterError?: DbError | null
  insertCharacterModulesError?: DbError | null
  deleteCharacterModulesError?: DbError | null
  createCharacterId?: string
  characters?: CharacterRow[]
  characterModules?: CharacterModuleRow[]
}

type MutationCall = {
  payload?: Record<string, unknown>
  filters: Array<[string, unknown]>
}

function buildCharacterFormData(overrides?: {
  system_prompt?: string
  greeting_message?: string
  module_ids?: string
  omitGreetingMessage?: boolean
  omitModuleIds?: boolean
}) {
  const formData = new FormData()
  formData.set('name', 'Test Character')
  formData.set('description', 'Test description')
  formData.set('system_prompt', overrides?.system_prompt ?? 'Plain prompt')

  if (!overrides?.omitGreetingMessage) {
    formData.set('greeting_message', overrides?.greeting_message ?? 'Hello there')
  }

  if (!overrides?.omitModuleIds) {
    formData.set('module_ids', overrides?.module_ids ?? '')
  }

  return formData
}

function createThenableMutation(
  commit: (
    filters: Array<[string, unknown]>,
  ) => { error: DbError | null } | Promise<{ error: DbError | null }>,
) {
  const filters: Array<[string, unknown]> = []
  let settled = false

  const builder = {
    eq(field: string, value: unknown) {
      filters.push([field, value])
      return builder
    },
    then<TResult1 = { error: DbError | null }, TResult2 = never>(
      onfulfilled?: ((value: { error: DbError | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (settled) {
        return Promise.resolve({ error: null }).then(onfulfilled, onrejected)
      }

      settled = true
      return Promise.resolve(commit([...filters])).then(onfulfilled, onrejected)
    },
  }

  return builder
}

function matchesFilters(row: Record<string, unknown>, filters: Array<[string, unknown]>) {
  return filters.every(([field, value]) => row[field] === value)
}

function buildSupabase(options: CharactersSupabaseOptions = {}) {
  const user = options.user === undefined ? { id: 'user-1' } : options.user
  const userId = user?.id ?? 'user-1'

  const state = {
    characters: options.characters?.map((row) => ({ ...row })) ?? [
      {
        id: 'char-1',
        user_id: userId,
        name: 'Existing Character',
        description: 'Existing description',
        system_prompt: 'Existing prompt',
        greeting_message: 'Existing hello',
        visibility: 'private',
      },
    ],
    characterModules: options.characterModules?.map((row) => ({ ...row })) ?? [],
    characterInsertPayloads: [] as Array<Record<string, unknown>>,
    characterUpdateCalls: [] as MutationCall[],
    characterDeleteCalls: [] as MutationCall[],
    characterModuleInsertPayloads: [] as CharacterModuleRow[][],
    characterModuleDeleteCalls: [] as MutationCall[],
  }

  return {
    state,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
    from(table: string) {
      if (table === 'characters') {
        return {
          insert(payload: Record<string, unknown>) {
            state.characterInsertPayloads.push(payload)
            return {
              select() {
                return {
                  async single() {
                    if (options.createCharacterError) {
                      return { data: null, error: options.createCharacterError }
                    }

                    const character = {
                      id: options.createCharacterId ?? 'char-created',
                      ...payload,
                    } as CharacterRow
                    state.characters.push(character)
                    return { data: character, error: null }
                  },
                }
              },
            }
          },
          update(payload: Record<string, unknown>) {
            return createThenableMutation((filters) => {
              state.characterUpdateCalls.push({ payload, filters })

              if (options.updateCharacterError) {
                return { error: options.updateCharacterError }
              }

              for (const row of state.characters) {
                if (matchesFilters(row, filters)) {
                  Object.assign(row, payload)
                }
              }

              return { error: null }
            })
          },
          delete() {
            return createThenableMutation((filters) => {
              state.characterDeleteCalls.push({ filters })

              if (options.deleteCharacterError) {
                return { error: options.deleteCharacterError }
              }

              state.characters = state.characters.filter((row) => !matchesFilters(row, filters))
              return { error: null }
            })
          },
        }
      }

      if (table === 'character_modules') {
        return {
          insert(payload: CharacterModuleRow[]) {
            state.characterModuleInsertPayloads.push(payload)
            if (options.insertCharacterModulesError) {
              return Promise.resolve({ error: options.insertCharacterModulesError })
            }

            state.characterModules.push(...payload)
            return Promise.resolve({ error: null })
          },
          delete() {
            return createThenableMutation((filters) => {
              state.characterModuleDeleteCalls.push({ filters })

              if (options.deleteCharacterModulesError) {
                return { error: options.deleteCharacterModulesError }
              }

              state.characterModules = state.characterModules.filter(
                (row) => !matchesFilters(row, filters),
              )
              return { error: null }
            })
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

describe('character actions template syntax handling', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    redirectMock.mockReset()
    revalidatePathMock.mockReset()
    validateModuleOwnershipMock.mockReset()
    consoleErrorSpy.mockClear()
    validateModuleOwnershipMock.mockResolvedValue({ validIds: [], invalidIds: [] })
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it('allows template syntax in system prompts on create', async () => {
    const supabase = buildSupabase({ createCharacterId: 'char-tpl' })
    createClientMock.mockResolvedValue(supabase)
    const { createCharacter } = await import('./actions')

    const result = await createCharacter(
      buildCharacterFormData({
        system_prompt: 'You are {{char}}.',
      }),
    )

    expect(result).toBeUndefined()
    expect(supabase.state.characterInsertPayloads).toHaveLength(1)
    expect(supabase.state.characterInsertPayloads[0].system_prompt).toBe('You are {{char}}.')
  })

  it('returns login required on create when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { createCharacter } = await import('./actions')

    const result = await createCharacter(buildCharacterFormData())

    expect(result).toEqual({ error: 'Login required' })
    expect(validateModuleOwnershipMock).not.toHaveBeenCalled()
  })

  it('returns a validation error when the create payload is missing required fields', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { createCharacter } = await import('./actions')

    const formData = buildCharacterFormData()
    formData.delete('name')

    const result = await createCharacter(formData)

    expect(result).toEqual({ error: 'Character name is required.' })
    expect(validateModuleOwnershipMock).not.toHaveBeenCalled()
    expect(supabase.state.characterInsertPayloads).toHaveLength(0)
  })

  it('rejects unauthorized module selections on create', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    validateModuleOwnershipMock.mockResolvedValue({
      validIds: ['mod-1'],
      invalidIds: ['mod-2'],
    })
    const { createCharacter } = await import('./actions')

    const result = await createCharacter(
      buildCharacterFormData({
        module_ids: ' mod-1 , , mod-2 ',
      }),
    )

    expect(result).toEqual({
      error: 'You do not have permission for some of the selected modules.',
    })
    expect(validateModuleOwnershipMock).toHaveBeenCalledWith(supabase, 'user-1', ['mod-1', 'mod-2'])
    expect(supabase.state.characterInsertPayloads).toHaveLength(0)
  })

  it('returns a friendly error when character creation fails', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        createCharacterError: { message: 'insert failed', code: '23505' },
      }),
    )
    const { createCharacter } = await import('./actions')

    const result = await createCharacter(buildCharacterFormData())

    expect(result).toEqual({
      error: 'Failed to create character. Please try again.',
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character] Failed to create character',
      expect.objectContaining({
        userId: 'user-1',
        error: 'insert failed',
        code: '23505',
      }),
    )
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('rolls back the character when module linking fails during create', async () => {
    const supabase = buildSupabase({
      createCharacterId: 'char-new',
      insertCharacterModulesError: { message: 'link failed' },
    })
    createClientMock.mockResolvedValue(supabase)
    validateModuleOwnershipMock.mockResolvedValue({
      validIds: ['mod-1', 'mod-2'],
      invalidIds: [],
    })
    const { createCharacter } = await import('./actions')

    const result = await createCharacter(
      buildCharacterFormData({
        module_ids: 'mod-1,mod-2',
      }),
    )

    expect(result).toEqual({
      error: 'Failed to link modules. Please try again.',
    })
    expect(supabase.state.characterModuleInsertPayloads).toEqual([
      [
        { character_id: 'char-new', module_id: 'mod-1', enabled: true, priority: 2 },
        { character_id: 'char-new', module_id: 'mod-2', enabled: true, priority: 1 },
      ],
    ])
    expect(supabase.state.characterDeleteCalls).toEqual([
      {
        filters: [['id', 'char-new']],
      },
    ])
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('creates a character without modules, revalidates, and redirects', async () => {
    const supabase = buildSupabase({
      createCharacterId: 'char-created',
    })
    createClientMock.mockResolvedValue(supabase)
    const { createCharacter } = await import('./actions')

    const formData = buildCharacterFormData({
      omitGreetingMessage: true,
      omitModuleIds: true,
    })

    const result = await createCharacter(formData)

    expect(result).toBeUndefined()
    expect(validateModuleOwnershipMock).not.toHaveBeenCalled()
    expect(supabase.state.characterInsertPayloads).toEqual([
      {
        user_id: 'user-1',
        name: 'Test Character',
        description: 'Test description',
        system_prompt: 'Plain prompt',
        greeting_message: null,
        visibility: 'private',
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/characters')
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/characters/char-created')
  })

  it('creates a character with authorized modules and allows whitespace-only text fields', async () => {
    const supabase = buildSupabase({
      createCharacterId: 'char-modules',
    })
    createClientMock.mockResolvedValue(supabase)
    validateModuleOwnershipMock.mockResolvedValue({
      validIds: ['mod-1'],
      invalidIds: [],
    })
    const { createCharacter } = await import('./actions')

    const result = await createCharacter(
      buildCharacterFormData({
        system_prompt: '   ',
        greeting_message: '   ',
        module_ids: 'mod-1',
      }),
    )

    expect(result).toBeUndefined()
    expect(supabase.state.characterModuleInsertPayloads).toEqual([
      [{ character_id: 'char-modules', module_id: 'mod-1', enabled: true, priority: 1 }],
    ])
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/characters/char-modules')
  })

  it('allows template syntax in greeting messages on update', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { updateCharacter } = await import('./actions')

    const result = await updateCharacter(
      'char-1',
      buildCharacterFormData({
        greeting_message: 'Hello {{user}}',
      }),
    )

    expect(result).toBeUndefined()
    expect(supabase.state.characterUpdateCalls).toHaveLength(1)
    expect(supabase.state.characterUpdateCalls[0].payload?.greeting_message).toBe('Hello {{user}}')
  })

  it('returns login required on update when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { updateCharacter } = await import('./actions')

    const result = await updateCharacter('char-1', buildCharacterFormData())

    expect(result).toEqual({ error: 'Login required' })
  })

  it('returns a validation error when the update payload is missing required fields', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { updateCharacter } = await import('./actions')

    const formData = buildCharacterFormData()
    formData.delete('system_prompt')

    const result = await updateCharacter('char-1', formData)

    expect(result).toEqual({ error: 'System prompt is required.' })
    expect(supabase.state.characterUpdateCalls).toHaveLength(0)
  })

  it('rejects unauthorized module selections on update', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    validateModuleOwnershipMock.mockResolvedValue({
      validIds: [],
      invalidIds: ['mod-2'],
    })
    const { updateCharacter } = await import('./actions')

    const result = await updateCharacter(
      'char-1',
      buildCharacterFormData({
        module_ids: 'mod-2',
      }),
    )

    expect(result).toEqual({
      error: 'You do not have permission for some of the selected modules.',
    })
    expect(supabase.state.characterUpdateCalls).toHaveLength(0)
  })

  it('returns a friendly error when character update fails', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        updateCharacterError: { message: 'update failed', code: '23503' },
      }),
    )
    const { updateCharacter } = await import('./actions')

    const result = await updateCharacter('char-1', buildCharacterFormData())

    expect(result).toEqual({
      error: 'Failed to update character. Please try again.',
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character] Failed to update character',
      expect.objectContaining({
        characterId: 'char-1',
        userId: 'user-1',
        error: 'update failed',
        code: '23503',
      }),
    )
  })

  it('returns a module-link error when update relinking fails', async () => {
    const supabase = buildSupabase({
      characterModules: [
        { character_id: 'char-1', module_id: 'old-mod', enabled: true, priority: 1 },
      ],
      insertCharacterModulesError: { message: 'insert failed' },
    })
    createClientMock.mockResolvedValue(supabase)
    validateModuleOwnershipMock.mockResolvedValue({
      validIds: ['mod-1'],
      invalidIds: [],
    })
    const { updateCharacter } = await import('./actions')

    const result = await updateCharacter(
      'char-1',
      buildCharacterFormData({
        module_ids: 'mod-1',
      }),
    )

    expect(result).toEqual({
      error: 'An error occurred while linking modules. Please try again later.',
    })
    expect(supabase.state.characterModuleDeleteCalls).toEqual([
      {
        filters: [['character_id', 'char-1']],
      },
    ])
    expect(supabase.state.characterModuleInsertPayloads).toEqual([
      [{ character_id: 'char-1', module_id: 'mod-1', enabled: true, priority: 1 }],
    ])
  })

  it('updates a character, relinks modules, revalidates, and redirects', async () => {
    const supabase = buildSupabase({
      characterModules: [
        { character_id: 'char-1', module_id: 'old-mod', enabled: true, priority: 1 },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    validateModuleOwnershipMock.mockResolvedValue({
      validIds: ['mod-3', 'mod-1'],
      invalidIds: [],
    })
    const { updateCharacter } = await import('./actions')

    const result = await updateCharacter(
      'char-1',
      buildCharacterFormData({
        module_ids: 'mod-3,mod-1',
      }),
    )

    expect(result).toBeUndefined()
    expect(supabase.state.characterUpdateCalls).toEqual([
      {
        payload: {
          name: 'Test Character',
          description: 'Test description',
          system_prompt: 'Plain prompt',
          greeting_message: 'Hello there',
        },
        filters: [
          ['id', 'char-1'],
          ['user_id', 'user-1'],
        ],
      },
    ])
    expect(supabase.state.characterModuleInsertPayloads).toEqual([
      [
        { character_id: 'char-1', module_id: 'mod-3', enabled: true, priority: 2 },
        { character_id: 'char-1', module_id: 'mod-1', enabled: true, priority: 1 },
      ],
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/characters')
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/characters/char-1')
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/characters/char-1')
  })

  it('updates a character without relinking when no module ids are supplied', async () => {
    const supabase = buildSupabase({
      characterModules: [
        { character_id: 'char-1', module_id: 'old-mod', enabled: true, priority: 1 },
      ],
    })
    createClientMock.mockResolvedValue(supabase)
    const { updateCharacter } = await import('./actions')

    const result = await updateCharacter(
      'char-1',
      buildCharacterFormData({
        omitModuleIds: true,
      }),
    )

    expect(result).toBeUndefined()
    expect(validateModuleOwnershipMock).not.toHaveBeenCalled()
    expect(supabase.state.characterModuleDeleteCalls).toEqual([
      {
        filters: [['character_id', 'char-1']],
      },
    ])
    expect(supabase.state.characterModuleInsertPayloads).toHaveLength(0)
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/characters/char-1')
  })

  it('returns login required on delete when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { deleteCharacter } = await import('./actions')

    const result = await deleteCharacter('char-1')

    expect(result).toEqual({ error: 'Login required' })
  })

  it('returns a friendly error when delete fails', async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        deleteCharacterError: { message: 'delete failed', code: '23503' },
      }),
    )
    const { deleteCharacter } = await import('./actions')

    const result = await deleteCharacter('char-1')

    expect(result).toEqual({
      error: 'Failed to delete character. Please try again.',
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character] Failed to delete character',
      expect.objectContaining({
        characterId: 'char-1',
        userId: 'user-1',
        error: 'delete failed',
        code: '23503',
      }),
    )
  })

  it('deletes a character successfully and revalidates the list', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { deleteCharacter } = await import('./actions')

    const result = await deleteCharacter('char-1')

    expect(result).toEqual({ success: true })
    expect(supabase.state.characterDeleteCalls).toEqual([
      {
        filters: [
          ['id', 'char-1'],
          ['user_id', 'user-1'],
        ],
      },
    ])
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard/characters')
  })
})
