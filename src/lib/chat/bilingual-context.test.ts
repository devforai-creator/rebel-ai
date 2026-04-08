/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applyBilingualContext,
  isBilingualEnabled,
  TRANSLATION_SYSTEM_PROMPT,
} from './bilingual-context'
import { createSupabaseMock, type SupabaseMock } from '@/tests/mocks/supabase'
import type { SanitizedMessage } from '@/lib/chat-summaries'

describe('bilingual-context', () => {
  describe('TRANSLATION_SYSTEM_PROMPT', () => {
    it('exports the translation prompt constant', () => {
      expect(TRANSLATION_SYSTEM_PROMPT).toContain('translator')
      expect(TRANSLATION_SYSTEM_PROMPT).toContain('English')
    })
  })

  describe('applyBilingualContext', () => {
    let supabase: SupabaseMock

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('returns empty array for empty messages', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: { rows: [] },
        },
      })

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages: [],
      })

      expect(result).toEqual([])
    })

    it('returns original messages when count <= recentKoreanCount', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: { rows: [] },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '안녕하세요', messageId: 'msg-1' },
        { role: 'assistant', content: '반갑습니다', messageId: 'msg-2' },
        { role: 'user', content: '날씨가 좋네요', messageId: 'msg-3' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 4, // messages.length (3) <= 4
      })

      expect(result).toEqual(messages)
    })

    it('returns original messages when no translations exist', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              // No content_en in any message
              {
                id: 'msg-1',
                chat_id: 'chat-1',
                role: 'user',
                content: '안녕하세요',
                content_en: null,
              },
              {
                id: 'msg-2',
                chat_id: 'chat-1',
                role: 'assistant',
                content: '반갑습니다',
                content_en: null,
              },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '안녕하세요', messageId: 'msg-1' },
        { role: 'assistant', content: '반갑습니다', messageId: 'msg-2' },
        { role: 'user', content: '오늘 뭐해요?', messageId: 'msg-3' },
        { role: 'assistant', content: '일하고 있어요', messageId: 'msg-4' },
        { role: 'user', content: '힘내세요!', messageId: 'msg-5' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 2,
      })

      // No translations available, should return original
      expect(result).toEqual(messages)
    })

    it('replaces older messages with translations, keeps recent in Korean', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              {
                id: 'msg-1',
                chat_id: 'chat-1',
                role: 'user',
                content: '안녕하세요',
                content_en: 'Hello',
              },
              {
                id: 'msg-2',
                chat_id: 'chat-1',
                role: 'assistant',
                content: '반갑습니다',
                content_en: 'Nice to meet you',
              },
              {
                id: 'msg-3',
                chat_id: 'chat-1',
                role: 'user',
                content: '오늘 뭐해요?',
                content_en: 'What are you doing today?',
              },
              {
                id: 'msg-4',
                chat_id: 'chat-1',
                role: 'assistant',
                content: '일하고 있어요',
                content_en: 'I am working',
              },
              {
                id: 'msg-5',
                chat_id: 'chat-1',
                role: 'user',
                content: '힘내세요!',
                content_en: 'Cheer up!',
              },
              {
                id: 'msg-6',
                chat_id: 'chat-1',
                role: 'assistant',
                content: '감사합니다',
                content_en: 'Thank you',
              },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '안녕하세요', messageId: 'msg-1' },
        { role: 'assistant', content: '반갑습니다', messageId: 'msg-2' },
        { role: 'user', content: '오늘 뭐해요?', messageId: 'msg-3' },
        { role: 'assistant', content: '일하고 있어요', messageId: 'msg-4' },
        { role: 'user', content: '힘내세요!', messageId: 'msg-5' },
        { role: 'assistant', content: '감사합니다', messageId: 'msg-6' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 2, // Last 2 messages keep Korean
      })

      // First 4 messages should be translated
      expect(result[0]).toEqual({ role: 'user', content: 'Hello', messageId: 'msg-1' })
      expect(result[1]).toEqual({
        role: 'assistant',
        content: 'Nice to meet you',
        messageId: 'msg-2',
      })
      expect(result[2]).toEqual({
        role: 'user',
        content: 'What are you doing today?',
        messageId: 'msg-3',
      })
      expect(result[3]).toEqual({
        role: 'assistant',
        content: 'I am working',
        messageId: 'msg-4',
      })

      // Last 2 messages should keep Korean
      expect(result[4]).toEqual({ role: 'user', content: '힘내세요!', messageId: 'msg-5' })
      expect(result[5]).toEqual({ role: 'assistant', content: '감사합니다', messageId: 'msg-6' })
    })

    it('uses original content when translation missing for some messages', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              {
                id: 'msg-1',
                chat_id: 'chat-1',
                role: 'user',
                content: '안녕하세요',
                content_en: 'Hello',
              },
              // No translation for assistant message
              {
                id: 'msg-3',
                chat_id: 'chat-1',
                role: 'user',
                content: '오늘 뭐해요?',
                content_en: 'What are you doing today?',
              },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '안녕하세요', messageId: 'msg-1' },
        { role: 'assistant', content: '반갑습니다', messageId: 'msg-2' }, // No translation
        { role: 'user', content: '오늘 뭐해요?', messageId: 'msg-3' },
        { role: 'assistant', content: '일하고 있어요', messageId: 'msg-4' },
        { role: 'user', content: '힘내세요!', messageId: 'msg-5' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 2,
      })

      // Translated
      expect(result[0]).toEqual({ role: 'user', content: 'Hello', messageId: 'msg-1' })
      // Fallback to Korean (no translation)
      expect(result[1]).toEqual({ role: 'assistant', content: '반갑습니다', messageId: 'msg-2' })
      // Translated
      expect(result[2]).toEqual({
        role: 'user',
        content: 'What are you doing today?',
        messageId: 'msg-3',
      })
      // Recent - keep Korean
      expect(result[3]).toEqual({ role: 'assistant', content: '일하고 있어요', messageId: 'msg-4' })
      expect(result[4]).toEqual({ role: 'user', content: '힘내세요!', messageId: 'msg-5' })
    })

    it('only fetches translations for the specified chatId', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              {
                id: 'msg-1',
                chat_id: 'chat-1',
                role: 'user',
                content: '안녕하세요',
                content_en: 'Hello from chat-1',
              },
              {
                id: 'msg-2',
                chat_id: 'chat-2',
                role: 'user',
                content: '안녕하세요',
                content_en: 'Hello from chat-2',
              },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '안녕하세요', messageId: 'msg-1' },
        { role: 'assistant', content: '반갑습니다', messageId: 'msg-a' },
        { role: 'user', content: '날씨 좋아요', messageId: 'msg-b' },
        { role: 'assistant', content: '그렇네요', messageId: 'msg-c' },
        { role: 'user', content: '뭐해요?', messageId: 'msg-d' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 2,
      })

      // Should use chat-1's translation, not chat-2's
      expect(result[0].content).toBe('Hello from chat-1')
    })

    it('uses default recentKoreanCount of 4', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              {
                id: 'msg-1',
                chat_id: 'chat-1',
                role: 'user',
                content: 'msg1',
                content_en: 'msg1-en',
              },
              {
                id: 'msg-2',
                chat_id: 'chat-1',
                role: 'assistant',
                content: 'msg2',
                content_en: 'msg2-en',
              },
              {
                id: 'msg-3',
                chat_id: 'chat-1',
                role: 'user',
                content: 'msg3',
                content_en: 'msg3-en',
              },
              {
                id: 'msg-4',
                chat_id: 'chat-1',
                role: 'assistant',
                content: 'msg4',
                content_en: 'msg4-en',
              },
              {
                id: 'msg-5',
                chat_id: 'chat-1',
                role: 'user',
                content: 'msg5',
                content_en: 'msg5-en',
              },
              {
                id: 'msg-6',
                chat_id: 'chat-1',
                role: 'assistant',
                content: 'msg6',
                content_en: 'msg6-en',
              },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: 'msg1', messageId: 'msg-1' },
        { role: 'assistant', content: 'msg2', messageId: 'msg-2' },
        { role: 'user', content: 'msg3', messageId: 'msg-3' },
        { role: 'assistant', content: 'msg4', messageId: 'msg-4' },
        { role: 'user', content: 'msg5', messageId: 'msg-5' },
        { role: 'assistant', content: 'msg6', messageId: 'msg-6' },
      ]

      // Don't pass recentKoreanCount - should default to 4
      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
      })

      // First 2 translated (6 - 4 = 2 older messages)
      expect(result[0].content).toBe('msg1-en')
      expect(result[1].content).toBe('msg2-en')

      // Last 4 keep Korean
      expect(result[2].content).toBe('msg3')
      expect(result[3].content).toBe('msg4')
      expect(result[4].content).toBe('msg5')
      expect(result[5].content).toBe('msg6')
    })

    it('keeps original content when older messages have no message ids', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              {
                id: 'msg-1',
                chat_id: 'chat-1',
                role: 'user',
                content: '안녕하세요',
                content_en: 'Hello',
              },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '반갑습니다', messageId: 'msg-2' },
        { role: 'user', content: '최근 메시지', messageId: 'msg-3' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 1,
      })

      expect(result[0].content).toBe('안녕하세요')
      expect(result[0].messageId).toBeUndefined()
    })

    it('matches translations by message id even when content is duplicated', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              {
                id: 'msg-1',
                chat_id: 'chat-1',
                role: 'user',
                content: '중복',
                content_en: 'first duplicate',
              },
              {
                id: 'msg-2',
                chat_id: 'chat-1',
                role: 'user',
                content: '중복',
                content_en: 'second duplicate',
              },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '중복', messageId: 'msg-2' },
        { role: 'assistant', content: '최근 응답', messageId: 'msg-3' },
        { role: 'user', content: '마지막', messageId: 'msg-4' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 2,
      })

      expect(result[0].content).toBe('second duplicate')
    })
  })

  describe('isBilingualEnabled', () => {
    it('returns true when translation_api_key_id is set', async () => {
      const supabase = createSupabaseMock({
        tables: {
          profiles: {
            rows: [{ id: 'user-1', translation_api_key_id: 'key-123' }],
          },
        },
      })

      const result = await isBilingualEnabled(supabase as any, 'user-1')
      expect(result).toBe(true)
    })

    it('returns false when translation_api_key_id is null', async () => {
      const supabase = createSupabaseMock({
        tables: {
          profiles: {
            rows: [{ id: 'user-1', translation_api_key_id: null }],
          },
        },
      })

      const result = await isBilingualEnabled(supabase as any, 'user-1')
      expect(result).toBe(false)
    })

    it('returns false when profile not found', async () => {
      const supabase = createSupabaseMock({
        tables: {
          profiles: {
            rows: [], // No profiles
          },
        },
      })

      const result = await isBilingualEnabled(supabase as any, 'user-1')
      expect(result).toBe(false)
    })

    it('returns false for different user', async () => {
      const supabase = createSupabaseMock({
        tables: {
          profiles: {
            rows: [{ id: 'user-2', translation_api_key_id: 'key-123' }],
          },
        },
      })

      const result = await isBilingualEnabled(supabase as any, 'user-1')
      expect(result).toBe(false)
    })
  })
})
