import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { updateUserDraftModelSettings } from './user-draft-settings-actions'
const mocks = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
const initialState = { error: null, success: false }
const googleForm = {
  user_draft_api_key_id: 'key-1',
  user_draft_model_name: 'gemini-4-argon',
  user_draft_reasoning_effort: 'low',
  user_draft_service_tier: 'flex',
}
function form(values: Record<string, string> = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
function setup({ owner = 'user-1', active = true, provider = 'google', signedIn = true } = {}) {
  const db = createSupabaseMock({
    tables: {
      profiles: {
        rows: [
          { id: 'user-1', user_draft_model_config: { old: true } },
          { id: 'other', user_draft_model_config: null },
        ],
      },
      api_keys: {
        rows: [
          {
            id: 'key-1',
            user_id: owner,
            provider,
            is_active: active,
            model_preference: 'gemini-4-argon',
            service_tier: 'standard',
            vault_secret_name: 'not-a-secret',
          },
        ],
      },
    },
  })
  mocks.client.mockResolvedValue({
    ...db,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: signedIn ? { id: 'user-1' } : null } }),
    },
  })
  return db
}
beforeEach(() => vi.clearAllMocks())
describe('updateUserDraftModelSettings', () => {
  it.each(['standard', 'flex', ''] as const)(
    'saves or clears a dedicated OpenAI tier (%s) without changing the key',
    async (tier) => {
      const db = setup({ provider: 'openai' })
      const before = JSON.stringify(db.state.apiKeys)
      const result = await updateUserDraftModelSettings(
        initialState,
        form({ ...googleForm, user_draft_model_name: 'gpt-6-luna', user_draft_service_tier: tier }),
      )
      expect(result.success).toBe(true)
      expect((db.state.profiles as Record<string, unknown>[])[0].user_draft_model_config).toEqual({
        apiKeyId: 'key-1',
        modelName: 'gpt-6-luna',
        reasoningEffort: 'low',
        ...(tier ? { serviceTier: tier } : {}),
      })
      expect(JSON.stringify(db.state.apiKeys)).toBe(before)
    },
  )
  it('saves independent cloud settings on only the authenticated profile', async () => {
    const db = setup()
    expect(await updateUserDraftModelSettings(initialState, form(googleForm))).toEqual({
      error: null,
      success: true,
    })
    expect(db.state.profiles).toEqual([
      {
        id: 'user-1',
        user_draft_model_config: {
          apiKeyId: 'key-1',
          modelName: 'gemini-4-argon',
          reasoningEffort: 'low',
          serviceTier: 'flex',
        },
      },
      { id: 'other', user_draft_model_config: null },
    ])
    expect(mocks.revalidate).toHaveBeenCalledWith('/dashboard/chats/[id]', 'page')
  })
  it('clears the dedicated configuration to follow the chat settings', async () => {
    const db = setup()
    expect(await updateUserDraftModelSettings(initialState, form())).toEqual({
      error: null,
      success: true,
    })
    expect((db.state.profiles as Record<string, unknown>[])[0].user_draft_model_config).toBeNull()
  })
  it.each([
    { owner: 'other' },
    { active: false },
    { provider: 'local' },
    { provider: 'voyage_embeddings' },
  ])('rejects inaccessible or unsupported credentials: %j', async (options) => {
    const db = setup(options)
    expect((await updateUserDraftModelSettings(initialState, form(googleForm))).success).toBe(false)
    expect((db.state.profiles as Record<string, unknown>[])[0].user_draft_model_config).toEqual({
      old: true,
    })
  })
  it.each([
    { user_draft_api_key_id: 'key-1' },
    { ...googleForm, user_draft_model_name: 'gpt-5.4' },
    { ...googleForm, user_draft_reasoning_effort: 'max' },
    { ...googleForm, user_draft_service_tier: 'priority' },
  ])('rejects invalid models or capabilities without saving: %j', async (values) => {
    const db = setup()
    expect((await updateUserDraftModelSettings(initialState, form(values))).success).toBe(false)
    expect((db.state.profiles as Record<string, unknown>[])[0].user_draft_model_config).toEqual({
      old: true,
    })
  })
  it('requires authentication', async () => {
    setup({ signedIn: false })
    expect((await updateUserDraftModelSettings(initialState, form(googleForm))).success).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
