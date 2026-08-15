import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { CharacterChat, CharacterChatsPage } from '@/lib/chat/character-chat-types'
import { CHARACTER_CHAT_PAGE_SIZE } from '@/lib/chat/constants'
import type { Database } from '@/types/database.types'

const CURSOR_VERSION = 1
const MAX_PAGE_SIZE = 50
const MAX_CURSOR_LENGTH = 512
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const MESSAGE_PREVIEW_LIMIT = 240

type CharacterChatsSupabase = Pick<SupabaseClient<Database>, 'rpc'>
type GeneratedCharacterChatRow =
  Database['public']['Functions']['list_character_chats']['Returns'][number]

type CharacterChatRow = Omit<
  GeneratedCharacterChatRow,
  'last_message_at' | 'preview_content' | 'preview_role' | 'title'
> & {
  last_message_at: string | null
  preview_content: string | null
  preview_role: string | null
  title: string | null
}

type CharacterChatsCursor = {
  v: typeof CURSOR_VERSION
  recencyAt: string
  chatId: string
}

export class InvalidCharacterChatsCursorError extends Error {
  constructor() {
    super('Invalid character-chats cursor')
    this.name = 'InvalidCharacterChatsCursorError'
  }
}

export class CharacterChatsQueryError extends Error {
  readonly code: string | null

  constructor(code: string | null = null) {
    super('Failed to load character chats')
    this.name = 'CharacterChatsQueryError'
    this.code = code
  }
}

function decodeCursor(cursor: string | null | undefined): CharacterChatsCursor | null {
  if (cursor == null) {
    return null
  }

  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(cursor)) {
    throw new InvalidCharacterChatsCursorError()
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
      throw new InvalidCharacterChatsCursorError()
    }

    const payload = JSON.parse(decoded) as Partial<CharacterChatsCursor>
    if (
      typeof payload !== 'object' ||
      payload === null ||
      payload.v !== CURSOR_VERSION ||
      typeof payload.recencyAt !== 'string' ||
      !TIMESTAMP_PATTERN.test(payload.recencyAt) ||
      !Number.isFinite(Date.parse(payload.recencyAt)) ||
      typeof payload.chatId !== 'string' ||
      !UUID_PATTERN.test(payload.chatId)
    ) {
      throw new InvalidCharacterChatsCursorError()
    }

    return {
      v: CURSOR_VERSION,
      recencyAt: payload.recencyAt,
      chatId: payload.chatId,
    }
  } catch (error) {
    if (error instanceof InvalidCharacterChatsCursorError) {
      throw error
    }
    throw new InvalidCharacterChatsCursorError()
  }
}

function encodeCursor(row: CharacterChatRow): string {
  const payload: CharacterChatsCursor = {
    v: CURSOR_VERSION,
    recencyAt: row.recency_at,
    chatId: row.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function normalizePreview(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ')
  if (normalized.length <= MESSAGE_PREVIEW_LIMIT) {
    return normalized
  }
  return `${normalized.slice(0, MESSAGE_PREVIEW_LIMIT)}...`
}

function mapChat(row: CharacterChatRow): CharacterChat {
  const role = row.preview_role
  const preview: CharacterChat['lastMessage'] =
    (role === 'user' || role === 'assistant') && row.preview_content !== null
      ? { role, content: normalizePreview(row.preview_content) }
      : null

  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    last_message_at: row.last_message_at,
    recency_at: row.recency_at,
    lastMessage: preview,
  }
}

export async function loadCharacterChats(options: {
  supabase: CharacterChatsSupabase
  characterId: string
  cursor?: string | null
  pageSize?: number
}): Promise<CharacterChatsPage> {
  const cursor = decodeCursor(options.cursor)
  const pageSize = Math.max(
    1,
    Math.min(options.pageSize ?? CHARACTER_CHAT_PAGE_SIZE, MAX_PAGE_SIZE),
  )
  const { data, error } = await options.supabase.rpc('list_character_chats', {
    p_character_id: options.characterId,
    p_page_size: pageSize,
    ...(cursor
      ? {
          p_cursor_recency_at: cursor.recencyAt,
          p_cursor_chat_id: cursor.chatId,
        }
      : {}),
  })

  if (error) {
    throw new CharacterChatsQueryError(error.code ?? null)
  }

  const rows = (data ?? []) as CharacterChatRow[]
  const hasMore = rows.length > pageSize
  const visibleRows = hasMore ? rows.slice(0, pageSize) : rows

  return {
    chats: visibleRows.map(mapChat),
    hasMore,
    nextCursor: hasMore ? encodeCursor(visibleRows[visibleRows.length - 1]) : null,
  }
}
