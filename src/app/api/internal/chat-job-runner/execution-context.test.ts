import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_DELIVERY_MODE_STREAMING } from '@/lib/chat/delivery-mode'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { CHAT_RUNNER_LIMITS } from '@/lib/chat/runtime-limits'
import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'

const buildMemoryPlanMock = vi.fn()
const loadGenerationTranscriptMock = vi.fn()
const applyBilingualContextMock = vi.fn()
const isBilingualEnabledMock = vi.fn()
const ensureUserFirstForAnthropicMock = vi.fn()
const buildLorebookDynamicContextMock = vi.fn()
const buildSystemPromptMock = vi.fn()
const decryptSecretMock = vi.fn()

vi.mock('@/lib/chat/anthropic-user-first', () => ({
  ensureUserFirstForAnthropic: (...args: unknown[]) => ensureUserFirstForAnthropicMock(...args),
}))

vi.mock('@/lib/chat-memory', () => ({
  buildMemoryPlan: (...args: unknown[]) => buildMemoryPlanMock(...args),
}))

vi.mock('@/lib/chat/global-system-prompt', () => ({
  getGlobalSystemPrompt: vi.fn(() => 'GLOBAL'),
}))

vi.mock('@/lib/chat/bilingual-context', () => ({
  applyBilingualContext: (...args: unknown[]) => applyBilingualContextMock(...args),
  isBilingualEnabled: (...args: unknown[]) => isBilingualEnabledMock(...args),
}))

vi.mock('@/lib/chat/model-config', () => ({
  normalizeChatModelConfig: vi.fn((config: unknown) => config ?? {}),
}))

vi.mock('@/lib/lorebook/runtime', () => ({
  buildLorebookDynamicContext: (...args: unknown[]) => buildLorebookDynamicContextMock(...args),
}))

vi.mock('@/lib/chat/turns', () => ({
  loadGenerationTranscript: (...args: unknown[]) => loadGenerationTranscriptMock(...args),
}))

vi.mock('./system-prompt-builder', () => ({
  buildSystemPrompt: (...args: unknown[]) => buildSystemPromptMock(...args),
}))

vi.mock('./vault', () => ({
  decryptSecret: (...args: unknown[]) => decryptSecretMock(...args),
}))

function buildValidPayload(
  overrides: Partial<ChatGenerationJobPayload> = {},
): ChatGenerationJobPayload {
  return {
    version: CHAT_JOB_PAYLOAD_VERSION,
    requestId: 'req-default',
    chatId: 'chat-1',
    userId: 'user-1',
    apiKeyId: 'key-1',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
    sanitizedMessages: [{ role: 'user', content: 'Hello' }],
    turnId: null,
    isRegeneration: false,
    regenerateAssistantMessageId: null,
    ...overrides,
  }
}

describe('loadChatJobExecutionContext', () => {
  beforeEach(() => {
    buildMemoryPlanMock.mockReset()
    loadGenerationTranscriptMock.mockReset()
    applyBilingualContextMock.mockReset()
    isBilingualEnabledMock.mockReset()
    ensureUserFirstForAnthropicMock.mockReset()
    buildLorebookDynamicContextMock.mockReset()
    buildSystemPromptMock.mockReset()
    decryptSecretMock.mockReset()

    buildMemoryPlanMock.mockResolvedValue({
      dynamicContext: 'DYNAMIC',
      fallbackMessages: [{ role: 'user', content: 'Hello' }],
      fallbackSystemPrompt: 'FINAL',
      promptBlocks: [
        {
          role: 'system',
          content: 'CTX',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
      ],
      staticSystemPrompt: 'STATIC',
      ragInfo: null,
    })
    loadGenerationTranscriptMock.mockResolvedValue([{ role: 'user', content: 'From transcript' }])
    applyBilingualContextMock.mockImplementation(async ({ messages }) => messages)
    isBilingualEnabledMock.mockResolvedValue(false)
    ensureUserFirstForAnthropicMock.mockImplementation((messages) => ({
      messages,
      placeholderAdded: false,
    }))
    buildLorebookDynamicContextMock.mockResolvedValue('LORE')
    buildSystemPromptMock.mockResolvedValue('SYSTEM')
    decryptSecretMock.mockResolvedValue('sk-test')
  })

  it('loads the current execution context before requesting the provider', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const supabase = createChatJobRunnerSupabaseMock()
    const payload = buildValidPayload()
    const timings: Record<string, number> = {}

    const result = await loadChatJobExecutionContext({
      supabase: supabase as never,
      payload,
      timings,
    })

    expect(result).toMatchObject({
      decryptedApiKey: 'sk-test',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: 'DYNAMIC',
      promptBlocks: [
        expect.objectContaining({
          role: 'system',
          content: 'CTX',
        }),
      ],
      recentMessages: [{ role: 'user', content: 'Hello' }],
      generationTranscript: payload.sanitizedMessages,
      bilingualEnabled: false,
      anthropicPlaceholderAdded: false,
    })
    expect(result.totalInputTokens).toBeGreaterThan(0)
    expect(result.staticPromptTokens).toBeGreaterThan(0)
    expect(result.dynamicContextTokens).toBeGreaterThan(0)
    expect(buildSystemPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultSystemPrompt: 'GLOBAL',
        customSystemPrompt: null,
      }),
    )
    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        sanitizedMessages: payload.sanitizedMessages,
        extraDynamicContext: ['LORE'],
      }),
    )
    expect(timings).toEqual(
      expect.objectContaining({
        '1_api_key_query': expect.any(Number),
        '2_chat_query': expect.any(Number),
        '6_build_system_prompt': expect.any(Number),
        '7_build_context': expect.any(Number),
        '7b_bilingual_context': expect.any(Number),
      }),
    )
  })

  it('loads the persisted turn transcript for regeneration jobs', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const supabase = createChatJobRunnerSupabaseMock()
    const transcript = [{ role: 'user', content: 'From transcript' }]
    const payload = buildValidPayload({
      requestId: 'req-turn',
      turnId: 'turn-1',
      isRegeneration: true,
      sanitizedMessages: [{ role: 'user', content: 'Ignored' }],
    })

    loadGenerationTranscriptMock.mockResolvedValueOnce(transcript)

    const result = await loadChatJobExecutionContext({
      supabase: supabase as never,
      payload,
      timings: {},
    })

    expect(loadGenerationTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        turnId: 'turn-1',
        excludeAssistantForTurnId: 'turn-1',
      }),
    )
    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sanitizedMessages: transcript,
      }),
    )
    expect(result.generationTranscript).toEqual(transcript)
  })

  it('fails in loading_context before provider execution when the token budget is too large', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const supabase = createChatJobRunnerSupabaseMock()

    buildMemoryPlanMock.mockResolvedValueOnce({
      dynamicContext: null,
      fallbackMessages: [{ role: 'user', content: 'Hello' }],
      fallbackSystemPrompt: 'x'.repeat(CHAT_RUNNER_LIMITS.maxTotalInputTokens * 4),
      promptBlocks: [],
      staticSystemPrompt: 'x'.repeat(CHAT_RUNNER_LIMITS.maxTotalInputTokens * 4),
      ragInfo: null,
    })

    await expect(
      loadChatJobExecutionContext({
        supabase: supabase as never,
        payload: buildValidPayload(),
        timings: {},
      }),
    ).rejects.toThrow('Input context too large')
  })
})
