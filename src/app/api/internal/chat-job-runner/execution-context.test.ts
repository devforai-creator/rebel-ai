import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAT_DELIVERY_MODE_STREAMING } from '@/lib/chat/delivery-mode'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { CHAT_RUNNER_LIMITS } from '@/lib/chat/runtime-limits'
import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'

const buildMemoryPlanMock = vi.fn()
const loadGenerationTranscriptMock = vi.fn()
const countProjectedConversationMessagesMock = vi.fn()
const loadProjectedConversationTailMock = vi.fn()
const getLastSummaryEndMock = vi.fn()
const applyBilingualContextMock = vi.fn()
const isBilingualEnabledMock = vi.fn()
const ensureUserFirstForAnthropicMock = vi.fn()
const loadChatLorebookStateMock = vi.fn()
const lorebookNeedsChatHistoryMock = vi.fn()
const renderActiveLorebookBlockMock = vi.fn()
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
  resolveChatMemoryConfig: vi.fn((config: { memory?: { mode?: string } } | null | undefined) => ({
    mode: config?.memory?.mode === 'prefix_live_blocks' ? 'prefix_live_blocks' : 'summary_window',
    sealEveryMessages: 100,
    retainTailMessages: 4,
  })),
}))

vi.mock('@/lib/lorebook/runtime', () => ({
  loadChatLorebookState: (...args: unknown[]) => loadChatLorebookStateMock(...args),
  lorebookNeedsChatHistory: (...args: unknown[]) => lorebookNeedsChatHistoryMock(...args),
  renderActiveLorebookBlock: (...args: unknown[]) => renderActiveLorebookBlockMock(...args),
}))

vi.mock('@/lib/chat-summaries/db-helpers', () => ({
  getLastSummaryEnd: (...args: unknown[]) => getLastSummaryEndMock(...args),
}))

vi.mock('@/lib/chat/turns', () => ({
  countProjectedConversationMessages: (...args: unknown[]) =>
    countProjectedConversationMessagesMock(...args),
  loadGenerationTranscript: (...args: unknown[]) => loadGenerationTranscriptMock(...args),
  loadProjectedConversationTail: (...args: unknown[]) => loadProjectedConversationTailMock(...args),
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
    countProjectedConversationMessagesMock.mockReset()
    loadProjectedConversationTailMock.mockReset()
    getLastSummaryEndMock.mockReset()
    applyBilingualContextMock.mockReset()
    isBilingualEnabledMock.mockReset()
    ensureUserFirstForAnthropicMock.mockReset()
    loadChatLorebookStateMock.mockReset()
    lorebookNeedsChatHistoryMock.mockReset()
    renderActiveLorebookBlockMock.mockReset()
    buildSystemPromptMock.mockReset()
    decryptSecretMock.mockReset()

    buildMemoryPlanMock.mockResolvedValue({
      mode: 'summary_window',
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
    countProjectedConversationMessagesMock.mockResolvedValue(2)
    loadProjectedConversationTailMock.mockResolvedValue([])
    getLastSummaryEndMock.mockResolvedValue(0)
    applyBilingualContextMock.mockImplementation(async ({ messages }) => messages)
    isBilingualEnabledMock.mockResolvedValue(false)
    ensureUserFirstForAnthropicMock.mockImplementation((messages) => ({
      messages,
      placeholderAdded: false,
    }))
    loadChatLorebookStateMock.mockResolvedValue({
      entries: [{ moduleId: 'module-1', key: 'magic', content: 'Lore' }],
      overrideMap: new Map(),
    })
    lorebookNeedsChatHistoryMock.mockReturnValue(true)
    renderActiveLorebookBlockMock.mockReturnValue('LORE')
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
    expect(result.debugMetrics).toEqual(
      expect.objectContaining({
        transcript_source: 'payload',
        transcript_message_count: payload.sanitizedMessages.length,
        lorebook_context_chars: 4,
        memory_mode: 'summary_window',
        memory_recent_message_count: 1,
        memory_prompt_block_count: 1,
        bilingual_enabled: false,
        bilingual_query_executed: false,
      }),
    )
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
        transcriptCoverage: 'full',
        transcriptStartOrdinal: 1,
        extraDynamicContext: ['LORE'],
      }),
    )
    expect(timings).toEqual(
      expect.objectContaining({
        '1_api_key_query': expect.any(Number),
        '2_chat_query': expect.any(Number),
        '5b_load_generation_transcript': expect.any(Number),
        '6_build_system_prompt': expect.any(Number),
        '7_build_context': expect.any(Number),
        '7a_bilingual_flag_query': expect.any(Number),
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

    loadGenerationTranscriptMock.mockImplementationOnce(async ({ onMetrics }) => {
      onMetrics?.({
        targetTurnIndex: 7,
        turnCount: 7,
        fetchedMessageCount: 5,
        transcriptMessageCount: transcript.length,
        excludedAssistant: true,
      })
      return transcript
    })

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
        totalConversationMessages: 1,
        transcriptCoverage: 'full',
        transcriptStartOrdinal: 1,
      }),
    )
    expect(result.generationTranscript).toEqual(transcript)
    expect(result.debugMetrics).toEqual(
      expect.objectContaining({
        transcript_source: 'db_full',
        transcript_target_turn_index: 7,
        transcript_turn_count: 7,
        transcript_db_message_row_count: 5,
        transcript_message_count: transcript.length,
        transcript_excluded_assistant: true,
      }),
    )
  })

  it('fails in loading_context before provider execution when the token budget is too large', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const supabase = createChatJobRunnerSupabaseMock()

    buildMemoryPlanMock.mockResolvedValueOnce({
      mode: 'summary_window',
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

  it('uses the payload tail for summary-window chats when the latest visible window is sufficient', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const payloadMessages = Array.from({ length: 30 }, (_, index) => ({
      role: (index + 1) % 2 === 0 ? 'assistant' : 'user',
      content: `message-${index + 1}`,
      messageId: `msg-${index + 1}`,
    })) as ChatGenerationJobPayload['sanitizedMessages']
    const supabase = createChatJobRunnerSupabaseMock()

    countProjectedConversationMessagesMock.mockResolvedValueOnce(50)
    loadChatLorebookStateMock.mockResolvedValueOnce({
      entries: [],
      overrideMap: new Map(),
    })
    lorebookNeedsChatHistoryMock.mockReturnValueOnce(false)
    renderActiveLorebookBlockMock.mockReturnValueOnce(null)

    const result = await loadChatJobExecutionContext({
      supabase: supabase as never,
      payload: buildValidPayload({
        turnId: 'turn-30',
        sanitizedMessages: payloadMessages,
      }),
      timings: {},
    })

    expect(loadGenerationTranscriptMock).not.toHaveBeenCalled()
    expect(loadProjectedConversationTailMock).not.toHaveBeenCalled()
    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sanitizedMessages: payloadMessages.slice(-20),
        totalConversationMessages: 50,
        transcriptCoverage: 'window',
        transcriptStartOrdinal: 31,
      }),
    )
    expect(result.generationTranscript).toEqual(payloadMessages.slice(-20))
    expect(result.debugMetrics).toEqual(
      expect.objectContaining({
        transcript_source: 'payload_tail',
        transcript_message_count: 20,
        transcript_total_message_count: 50,
        transcript_start_ordinal: 31,
      }),
    )
  })

  it('falls back to a DB tail window for prefix-live chats when the payload is too short', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const projectedTail = Array.from({ length: 14 }, (_, index) => ({
      id: `db-msg-${index + 1}`,
      role: (index + 1) % 2 === 0 ? 'assistant' : 'user',
      content: `db-message-${index + 1}`,
    }))
    const supabase = createChatJobRunnerSupabaseMock({
      chat: {
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'char-1',
        persona_id: null,
        max_context_messages: 20,
        custom_system_prompt: null,
        model_config: {
          memory: {
            mode: 'prefix_live_blocks',
          },
        },
      },
    })

    countProjectedConversationMessagesMock.mockResolvedValueOnce(110)
    getLastSummaryEndMock.mockResolvedValueOnce(96)
    loadProjectedConversationTailMock.mockResolvedValueOnce(projectedTail)
    loadChatLorebookStateMock.mockResolvedValueOnce({
      entries: [],
      overrideMap: new Map(),
    })
    lorebookNeedsChatHistoryMock.mockReturnValueOnce(false)
    renderActiveLorebookBlockMock.mockReturnValueOnce(null)

    const result = await loadChatJobExecutionContext({
      supabase: supabase as never,
      payload: buildValidPayload({
        turnId: 'turn-55',
        sanitizedMessages: [
          { role: 'user', content: 'payload-1', messageId: 'payload-1' },
          { role: 'assistant', content: 'payload-2', messageId: 'payload-2' },
          { role: 'user', content: 'payload-3', messageId: 'payload-3' },
          { role: 'assistant', content: 'payload-4', messageId: 'payload-4' },
        ],
      }),
      timings: {},
    })

    expect(loadGenerationTranscriptMock).not.toHaveBeenCalled()
    expect(loadProjectedConversationTailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        limitMessages: 14,
        excludeAssistantForTurnId: null,
      }),
    )
    expect(buildMemoryPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sanitizedMessages: projectedTail.map((message) => ({
          role: message.role,
          content: message.content,
          messageId: message.id,
        })),
        totalConversationMessages: 110,
        transcriptCoverage: 'window',
        transcriptStartOrdinal: 97,
      }),
    )
    expect(result.debugMetrics).toEqual(
      expect.objectContaining({
        transcript_source: 'db_tail',
        transcript_message_count: 14,
        transcript_total_message_count: 110,
        transcript_start_ordinal: 97,
        memory_last_chunk_end: 96,
      }),
    )
  })
})
