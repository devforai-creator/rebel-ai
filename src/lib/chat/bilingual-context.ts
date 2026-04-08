import type { createAdminClient } from '@/lib/supabase/admin'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { Message, Profile } from '@/types/database.types'

type BilingualContextSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from'>
type TranslatedMessageRow = Pick<Message, 'id' | 'content_en'>
type BilingualProfileRow = Pick<Profile, 'translation_api_key_id'>

/**
 * Default number of recent messages to keep in Korean (original language).
 * 4 messages = 2 turns (user + assistant per turn)
 */
const DEFAULT_RECENT_KOREAN_COUNT = 4

export const TRANSLATION_SYSTEM_PROMPT = `You are a translator. Translate the following text to English.
Keep the meaning and tone as close as possible to the original.
Output ONLY the English translation, nothing else.`

interface BilingualContextOptions {
  supabase: BilingualContextSupabaseClient
  chatId: string
  messages: SanitizedMessage[]
  recentKoreanCount?: number
}

/**
 * Apply bilingual memory optimization to chat messages.
 *
 * Strategy:
 * - Recent N messages: Keep original content (Korean) for style/tone consistency
 * - Older messages: Use English translation (content_en) for token efficiency
 * - Fallback: If no translation available, use original content
 *
 * This reduces token usage by ~30% for non-English conversations while
 * preserving natural language style in recent context.
 */
export async function applyBilingualContext({
  supabase,
  chatId,
  messages,
  recentKoreanCount = DEFAULT_RECENT_KOREAN_COUNT,
}: BilingualContextOptions): Promise<SanitizedMessage[]> {
  if (messages.length === 0) {
    return messages
  }

  // If all messages are "recent", no translation needed
  if (messages.length <= recentKoreanCount) {
    return messages
  }

  const recentStartIndex = messages.length - recentKoreanCount
  const olderMessages = messages.slice(0, recentStartIndex)
  const translationIds = olderMessages
    .map((message) => message.messageId)
    .filter(
      (messageId): messageId is string => typeof messageId === 'string' && messageId.length > 0,
    )

  if (translationIds.length === 0) {
    return messages
  }

  const { data, error } = await supabase
    .from('messages')
    .select<'id, content_en'>('id, content_en')
    .eq('chat_id', chatId)
    .in('id', translationIds)
    .not('content_en', 'is', null) // Only fetch if translation exists

  if (error) {
    console.error('[BilingualContext] Failed to fetch translations:', error)
    return messages // Fallback to original messages
  }

  const dbMessages = (data ?? []) as TranslatedMessageRow[]

  if (dbMessages.length === 0) {
    // No translations available yet
    return messages
  }

  // Build lookup map: message id -> content_en
  const translationMap = new Map<string, string>()
  for (const msg of dbMessages) {
    if (msg.id && msg.content_en) {
      translationMap.set(msg.id, msg.content_en)
    }
  }

  // Apply translations to older messages
  const result: SanitizedMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (i >= recentStartIndex) {
      // Recent messages: keep original Korean
      result.push(msg)
    } else {
      const translation =
        typeof msg.messageId === 'string' ? translationMap.get(msg.messageId) : undefined

      if (translation) {
        result.push({
          ...msg,
          content: translation,
        })
      } else {
        // No translation available, use original
        result.push(msg)
      }
    }
  }

  return result
}

/**
 * Check if bilingual memory is enabled for a user.
 * Enabled when translation_api_key_id is set in profile.
 */
export async function isBilingualEnabled(
  supabase: BilingualContextSupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select<'translation_api_key_id'>('translation_api_key_id')
    .eq('id', userId)
    .single<BilingualProfileRow>()

  if (error || !profile) {
    return false
  }

  return !!profile.translation_api_key_id
}
