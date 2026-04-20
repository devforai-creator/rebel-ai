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
const resolveAgenticTranscriptRecallRuntimeConfigMock = vi.fn()

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

vi.mock('@/lib/experimental/agentic-transcript-recall/config', () => ({
  resolveAgenticTranscriptRecallRuntimeConfig: (...args: unknown[]) =>
    resolveAgenticTranscriptRecallRuntimeConfigMock(...args),
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

describe('resolveTranscriptSourcePlan', () => {
  it('requires a full DB transcript when lorebook history needs the full conversation', async () => {
    const { resolveTranscriptSourcePlan } = await import('./execution-context')

    expect(
      resolveTranscriptSourcePlan({
        memoryMode: 'summary_window',
        payloadTranscriptLength: 12,
        effectiveConversationMessageCount: 40,
        payloadTranscriptCanRepresentGeneration: true,
        lorebookRequiresHistory: true,
        lastChunkEnd: null,
      }),
    ).toEqual({
      requiredMessageCount: 20,
      payloadCoversFullConversation: false,
      shouldLoadFullConversationTranscript: true,
      shouldUsePayloadWindow: false,
      reason: 'lorebook_requires_full_history',
    })
  })

  it('rejects payload transcript reuse when regeneration payload still includes the replaced assistant', async () => {
    const { resolveTranscriptSourcePlan } = await import('./execution-context')

    expect(
      resolveTranscriptSourcePlan({
        memoryMode: 'prefix_live_blocks',
        payloadTranscriptLength: 8,
        effectiveConversationMessageCount: 14,
        payloadTranscriptCanRepresentGeneration: false,
        lorebookRequiresHistory: false,
        lastChunkEnd: 10,
      }),
    ).toEqual({
      requiredMessageCount: 4,
      payloadCoversFullConversation: false,
      shouldLoadFullConversationTranscript: false,
      shouldUsePayloadWindow: false,
      reason: 'payload_missing_regeneration_exclusion',
    })
  })
})

describe('resolveLorebookHistoryPlan', () => {
  it('marks lorebook history as not needed when no history-dependent entries are active', async () => {
    const { resolveLorebookHistoryPlan } = await import('./execution-context')

    expect(
      resolveLorebookHistoryPlan({
        hasPersistedTurn: true,
        lorebookRequiresHistory: false,
        payloadCoversFullConversation: false,
        fullConversationTranscriptLoaded: false,
      }),
    ).toEqual({
      source: 'not_needed',
      reason: 'history_not_needed',
    })
  })

  it('marks payload history as provisional when no persisted turn exists yet', async () => {
    const { resolveLorebookHistoryPlan } = await import('./execution-context')

    expect(
      resolveLorebookHistoryPlan({
        hasPersistedTurn: false,
        lorebookRequiresHistory: true,
        payloadCoversFullConversation: true,
        fullConversationTranscriptLoaded: false,
      }),
    ).toEqual({
      source: 'payload',
      reason: 'no_persisted_turn',
    })
  })
})

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
    resolveAgenticTranscriptRecallRuntimeConfigMock.mockReset()

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
    resolveAgenticTranscriptRecallRuntimeConfigMock.mockReturnValue({
      configured: false,
      globallyEnabled: false,
      providerSupported: true,
      providerAllowed: true,
      enabled: false,
      skipReason: 'disabled_by_global_flag',
      maxToolCalls: 1,
      maxMessagesPerCall: 12,
      maxTotalMessages: 12,
      providerAllowlist: ['openai'],
    })
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
      agenticTranscriptRecall: {
        configured: false,
        globallyEnabled: false,
        providerSupported: true,
        providerAllowed: true,
        enabled: false,
        skipReason: 'disabled_by_global_flag',
        maxToolCalls: 1,
        maxMessagesPerCall: 12,
        maxTotalMessages: 12,
        providerAllowlist: ['openai'],
      },
      bilingualEnabled: false,
      anthropicPlaceholderAdded: false,
    })
    expect(result.totalInputTokens).toBeGreaterThan(0)
    expect(result.staticPromptTokens).toBeGreaterThan(0)
    expect(result.dynamicContextTokens).toBeGreaterThan(0)
    expect(result.debugMetrics).toEqual(
      expect.objectContaining({
        transcript_source: 'payload',
        transcript_source_reason: 'payload_covers_full_conversation',
        transcript_required_message_count: payload.sanitizedMessages.length,
        lorebook_history_source: 'payload',
        lorebook_history_source_reason: 'no_persisted_turn',
        lorebook_history_message_count: payload.sanitizedMessages.length,
        transcript_message_count: payload.sanitizedMessages.length,
        lorebook_context_chars: 4,
        memory_mode: 'summary_window',
        memory_recent_message_count: 1,
        memory_prompt_block_count: 1,
        experimental_agentic_transcript_recall_enabled: false,
        experimental_agentic_transcript_recall_skip_reason: 'disabled_by_global_flag',
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
    expect(resolveAgenticTranscriptRecallRuntimeConfigMock).toHaveBeenCalledWith({
      modelConfig: {},
      provider: 'openai',
    })
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
        transcript_source_reason: 'payload_missing_regeneration_exclusion',
        transcript_required_message_count: 1,
        lorebook_history_source: 'db_full',
        lorebook_history_source_reason: 'lorebook_requires_full_history',
        lorebook_history_message_count: transcript.length,
        transcript_target_turn_index: 7,
        transcript_turn_count: 7,
        transcript_db_message_row_count: 5,
        transcript_message_count: transcript.length,
        transcript_excluded_assistant: true,
      }),
    )
  })

  it('derives bounded source hints from sealed prompt blocks for configured experimental chats', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const supabase = createChatJobRunnerSupabaseMock({
      chat: {
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'char-1',
        persona_id: null,
        custom_system_prompt: null,
        model_config: {
          experimental: {
            agenticTranscriptRecall: {
              enabled: true,
            },
          },
        },
      },
    })
    const payload = buildValidPayload({
      sanitizedMessages: Array.from({ length: 21 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `payload-${index + 1}`,
      })),
    })

    buildMemoryPlanMock.mockResolvedValueOnce({
      mode: 'summary_window',
      dynamicContext: [
        '=== Previous Conversation Summary ===',
        '[Summary 1-10]',
        'Old summary',
        '',
        '[Meta Summary 1-20]',
        'Parent summary',
        '',
        '=== Key Facts to Remember ===',
        '[11-20]',
        'Old fact',
      ].join('\n'),
      fallbackMessages: [{ role: 'assistant', content: 'payload-21' }],
      fallbackSystemPrompt: 'FINAL',
      promptBlocks: [
        {
          role: 'system',
          content: 'STATIC',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'system',
          content: [
            '=== Previous Conversation Summary ===',
            '[Summary 1-10]',
            'Old summary',
            '',
            '[Meta Summary 1-20]',
            'Parent summary',
            '',
            '=== Key Facts to Remember ===',
            '[11-20]',
            'Old fact',
          ].join('\n'),
          cachePreference: 'avoid-cache',
          stability: 'sealed',
        },
      ],
      staticSystemPrompt: 'STATIC',
      ragInfo: null,
    })
    resolveAgenticTranscriptRecallRuntimeConfigMock.mockReturnValueOnce({
      configured: true,
      globallyEnabled: false,
      providerSupported: true,
      providerAllowed: true,
      enabled: false,
      skipReason: 'disabled_by_global_flag',
      maxToolCalls: 1,
      maxMessagesPerCall: 12,
      maxTotalMessages: 12,
      providerAllowlist: ['openai'],
    })

    const result = await loadChatJobExecutionContext({
      supabase: supabase as never,
      payload,
      timings: {},
    })

    expect(result.agenticTranscriptRecallSourceHints).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      hints: [
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 1,
          endSeq: 10,
          preview: 'Old summary',
        },
        {
          kind: 'summary',
          label: 'meta_summary',
          startSeq: 1,
          endSeq: 20,
          preview: 'Parent summary',
        },
        {
          kind: 'fact',
          label: null,
          startSeq: 11,
          endSeq: 20,
          preview: 'Old fact',
        },
      ],
    })
    expect(result.agenticTranscriptRecallSourceMap).toEqual({
      rawContextStartOrdinal: 21,
      cutoffOrdinal: 20,
      directFetchRanges: [
        {
          kind: 'summary',
          label: 'summary',
          startSeq: 1,
          endSeq: 10,
          preview: 'Old summary',
        },
        {
          kind: 'fact',
          label: null,
          startSeq: 11,
          endSeq: 20,
          preview: 'Old fact',
        },
      ],
      navigationParents: [
        {
          parentRange: {
            kind: 'summary',
            label: 'meta_summary',
            startSeq: 1,
            endSeq: 20,
            preview: 'Parent summary',
          },
          childRanges: [
            {
              kind: 'summary',
              label: 'summary',
              startSeq: 1,
              endSeq: 10,
              preview: 'Old summary',
            },
            {
              kind: 'fact',
              label: null,
              startSeq: 11,
              endSeq: 20,
              preview: 'Old fact',
            },
          ],
        },
      ],
    })
    expect(result.debugMetrics).toEqual(
      expect.objectContaining({
        experimental_agentic_transcript_recall_source_hint_count: 3,
        experimental_agentic_transcript_recall_source_hint_raw_context_start_ordinal: 21,
        experimental_agentic_transcript_recall_source_hint_summary_count: 2,
        experimental_agentic_transcript_recall_source_hint_fact_count: 1,
        experimental_agentic_transcript_recall_direct_fetch_range_count: 2,
        experimental_agentic_transcript_recall_navigation_parent_count: 1,
        experimental_agentic_transcript_recall_navigation_parent_with_children_count: 1,
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
        transcript_source_reason: 'payload_satisfies_required_window',
        transcript_required_message_count: 20,
        lorebook_history_source: 'not_needed',
        lorebook_history_source_reason: 'history_not_needed',
        lorebook_history_message_count: 0,
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
        transcript_source_reason: 'payload_shorter_than_required_window',
        transcript_required_message_count: 14,
        lorebook_history_source: 'not_needed',
        lorebook_history_source_reason: 'history_not_needed',
        lorebook_history_message_count: 0,
        transcript_message_count: 14,
        transcript_total_message_count: 110,
        transcript_start_ordinal: 97,
        memory_last_chunk_end: 96,
      }),
    )
  })

  it('falls back to a DB tail when regeneration payload cannot represent the assistant exclusion', async () => {
    const { loadChatJobExecutionContext } = await import('./execution-context')
    const projectedTail = [
      { id: 'db-msg-1', role: 'user', content: 'db-message-1' },
      { id: 'db-msg-2', role: 'assistant', content: 'db-message-2' },
    ]
    const supabase = createChatJobRunnerSupabaseMock({
      chat: {
        id: 'chat-1',
        user_id: 'user-1',
        character_id: 'char-1',
        persona_id: null,
        custom_system_prompt: null,
        model_config: {
          memory: {
            mode: 'prefix_live_blocks',
          },
        },
      },
    })

    countProjectedConversationMessagesMock.mockResolvedValueOnce(7)
    getLastSummaryEndMock.mockResolvedValueOnce(4)
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
        turnId: 'turn-3',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-target',
        sanitizedMessages: [
          { role: 'user', content: 'payload-1', messageId: 'payload-1' },
          { role: 'assistant', content: 'payload-2', messageId: 'payload-2' },
          { role: 'assistant', content: 'payload-target', messageId: 'other-assistant' },
        ],
      }),
      timings: {},
    })

    expect(loadGenerationTranscriptMock).not.toHaveBeenCalled()
    expect(loadProjectedConversationTailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        limitMessages: 2,
        excludeAssistantForTurnId: 'turn-3',
      }),
    )
    expect(result.generationTranscript).toEqual([
      { role: 'user', content: 'db-message-1', messageId: 'db-msg-1' },
      { role: 'assistant', content: 'db-message-2', messageId: 'db-msg-2' },
    ])
    expect(result.debugMetrics).toEqual(
      expect.objectContaining({
        transcript_source: 'db_tail',
        transcript_source_reason: 'payload_missing_regeneration_exclusion',
        transcript_required_message_count: 2,
        lorebook_history_source: 'not_needed',
        lorebook_history_source_reason: 'history_not_needed',
        lorebook_history_message_count: 0,
        transcript_payload_can_represent_generation: false,
        transcript_payload_covers_full_conversation: false,
        transcript_excluded_assistant: true,
      }),
    )
  })
})
