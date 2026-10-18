import { describe, expect, it } from 'vitest'

import {
  CHAT_JOB_PAYLOAD_VERSION,
  parseChatJobPayload,
  serializeChatJobPayload,
  type ChatGenerationJobPayload,
} from './job-payload'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH, CHAT_DELIVERY_MODE_STREAMING } from './delivery-mode'

const basePayload: ChatGenerationJobPayload = {
  version: CHAT_JOB_PAYLOAD_VERSION,
  requestId: 'req-1',
  chatId: 'chat-1',
  turnId: null,
  userId: 'user-1',
  apiKeyId: 'key-1',
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
  sanitizedMessages: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi!' },
  ],
  isRegeneration: false,
  regenerateAssistantMessageId: null,
}

describe('chat job payload parsing', () => {
  it('round trips a Google tier snapshot and rejects invalid combinations', () => {
    const payload = {
      ...basePayload,
      provider: 'google' as const,
      modelName: 'gemini-4-argon',
      serviceTier: 'flex' as const,
    }
    expect(parseChatJobPayload(serializeChatJobPayload(payload))).toEqual(payload)
    expect(parseChatJobPayload({ ...payload, serviceTier: 'priority' })).toBeNull()
    expect(parseChatJobPayload({ ...payload, provider: 'anthropic' })).toBeNull()
    expect(parseChatJobPayload({ ...payload, modelName: 'gemini-3.7-flash' })).toBeNull()
    expect(parseChatJobPayload(basePayload)?.serviceTier).toBeUndefined()
  })

  it.each(['standard', 'flex', 'priority', 'batch'] as const)(
    'round trips an effective OpenAI %s snapshot and accepts legacy jobs without one',
    (serviceTier) => {
      const payload = { ...basePayload, modelName: 'gpt-6-luna', serviceTier }
      expect(parseChatJobPayload(serializeChatJobPayload(payload))).toEqual(payload)
      expect(parseChatJobPayload({ ...payload, serviceTier: 'bogus' })).toBeNull()
      expect(parseChatJobPayload({ ...payload, serviceTier: { toString: 'flex' } })).toBeNull()
      expect(parseChatJobPayload(basePayload)?.serviceTier).toBeUndefined()
    },
  )

  it('round trips explicit default and explicit effort without falling back to a live key', () => {
    for (const effort of [null, 'low', 'none'] as const) {
      const payload = {
        ...basePayload,
        modelName: 'gpt-5.5',
        reasoning: { effort, source: 'chat' as const },
      }
      expect(parseChatJobPayload(serializeChatJobPayload(payload))).toEqual(payload)
    }
    expect(
      parseChatJobPayload({
        ...basePayload,
        provider: 'google',
        modelName: 'gemini-4-argon',
        reasoning: { effort: 'none', source: 'chat' },
      }),
    ).toBeNull()
    expect(parseChatJobPayload({ ...basePayload, reasoning: null })).toBeNull()
  })
  it('parses a valid payload', () => {
    const parsed = parseChatJobPayload(basePayload)

    expect(parsed).toEqual(basePayload)
  })

  it('serializes payloads as JSON-compatible objects', () => {
    const serialized = serializeChatJobPayload(basePayload)

    expect(serialized).toEqual(basePayload)
  })

  it('rejects unsupported payload versions', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      version: 999,
    })

    expect(parsed).toBeNull()
  })

  it('rejects payloads with invalid sanitized messages', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      sanitizedMessages: [
        { role: 'system', content: 'ignored' },
        { role: 'assistant', content: 123 },
      ] as unknown as ChatGenerationJobPayload['sanitizedMessages'],
    })

    expect(parsed).toBeNull()
  })

  it('rejects payloads missing required fields', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      apiKeyId: undefined,
    })

    expect(parsed).toBeNull()
  })

  it('rejects payloads with unsupported providers', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      provider: 'bogus-provider',
    })

    expect(parsed).toBeNull()
  })

  it('rejects embedding-only providers in chat job payloads', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      provider: 'voyage_embeddings',
    })

    expect(parsed).toBeNull()
  })

  it('normalizes regenerateAssistantMessageId to null when not a string', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      isRegeneration: true,
      regenerateAssistantMessageId: 123 as unknown as string,
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.regenerateAssistantMessageId).toBeNull()
  })

  it('retains regenerateAssistantMessageId when provided', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      isRegeneration: true,
      regenerateAssistantMessageId: 'assistant-1',
    })

    expect(parsed?.regenerateAssistantMessageId).toBe('assistant-1')
  })

  it('retains message ids when provided on sanitized messages', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      sanitizedMessages: [{ role: 'user', content: 'Hello', messageId: 'msg-1' }],
    })

    expect(parsed?.sanitizedMessages).toEqual([
      { role: 'user', content: 'Hello', messageId: 'msg-1' },
    ])
  })

  it('defaults older payloads to streaming delivery mode', () => {
    const { deliveryMode, ...legacyPayload } = basePayload
    expect(deliveryMode).toBe(CHAT_DELIVERY_MODE_STREAMING)

    const parsed = parseChatJobPayload(legacyPayload)

    expect(parsed?.deliveryMode).toBe(CHAT_DELIVERY_MODE_STREAMING)
  })

  it('retains Anthropic Batch delivery mode', () => {
    const parsed = parseChatJobPayload({
      ...basePayload,
      deliveryMode: CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
    })

    expect(parsed?.deliveryMode).toBe(CHAT_DELIVERY_MODE_ANTHROPIC_BATCH)
  })
})
