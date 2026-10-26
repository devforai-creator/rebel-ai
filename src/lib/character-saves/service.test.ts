import { describe, expect, it } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { loadSaveForGeneration, verifySaveIsIdle, verifySaveLinks } from './service'

describe('live save context', () => {
  it('loads the latest owner-scoped content on each generation', async () => {
    const mock = createSupabaseMock({
      tables: { character_saves: { rows: [{ id: 'save', user_id: 'me', content: 'Before' }] } },
    })
    const args = { supabase: mock as unknown as SupabaseClientType, userId: 'me', saveId: 'save' }
    expect(await loadSaveForGeneration(args)).toEqual({ content: 'Before' })
    await mock.from('character_saves').update({ content: 'After' }).eq('id', 'save')
    expect(await loadSaveForGeneration(args)).toEqual({ content: 'After' })
    expect(await loadSaveForGeneration({ ...args, saveId: null })).toBeNull()
    await expect(loadSaveForGeneration({ ...args, userId: 'other' })).rejects.toThrow(
      'Failed to load',
    )
    await expect(loadSaveForGeneration({ ...args, saveId: 'missing' })).rejects.toThrow(
      'Failed to load',
    )
  })

  it('validates links and allows saves without links or attached chats', async () => {
    const mock = createSupabaseMock({
      tables: { characters: { rows: [] }, personas: { rows: [] }, chats: { rows: [] } },
    })
    const args = { supabase: mock as unknown as SupabaseClientType, userId: 'me' }
    expect(await verifySaveLinks(args)).toBeNull()
    expect(await verifySaveLinks({ ...args, characterId: 'missing' })).toBeTruthy()
    expect(await verifySaveLinks({ ...args, defaultPersonaId: 'missing' })).toBeTruthy()
    expect(await verifySaveIsIdle({ ...args, saveId: 'save' })).toBeNull()
  })
})
