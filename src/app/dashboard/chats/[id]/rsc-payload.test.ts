import { describe, expect, it } from 'vitest'
import type { ProjectedTurnMessage } from '@/lib/chat/turn-types'
import {
  buildInitialActiveChatJob,
  pickChatCharacterMetadata,
  stripInitialMessageDebugInfo,
} from './rsc-payload'

function createMessage(overrides: Partial<ProjectedTurnMessage> = {}): ProjectedTurnMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    content: 'Hello',
    chat_id: 'chat-1',
    user_id: 'user-1',
    sequence: 1,
    model_used: null,
    prompt_tokens: null,
    completion_tokens: null,
    latency_ms: null,
    error_code: null,
    debug_info: null,
    content_en: null,
    created_at: '2026-06-22T00:00:00.000Z',
    turn_id: 'turn-1',
    variant_index: 1,
    supersedes_message_id: null,
    message_status: 'completed',
    ...overrides,
  }
}

describe('chat RSC payload helpers', () => {
  it('reduces an active job payload to the fields needed for client recovery', () => {
    expect(
      buildInitialActiveChatJob({
        id: 'job-1',
        delivery_mode: 'anthropic_batch',
        payload: {
          version: 1,
          requestId: 'request-1',
          chatId: 'chat-1',
          turnId: 'turn-1',
          userId: 'user-1',
          apiKeyId: 'secret-key-reference',
          provider: 'anthropic',
          modelName: 'claude-opus-4-6',
          deliveryMode: 'anthropic_batch',
          sanitizedMessages: [{ role: 'user', content: 'private conversation' }],
          isRegeneration: true,
          regenerateAssistantMessageId: 'assistant-1',
        },
      }),
    ).toEqual({
      id: 'job-1',
      deliveryMode: 'anthropic_batch',
      regenerateAssistantMessageId: 'assistant-1',
    })
  })

  it('falls back safely when an active job has a legacy or invalid payload', () => {
    expect(
      buildInitialActiveChatJob({
        id: 'job-1',
        delivery_mode: 'streaming',
        payload: { version: 0 },
      }),
    ).toEqual({
      id: 'job-1',
      deliveryMode: 'streaming',
      regenerateAssistantMessageId: null,
    })
    expect(buildInitialActiveChatJob(null)).toBeNull()
  })

  it('removes debug_info from initial messages while preserving display fields', () => {
    const messages = [
      createMessage({
        debug_info: {
          fullPrompt: {
            messages: [{ role: 'user', content: 'large prompt snapshot' }],
          },
        },
      }),
      createMessage({
        id: 'message-2',
        role: 'user',
        debug_info: null,
      }),
    ]

    const result = stripInitialMessageDebugInfo(messages)

    expect(result[0]).toMatchObject({
      id: 'message-1',
      role: 'assistant',
      content: 'Hello',
      debug_info: null,
    })
    expect(result[1]).toBe(messages[1])
  })

  it('keeps only chat-rendered character metadata fields', () => {
    const metadata = {
      default_variables: { hp: 20 },
      ui_card: { meta: { name: 'status' }, views: { Main: {} } },
      ui_cards: { details: { meta: { name: 'details' }, views: { Main: {} } } },
      image_display: { meta: { name: 'portrait' }, views: { Main: {} } },
      import_manifest: Array.from({ length: 100 }, (_, index) => [index, [index]]),
      raw_payload: { nested: ['not used by chat rendering'] },
    }

    expect(pickChatCharacterMetadata(metadata)).toEqual({
      default_variables: metadata.default_variables,
      ui_card: metadata.ui_card,
      ui_cards: metadata.ui_cards,
      image_display: metadata.image_display,
    })
  })

  it('returns null when metadata has no chat-rendered fields', () => {
    expect(pickChatCharacterMetadata({ raw_payload: { value: true } })).toBeNull()
    expect(pickChatCharacterMetadata(null)).toBeNull()
    expect(pickChatCharacterMetadata([])).toBeNull()
  })
})
