import { describe, expect, it } from 'vitest'

import {
  CHAT_JOB_PAYLOAD_VERSION,
  parseChatJobPayload,
  serializeChatJobPayload,
  type ChatGenerationJobPayload,
} from './job-payload'

const basePayload: ChatGenerationJobPayload = {
  version: CHAT_JOB_PAYLOAD_VERSION,
  requestId: 'req-1',
  chatId: 'chat-1',
  turnId: null,
  userId: 'user-1',
  apiKeyId: 'key-1',
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  sanitizedMessages: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi!' },
  ],
  isRegeneration: false,
  regenerateAssistantMessageId: null,
}

describe('chat job payload parsing', () => {
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
})
