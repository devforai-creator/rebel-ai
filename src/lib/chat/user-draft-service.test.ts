import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { LLM_OUTPUT_LIMITS } from '@/lib/llm/output-limits'
import { getDefaultModelForProvider } from '@/lib/models'
import { generateUserDraft, USER_DRAFT_SYSTEM_PROMPT } from './user-draft-service'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  model: vi.fn(),
  memory: vi.fn(),
  count: vi.fn(),
  tail: vi.fn(),
  summaryEnd: vi.fn(),
  lore: vi.fn(),
  renderLore: vi.fn(),
}))
vi.mock('ai', () => ({ generateText: mocks.generate }))
vi.mock('@/lib/llm/language-model-access', () => ({
  createLanguageModelFromSecretConfig: mocks.model,
}))
vi.mock('@/lib/chat-memory', () => ({ buildMemoryPlan: mocks.memory }))
vi.mock('@/lib/chat/turns', () => ({
  countProjectedConversationMessages: mocks.count,
  loadProjectedConversationTail: mocks.tail,
}))
vi.mock('@/lib/chat-summaries/db-helpers', () => ({ getLastSummaryEnd: mocks.summaryEnd }))
vi.mock('@/lib/lorebook/runtime', () => ({
  loadChatLorebookState: mocks.lore,
  renderLorebookContext: mocks.renderLore,
}))

const transcript = [
  { id: 'u1', role: 'user', content: '*지도를 펼친다.*' },
  { id: 'a1', role: 'assistant', content: '"어느 경로로 갈까요?"' },
]

function setup(
  options: {
    chatOwner?: string
    keyOwner?: string
    provider?: string
    modelName?: string
    legacyTier?: 'standard' | 'flex' | 'priority'
    modelConfig?: unknown
    personaId?: string | null
    missingCharacter?: boolean
    characterMetadata?: unknown
    draftModelConfig?: unknown
  } = {},
) {
  const client = createSupabaseMock({
    tables: {
      profiles: {
        rows: [{ id: 'user-1', user_draft_model_config: options.draftModelConfig ?? null }],
      },
      chats: {
        rows: [
          {
            id: 'chat-1',
            user_id: options.chatOwner ?? 'user-1',
            character_id: 'char-1',
            persona_id: options.personaId === undefined ? 'persona-1' : options.personaId,
            model_config: options.modelConfig ?? null,
          },
        ],
      },
      characters: {
        rows: options.missingCharacter
          ? []
          : [
              {
                id: 'char-1',
                name: 'Commander',
                system_prompt: 'Portray the commander.',
                metadata: options.characterMetadata ?? {
                  post_history_instructions: 'Never write the user character.',
                  unrelated_import_payload: 'Do not include the entire imported metadata.',
                },
              },
            ],
      },
      personas: {
        rows: [
          {
            id: 'persona-1',
            name: 'Scout',
            description: 'An experienced mountain scout.',
          },
        ],
      },
      api_keys: {
        rows: [
          {
            id: 'key-1',
            user_id: options.keyOwner ?? 'user-1',
            is_active: true,
            provider: options.provider ?? 'openai',
            model_preference: options.modelName ?? 'gpt-5.4',
            service_tier: options.legacyTier ?? 'standard',
            vault_secret_name: 'vault-1',
          },
        ],
      },
      messages: { rows: transcript.map((message) => ({ ...message })) },
      chat_generation_jobs: { rows: [] },
    },
  })
  const getAdminClient = vi.fn(() => client as unknown as SupabaseClientType)
  const signal = new AbortController().signal
  return {
    client,
    getAdminClient,
    args: {
      supabase: client as unknown as SupabaseClientType,
      getAdminClient,
      userId: 'user-1',
      chatId: 'chat-1',
      signal,
      request: { apiKeyId: 'key-1', modelName: options.modelName ?? 'gpt-5.4', instruction: '' },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.generate.mockResolvedValue({
    text: '  *안전한 능선길을 가리킨다.*  ',
    finishReason: 'stop',
  })
  mocks.model.mockResolvedValue({ id: 'model' })
  mocks.count.mockResolvedValue(2)
  mocks.tail.mockResolvedValue(transcript)
  mocks.summaryEnd.mockResolvedValue(0)
  mocks.lore.mockResolvedValue({ entries: [], overrideMap: new Map() })
  mocks.renderLore.mockReturnValue({
    combined: 'Mountain terrain',
    alwaysActive: null,
    conditional: null,
  })
  mocks.memory.mockImplementation(async ({ sanitizedMessages }) => ({
    dynamicContext: 'Previously agreed to avoid the river.',
    fallbackMessages: sanitizedMessages,
  }))
})

describe('generateUserDraft', () => {
  it.each([
    ['flex', 'standard', 'standard'],
    ['standard', 'flex', 'flex'],
    ['flex', undefined, 'flex'],
    ['priority', undefined, 'priority'],
  ] as const)(
    'applies dedicated OpenAI tier %s / %s independently of reply options',
    async (legacyTier, serviceTier, expected) => {
      const { args } = setup({
        modelName: 'gpt-6-luna',
        legacyTier,
        draftModelConfig: {
          apiKeyId: 'key-1',
          modelName: 'gpt-6-luna',
          reasoningEffort: 'low',
          serviceTier,
        },
        modelConfig: {
          serviceTiers: { 'openai:gpt-6-luna': expected === 'flex' ? 'standard' : 'flex' },
        },
      })
      await generateUserDraft({
        ...args,
        request: { ...args.request, serviceTier: expected === 'flex' ? 'standard' : 'flex' },
      })
      expect(mocks.model.mock.calls[0][0].config.serviceTier).toBe(expected)
      expect(mocks.generate.mock.calls[0][0].providerOptions.openai).toMatchObject({
        serviceTier: expected === 'standard' ? 'default' : expected,
        reasoningEffort: 'low',
      })
    },
  )

  it('inherits the reply model tier when the draft setting stays at its default', async () => {
    const { args } = setup({
      modelName: 'gpt-6-luna',
      legacyTier: 'flex',
      modelConfig: { serviceTiers: { 'openai:gpt-6-luna': 'standard' } },
    })
    await generateUserDraft(args)
    expect(mocks.model.mock.calls[0][0].config.serviceTier).toBe('standard')
  })

  it('uses the account draft model, reasoning and tier instead of the chat selection', async () => {
    const { args, client } = setup({
      draftModelConfig: {
        apiKeyId: 'draft-key',
        modelName: 'gemini-4-argon',
        reasoningEffort: 'low',
        serviceTier: 'flex',
      },
    })
    ;(client.state.apiKeys as Record<string, unknown>[]).push({
      id: 'draft-key',
      user_id: 'user-1',
      is_active: true,
      provider: 'google',
      model_preference: 'gemini-4-argon',
      service_tier: 'standard',
      vault_secret_name: 'draft-vault',
    })
    await generateUserDraft({ ...args, request: { ...args.request, reasoningEffort: 'high' } })
    expect(mocks.model).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          apiKeyId: 'draft-key',
          modelName: 'gemini-4-argon',
          provider: 'google',
        }),
      }),
    )
    expect(mocks.generate.mock.calls[0][0].providerOptions.google).toMatchObject({
      serviceTier: 'flex',
      thinkingConfig: { thinkingLevel: 'low' },
    })
  })

  it('keeps dedicated default reasoning and Standard independent of chat preferences', async () => {
    const { args } = setup({
      provider: 'google',
      modelName: 'gemini-4-argon',
      draftModelConfig: {
        apiKeyId: 'key-1',
        modelName: 'gemini-4-argon',
        reasoningEffort: 'default',
      },
      modelConfig: {
        reasoning: { 'google:gemini-4-argon': 'high' },
        serviceTiers: { 'google:gemini-4-argon': 'flex' },
      },
    })
    await generateUserDraft({
      ...args,
      request: { ...args.request, reasoningEffort: 'high', serviceTier: 'flex' },
    })
    const options = mocks.generate.mock.calls[0][0].providerOptions.google
    expect(options.serviceTier).toBe('standard')
    expect(options.thinkingConfig).toBeUndefined()
  })

  it('inherits chat reasoning and tier when no dedicated model is configured', async () => {
    const { args } = setup({ provider: 'google', modelName: 'gemini-4-argon' })
    await generateUserDraft({
      ...args,
      request: { ...args.request, reasoningEffort: 'high', serviceTier: 'flex' },
    })
    expect(mocks.generate.mock.calls[0][0].providerOptions.google).toMatchObject({
      serviceTier: 'flex',
      thinkingConfig: { thinkingLevel: 'high' },
    })
  })

  it.each([
    { apiKeyId: 'missing-key', modelName: 'gpt-5.4' },
    { apiKeyId: 'key-1', modelName: 'not-a-model' },
    { apiKeyId: 'key-1' },
  ])(
    'does not fall back to the chat model for an unavailable saved selection: %j',
    async (draftModelConfig) => {
      const { args } = setup({ draftModelConfig })
      await expect(generateUserDraft(args)).rejects.toBeInstanceOf(Error)
      expect(mocks.model).not.toHaveBeenCalled()
      expect(mocks.generate).not.toHaveBeenCalled()
    },
  )

  it('rechecks ownership of the dedicated credential', async () => {
    const { args } = setup({
      keyOwner: 'other',
      draftModelConfig: { apiKeyId: 'key-1', modelName: 'gpt-5.4' },
    })
    await expect(generateUserDraft(args)).rejects.toMatchObject({ status: 404 })
    expect(mocks.model).not.toHaveBeenCalled()
  })

  it('reads changed account settings for an already-open chat request', async () => {
    const { args, client } = setup()
    await generateUserDraft(args)
    ;(client.state.profiles as Record<string, unknown>[])[0].user_draft_model_config = {
      apiKeyId: 'key-1',
      modelName: 'gpt-5.5',
      reasoningEffort: 'low',
    }
    await generateUserDraft(args)
    expect(mocks.model.mock.calls[1][0].config.modelName).toBe('gpt-5.5')
    ;(client.state.profiles as Record<string, unknown>[])[0].user_draft_model_config = null
    await generateUserDraft(args)
    expect(mocks.model.mock.calls[2][0].config.modelName).toBe('gpt-5.4')
  })

  it('suggests a user reaction using persona, active history, memory and lore without persisting it', async () => {
    const { args, client, getAdminClient } = setup()
    const before = JSON.stringify(client.state)
    expect(await generateUserDraft(args)).toBe('*안전한 능선길을 가리킨다.*')
    const call = mocks.generate.mock.calls[0][0]
    expect(call.system).toBe(USER_DRAFT_SYSTEM_PROMPT)
    expect(call.system).not.toContain('You control EVERYTHING')
    expect(call.maxOutputTokens).toBe(LLM_OUTPUT_LIMITS.utility)
    expect(call.abortSignal).toBe(args.signal)
    const prompt = JSON.parse(call.prompt)
    expect(prompt.userPersona.name).toBe('Scout')
    expect(prompt.characterAndSetting.name).toBe('Commander')
    expect(prompt.characterAndSetting.post_history_instructions).toBe(
      'Never write the user character.',
    )
    expect(prompt.characterAndSetting).not.toHaveProperty('metadata')
    expect(call.prompt).not.toContain('unrelated_import_payload')
    expect(prompt.activeLore).toBe('Mountain terrain')
    expect(prompt.memory).toContain('avoid the river')
    expect(prompt.transcript).toEqual(transcript.map(({ role, content }) => ({ role, content })))
    expect(prompt.writingInstruction).toBeNull()
    expect(prompt.task).toContain('Suggest')
    expect(JSON.stringify(client.state)).toBe(before)
    expect(getAdminClient).toHaveBeenCalledTimes(1)
  })

  it('expands an intent separately from the persisted conversation', async () => {
    const { args } = setup()
    args.request.instruction = '  강을 건너지 않는 대안을 설명한다  '
    await generateUserDraft(args)
    const prompt = JSON.parse(mocks.generate.mock.calls[0][0].prompt)
    expect(prompt.writingInstruction).toBe('강을 건너지 않는 대안을 설명한다')
    expect(prompt.task).toContain('Expand')
    expect(prompt.transcript).toHaveLength(2)
    expect(mocks.renderLore.mock.calls[0][0].chatHistory.at(-1)).toEqual({
      role: 'user',
      content: '강을 건너지 않는 대안을 설명한다',
    })
  })

  it('reads the entire unsummarized tail for prefix memory', async () => {
    const { args } = setup({ modelConfig: { memory: { mode: 'prefix_live_blocks' } } })
    mocks.count.mockResolvedValue(80)
    mocks.summaryEnd.mockResolvedValue(30)
    mocks.tail.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({
        id: 'm' + index,
        role: 'user',
        content: 'message ' + index,
      })),
    )
    await generateUserDraft(args)
    expect(mocks.tail).toHaveBeenCalledWith(expect.objectContaining({ limitMessages: 50 }))
    expect(mocks.memory).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptCoverage: 'window',
        transcriptStartOrdinal: 31,
        totalConversationMessages: 80,
      }),
    )
  })

  it('works without a selected persona', async () => {
    const { args } = setup({ personaId: null })
    await generateUserDraft(args)
    expect(JSON.parse(mocks.generate.mock.calls[0][0].prompt).userPersona).toBeNull()
  })

  it.each([{}, 'legacy metadata', [], { post_history_instructions: 123 }])(
    'handles character metadata without text instructions: %j',
    async (characterMetadata) => {
      await generateUserDraft(setup({ characterMetadata }).args)
      expect(
        JSON.parse(mocks.generate.mock.calls[0][0].prompt).characterAndSetting
          .post_history_instructions,
      ).toBeNull()
    },
  )

  it.each(['google', 'anthropic', 'deepseek', 'openrouter'] as const)(
    'uses the existing cloud model factory for %s',
    async (provider) => {
      const modelName = getDefaultModelForProvider(provider)
      await generateUserDraft(setup({ provider, modelName }).args)
      expect(mocks.model).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.objectContaining({ provider, modelName }) }),
      )
      expect(mocks.generate).toHaveBeenCalledTimes(1)
    },
  )

  it('can suggest the first user reaction in an empty conversation', async () => {
    mocks.count.mockResolvedValue(0)
    mocks.tail.mockResolvedValue([])
    await generateUserDraft(setup({ personaId: null }).args)
    expect(JSON.parse(mocks.generate.mock.calls[0][0].prompt).transcript).toEqual([])
  })

  it('validates reasoning preferences before accessing the model', async () => {
    const { args } = setup()
    await expect(
      generateUserDraft({ ...args, request: { ...args.request, reasoningEffort: 'max' } }),
    ).rejects.toMatchObject({ status: 400 })
    expect(mocks.model).not.toHaveBeenCalled()
  })

  it.each([
    ['another user chat', { chatOwner: 'other' }, 404],
    ['another user API key', { keyOwner: 'other' }, 404],
    ['local model', { provider: 'local', modelName: 'local-rp-base' }, 400],
    ['unsupported model', { modelName: 'not-a-model' }, 400],
    ['unsupported provider', { provider: 'invalid' }, 400],
    ['missing character', { missingCharacter: true }, 500],
  ] as const)('rejects %s before decrypting or generating', async (_name, options, status) => {
    const { args, getAdminClient } = setup(options)
    await expect(generateUserDraft(args)).rejects.toMatchObject({ status })
    expect(getAdminClient).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('rejects a context above the input budget before decrypting', async () => {
    const { args } = setup()
    mocks.memory.mockResolvedValue({ dynamicContext: 'x'.repeat(650_000), fallbackMessages: [] })
    await expect(generateUserDraft(args)).rejects.toMatchObject({ status: 413 })
    expect(mocks.model).not.toHaveBeenCalled()
  })

  it.each([
    { text: '  ', finishReason: 'stop' },
    { text: 'an unfinished draft', finishReason: 'length' },
  ])('rejects empty or truncated output', async (result) => {
    mocks.generate.mockResolvedValue(result)
    await expect(generateUserDraft(setup().args)).rejects.toMatchObject({ status: 502 })
  })

  it('rejects incompatible service tier settings', async () => {
    const { args } = setup({ modelName: 'gpt-4.1' })
    await expect(
      generateUserDraft({
        ...args,
        request: { ...args.request, serviceTier: 'flex' },
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(mocks.model).not.toHaveBeenCalled()
  })

  it('forwards provider failures without saving a draft', async () => {
    const { args, client } = setup()
    const before = JSON.stringify(client.state)
    mocks.generate.mockRejectedValue(new Error('upstream failed'))
    await expect(generateUserDraft(args)).rejects.toThrow('upstream failed')
    expect(JSON.stringify(client.state)).toBe(before)
  })
})
