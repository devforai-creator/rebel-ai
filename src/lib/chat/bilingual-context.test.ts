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
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '반갑습니다' },
        { role: 'user', content: '날씨가 좋네요' },
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
              { chat_id: 'chat-1', role: 'user', content: '안녕하세요', content_en: null },
              { chat_id: 'chat-1', role: 'assistant', content: '반갑습니다', content_en: null },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '반갑습니다' },
        { role: 'user', content: '오늘 뭐해요?' },
        { role: 'assistant', content: '일하고 있어요' },
        { role: 'user', content: '힘내세요!' },
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
              { chat_id: 'chat-1', role: 'user', content: '안녕하세요', content_en: 'Hello' },
              {
                chat_id: 'chat-1',
                role: 'assistant',
                content: '반갑습니다',
                content_en: 'Nice to meet you',
              },
              {
                chat_id: 'chat-1',
                role: 'user',
                content: '오늘 뭐해요?',
                content_en: 'What are you doing today?',
              },
              {
                chat_id: 'chat-1',
                role: 'assistant',
                content: '일하고 있어요',
                content_en: 'I am working',
              },
              { chat_id: 'chat-1', role: 'user', content: '힘내세요!', content_en: 'Cheer up!' },
              {
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
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '반갑습니다' },
        { role: 'user', content: '오늘 뭐해요?' },
        { role: 'assistant', content: '일하고 있어요' },
        { role: 'user', content: '힘내세요!' },
        { role: 'assistant', content: '감사합니다' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 2, // Last 2 messages keep Korean
      })

      // First 4 messages should be translated
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' })
      expect(result[1]).toEqual({ role: 'assistant', content: 'Nice to meet you' })
      expect(result[2]).toEqual({ role: 'user', content: 'What are you doing today?' })
      expect(result[3]).toEqual({ role: 'assistant', content: 'I am working' })

      // Last 2 messages should keep Korean
      expect(result[4]).toEqual({ role: 'user', content: '힘내세요!' })
      expect(result[5]).toEqual({ role: 'assistant', content: '감사합니다' })
    })

    it('uses original content when translation missing for some messages', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              { chat_id: 'chat-1', role: 'user', content: '안녕하세요', content_en: 'Hello' },
              // No translation for assistant message
              {
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
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '반갑습니다' }, // No translation
        { role: 'user', content: '오늘 뭐해요?' },
        { role: 'assistant', content: '일하고 있어요' },
        { role: 'user', content: '힘내세요!' },
      ]

      const result = await applyBilingualContext({
        supabase: supabase as any,
        chatId: 'chat-1',
        messages,
        recentKoreanCount: 2,
      })

      // Translated
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' })
      // Fallback to Korean (no translation)
      expect(result[1]).toEqual({ role: 'assistant', content: '반갑습니다' })
      // Translated
      expect(result[2]).toEqual({ role: 'user', content: 'What are you doing today?' })
      // Recent - keep Korean
      expect(result[3]).toEqual({ role: 'assistant', content: '일하고 있어요' })
      expect(result[4]).toEqual({ role: 'user', content: '힘내세요!' })
    })

    it('only fetches translations for the specified chatId', async () => {
      supabase = createSupabaseMock({
        tables: {
          messages: {
            rows: [
              {
                chat_id: 'chat-1',
                role: 'user',
                content: '안녕하세요',
                content_en: 'Hello from chat-1',
              },
              {
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
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '반갑습니다' },
        { role: 'user', content: '날씨 좋아요' },
        { role: 'assistant', content: '그렇네요' },
        { role: 'user', content: '뭐해요?' },
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
              { chat_id: 'chat-1', role: 'user', content: 'msg1', content_en: 'msg1-en' },
              { chat_id: 'chat-1', role: 'assistant', content: 'msg2', content_en: 'msg2-en' },
              { chat_id: 'chat-1', role: 'user', content: 'msg3', content_en: 'msg3-en' },
              { chat_id: 'chat-1', role: 'assistant', content: 'msg4', content_en: 'msg4-en' },
              { chat_id: 'chat-1', role: 'user', content: 'msg5', content_en: 'msg5-en' },
              { chat_id: 'chat-1', role: 'assistant', content: 'msg6', content_en: 'msg6-en' },
            ],
          },
        },
      })

      const messages: SanitizedMessage[] = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'assistant', content: 'msg4' },
        { role: 'user', content: 'msg5' },
        { role: 'assistant', content: 'msg6' },
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
