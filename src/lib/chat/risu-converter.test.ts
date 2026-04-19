import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fromRisuFormat,
  generateExportFilename,
  getMessageCount,
  isValidRisuChat,
  parseRisuChatJson,
  toRisuFormat,
} from './risu-converter'
import type { RisuChat } from '@/types/risu-chat'

describe('Risu converter', () => {
  let uuidCounter = 0

  beforeEach(() => {
    uuidCounter = 0
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `uuid-${uuidCounter++}`)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('converts Rebel messages to Risu format and includes RebelAI extension data', () => {
    const risu = toRisuFormat(
      [
        {
          id: 'user-1',
          role: 'user',
          content: 'hello',
          created_at: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'hi there',
          model_used: 'gpt-4o',
          prompt_tokens: 5,
          completion_tokens: 7,
          created_at: '2025-01-01T00:01:00.000Z',
        },
        { id: 'system-1', role: 'system', content: 'ignore me' },
      ],
      {
        chatTitle: 'Journey',
        characterName: 'Hero',
        exportedAt: '2025-01-01T00:00:00.000Z',
        source: 'RebelAI',
      },
      {
        summaries: [{ level: 0, start_seq: 1, end_seq: 10, summary: 'summary' }],
        facts: [{ start_seq: 1, end_seq: 10, facts: 'fact' }],
      },
    )

    expect(risu.type).toBe('risuChat')
    expect(risu.data.name).toBe('Journey')
    expect(risu.data.message).toHaveLength(2) // system message filtered out

    const [userMsg, assistantMsg] = risu.data.message
    expect(userMsg).toMatchObject({
      role: 'user',
      data: 'hello',
      chatId: 'user-1',
    })
    expect(assistantMsg).toMatchObject({
      role: 'char',
      data: 'hi there',
      chatId: 'assistant-1',
      generationInfo: expect.objectContaining({
        model: 'gpt-4o',
        inputTokens: 5,
        outputTokens: 7,
      }),
      promptInfo: {},
    })
    // randomUUID usage order is deterministic via mock
    expect(assistantMsg.saying).toBe('uuid-0')
    expect(assistantMsg.generationInfo?.generationId).toBe('uuid-1')
    expect(risu.data._rebelai).toMatchObject({
      summaries: [{ level: 0, start_seq: 1, end_seq: 10, summary: 'summary' }],
      facts: [{ start_seq: 1, end_seq: 10, facts: 'fact' }],
    })
    expect(risu.data.id).toBe('uuid-2')
  })

  it('converts Risu chat back to Rebel format', () => {
    const risu: RisuChat = {
      type: 'risuChat',
      ver: 2,
      data: {
        message: [
          {
            role: 'char',
            data: 'reply',
            time: 1_700_000_000_000,
            name: null,
            generationInfo: {
              model: 'claude',
              generationId: 'gen-1',
              inputTokens: 10,
              outputTokens: 20,
              maxContext: 4096,
            },
            promptInfo: {},
            chatId: 'assistant-chat',
          },
          {
            role: 'user',
            data: 'question',
            time: 1_700_000_100_000,
            name: null,
            chatId: 'user-chat',
          },
        ],
        note: '',
        name: 'Test',
        localLore: [],
        fmIndex: 0,
        id: 'chat-1',
      },
      folders: [],
    }

    const rebel = fromRisuFormat(risu)

    expect(rebel).toHaveLength(2)
    expect(rebel[0]).toMatchObject({
      role: 'assistant',
      content: 'reply',
      prompt_tokens: 10,
      completion_tokens: 20,
    })
    expect(rebel[1]).toMatchObject({
      role: 'user',
      content: 'question',
    })
  })

  it('validates Risu chat format and rejects malformed payloads', () => {
    const valid: RisuChat = {
      type: 'risuChat',
      ver: 2,
      data: {
        message: [{ role: 'user', data: 'ok', time: 0, name: null, chatId: 'c1' }],
        note: '',
        name: '',
        localLore: [],
        fmIndex: 0,
        id: 'cid',
      },
      folders: [],
    }
    expect(isValidRisuChat(valid)).toBe(true)

    const invalidMessage = {
      type: 'risuChat',
      ver: 2,
      data: { message: [{ role: 123, data: 'bad' }] },
      folders: [],
    }
    expect(isValidRisuChat(invalidMessage)).toBe(false)

    const invalidStructure = { type: 'risuChat', ver: 0, data: { note: '' } }
    expect(isValidRisuChat(invalidStructure)).toBe(false)
  })

  it('parses JSON and throws for invalid inputs', () => {
    const json = JSON.stringify({
      type: 'risuChat',
      ver: 2,
      data: {
        message: [{ role: 'user', data: 'hi', time: 0, name: null, chatId: 'c1' }],
        note: '',
        name: '',
        localLore: [],
        fmIndex: 0,
        id: 'cid',
      },
      folders: [],
    })
    expect(parseRisuChatJson(json).data.message[0].data).toBe('hi')
    expect(() => parseRisuChatJson('{bad json')).toThrow('Invalid JSON format')
    expect(() => parseRisuChatJson('{}')).toThrow(
      'Invalid compatible chat JSON format: missing required fields',
    )
  })

  it('counts only user/char messages and generates safe filenames', () => {
    const risu: RisuChat = {
      type: 'risuChat',
      ver: 2,
      data: {
        message: [
          { role: 'user', data: 'hi', time: 0, name: null, chatId: 'u1' },
          { role: 'char', data: 'yo', time: 1, name: null, chatId: 'a1' },
          // @ts-expect-error - testing that invalid role is filtered out
          { role: 'system', data: 'ignored', time: 2, name: null, chatId: 's1' },
        ],
        note: '',
        name: '',
        localLore: [],
        fmIndex: 0,
        id: 'cid',
      },
      folders: [],
    }

    expect(getMessageCount(risu)).toBe(2)
    const filename = generateExportFilename('Hero?!', 'Battle Plan')
    expect(filename).toMatch(/^Hero_+Battle_Plan_/)
    expect(filename.endsWith('_chat.json')).toBe(true)
  })
})
