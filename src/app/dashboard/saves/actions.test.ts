import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import {
  createCharacterSave,
  updateCharacterSave,
  deleteCharacterSave,
  updateChatSave,
} from './actions'

const getClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => getClient() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const saveId = '10000000-0000-4000-8000-000000000001'
const chatId = '20000000-0000-4000-8000-000000000001'
const characterId = '30000000-0000-4000-8000-000000000001'
const personaId = '40000000-0000-4000-8000-000000000001'
const input = {
  title: '  My story  ',
  content: '  Exact promise.\n\n',
  characterId,
  defaultPersonaId: personaId,
}

function setup({
  owner = 'me',
  authenticated = true,
  active = false,
  saveCharacter = characterId,
} = {}) {
  const client = createSupabaseMock({
    tables: {
      character_saves: {
        rows: [
          {
            id: saveId,
            user_id: owner,
            title: 'Old',
            content: 'Old canon',
            character_id: saveCharacter,
            default_persona_id: personaId,
          },
        ],
        transformInsert: (row) => ({ id: 'new-save', ...row }),
      },
      chats: { rows: [{ id: chatId, user_id: 'me', character_id: characterId, save_id: saveId }] },
      characters: { rows: [{ id: characterId }] },
      personas: { rows: [{ id: personaId, user_id: 'me' }] },
      chat_generation_jobs: {
        rows: active ? [{ id: 'job', chat_id: chatId, user_id: 'me', status: 'processing' }] : [],
      },
    },
  })
  Object.assign(client, {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authenticated ? { id: 'me' } : null } }),
    },
  })
  getClient.mockResolvedValue(client)
  return client
}

describe('save server actions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates creates and preserves the body verbatim', async () => {
    const client = setup()
    expect(await createCharacterSave(input)).toEqual({ saveId: 'new-save' })
    expect(client.state.characterSaves).toContainEqual(
      expect.objectContaining({ title: 'My story', content: input.content, user_id: 'me' }),
    )
    setup({ authenticated: false })
    expect(await createCharacterSave(input)).toHaveProperty('error')
  })

  it('rejects oversized bodies, blank titles, and foreign default personas', async () => {
    setup()
    expect(await createCharacterSave({ ...input, content: 'x'.repeat(20_001) })).toHaveProperty(
      'error',
    )
    expect(await createCharacterSave({ ...input, title: ' ' })).toHaveProperty('error')
    expect(await createCharacterSave({ ...input, defaultPersonaId: saveId })).toHaveProperty(
      'error',
    )
  })

  it('updates owned canon and permits unlinking', async () => {
    const client = setup()
    expect(await updateCharacterSave(saveId, { ...input, characterId: null })).toEqual({
      success: true,
    })
    expect(client.state.characterSaves).toEqual([
      expect.objectContaining({ content: input.content, character_id: null }),
    ])
  })

  it("blocks editing or deleting another owner's save", async () => {
    const client = setup({ owner: 'other' })
    expect(await updateCharacterSave(saveId, input)).toHaveProperty('error')
    expect(await deleteCharacterSave(saveId)).toHaveProperty('error')
    expect(client.state.characterSaves).toHaveLength(1)
  })

  it('blocks canon mutation while any attached chat has an active job', async () => {
    const client = setup({ active: true })
    expect(await updateCharacterSave(saveId, input)).toHaveProperty('error')
    expect(await deleteCharacterSave(saveId)).toHaveProperty('error')
    expect(client.state.characterSaves).toEqual([expect.objectContaining({ content: 'Old canon' })])
  })

  it('deletes owned idle saves', async () => {
    const client = setup()
    expect(await deleteCharacterSave(saveId)).toEqual({ success: true })
    expect(client.state.characterSaves).toEqual([])
  })

  it('detaches a save and rejects foreign or incompatible attachments', async () => {
    const client = setup()
    expect(await updateChatSave(chatId, null)).toEqual({ success: true })
    expect(client.state.chats).toEqual([expect.objectContaining({ save_id: null })])
    setup({ owner: 'other' })
    expect(await updateChatSave(chatId, null)).toEqual({ success: true })
    expect(await updateChatSave(chatId, saveId)).toHaveProperty('error')
    setup({ saveCharacter: personaId })
    expect(await updateChatSave(chatId, null)).toEqual({ success: true })
    expect(await updateChatSave(chatId, saveId)).toHaveProperty('error')
  })

  it('keeps attachments stable while a response is active', async () => {
    setup({ active: true })
    expect(await updateChatSave(chatId, null)).toHaveProperty('error')
  })
})
