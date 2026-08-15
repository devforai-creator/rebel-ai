import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveCharacterAvatarUrlMap } from '@/lib/assets/character-avatar'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  RECENT_CHARACTER_DEFAULT_PAGE_SIZE,
  RECENT_CHARACTER_MAX_PAGE_SIZE,
  RECENT_CHARACTER_MIN_PAGE_SIZE,
  RECENT_CHARACTER_PREVIEW_MAX_LENGTH,
  type RecentConversationCharacter,
  type RecentConversationCharactersPage,
} from '@/lib/chat/recent-character-types'
import type { Database } from '@/types/database.types'

const CURSOR_VERSION = 1
const MAX_CURSOR_LENGTH = 512
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

type RecentCharactersSupabase = Pick<SupabaseClient<Database>, 'rpc'>
type AvatarSupabase = Parameters<typeof resolveCharacterAvatarUrlMap>[0]
type GeneratedRecentCharacterRow =
  Database['public']['Functions']['list_recent_conversation_characters']['Returns'][number]

type RecentCharacterRow = Omit<
  GeneratedRecentCharacterRow,
  'avatar_url' | 'latest_chat_title' | 'preview_content' | 'preview_role'
> & {
  avatar_url: string | null
  latest_chat_title: string | null
  preview_content: string | null
  preview_role: string | null
}

type RecentCharactersCursor = {
  v: typeof CURSOR_VERSION
  lastMessageAt: string
  characterId: string
}

export class InvalidRecentCharactersCursorError extends Error {
  constructor() {
    super('Invalid recent-characters cursor')
    this.name = 'InvalidRecentCharactersCursorError'
  }
}

export class InvalidRecentCharactersPageSizeError extends Error {
  constructor() {
    super('Invalid recent-characters page size')
    this.name = 'InvalidRecentCharactersPageSizeError'
  }
}

export class RecentCharactersQueryError extends Error {
  readonly code: string | null

  constructor(code: string | null = null) {
    super('Failed to load recent conversation characters')
    this.name = 'RecentCharactersQueryError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidTimestamp(value: string): boolean {
  return TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))
}

function decodeCursor(cursor: string | null | undefined): RecentCharactersCursor | null {
  if (cursor == null) {
    return null
  }

  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(cursor)) {
    throw new InvalidRecentCharactersCursorError()
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
      throw new InvalidRecentCharactersCursorError()
    }

    const payload: unknown = JSON.parse(decoded)
    if (
      !isRecord(payload) ||
      payload.v !== CURSOR_VERSION ||
      typeof payload.lastMessageAt !== 'string' ||
      !isValidTimestamp(payload.lastMessageAt) ||
      typeof payload.characterId !== 'string' ||
      !UUID_PATTERN.test(payload.characterId)
    ) {
      throw new InvalidRecentCharactersCursorError()
    }

    return {
      v: CURSOR_VERSION,
      lastMessageAt: payload.lastMessageAt,
      characterId: payload.characterId,
    }
  } catch (error) {
    if (error instanceof InvalidRecentCharactersCursorError) {
      throw error
    }
    throw new InvalidRecentCharactersCursorError()
  }
}

function encodeCursor(row: RecentCharacterRow): string {
  const payload: RecentCharactersCursor = {
    v: CURSOR_VERSION,
    lastMessageAt: row.last_message_at,
    characterId: row.character_id,
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) {
    return RECENT_CHARACTER_DEFAULT_PAGE_SIZE
  }

  if (!Number.isSafeInteger(pageSize)) {
    throw new InvalidRecentCharactersPageSizeError()
  }

  return Math.max(
    RECENT_CHARACTER_MIN_PAGE_SIZE,
    Math.min(pageSize, RECENT_CHARACTER_MAX_PAGE_SIZE),
  )
}

export function parseRecentCharactersPageSizeParam(value: string | null): number {
  if (value === null) {
    return RECENT_CHARACTER_DEFAULT_PAGE_SIZE
  }

  if (!/^-?\d+$/.test(value)) {
    throw new InvalidRecentCharactersPageSizeError()
  }

  return normalizePageSize(Number(value))
}

function mapPreview(row: RecentCharacterRow): RecentConversationCharacter['preview'] {
  if (row.preview_content === null || row.preview_role === null) {
    return null
  }

  if (row.preview_role !== 'user' && row.preview_role !== 'assistant') {
    return null
  }

  const normalizedContent = row.preview_content.replace(/\s+/g, ' ').trim()

  return {
    role: row.preview_role,
    content:
      normalizedContent.length <= RECENT_CHARACTER_PREVIEW_MAX_LENGTH
        ? normalizedContent
        : `${normalizedContent.slice(0, RECENT_CHARACTER_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`,
  }
}

export async function loadRecentConversationCharacters(options: {
  supabase: RecentCharactersSupabase
  cursor?: string | null
  pageSize?: number
  avatarSupabase?: AvatarSupabase
}): Promise<RecentConversationCharactersPage> {
  const cursor = decodeCursor(options.cursor)
  const pageSize = normalizePageSize(options.pageSize)
  const { data, error } = await options.supabase.rpc('list_recent_conversation_characters', {
    p_page_size: pageSize,
    ...(cursor
      ? {
          p_cursor_last_message_at: cursor.lastMessageAt,
          p_cursor_character_id: cursor.characterId,
        }
      : {}),
  })

  if (error) {
    throw new RecentCharactersQueryError(error.code ?? null)
  }

  const rows = (data ?? []) as RecentCharacterRow[]
  const hasMore = rows.length > pageSize
  const visibleRows = hasMore ? rows.slice(0, pageSize) : rows

  if (visibleRows.length === 0) {
    return {
      characters: [],
      hasMore: false,
      nextCursor: null,
    }
  }

  // Private asset metadata is service-readable only. The IDs passed here have
  // already been authorized and scoped by the SECURITY INVOKER RPC above.
  const avatarSupabase = options.avatarSupabase ?? createAdminClient()
  const avatarUrlMap = await resolveCharacterAvatarUrlMap(
    avatarSupabase,
    visibleRows.map((row) => ({
      id: row.character_id,
      avatar_url: row.avatar_url,
    })),
  )

  return {
    characters: visibleRows.map((row) => ({
      characterId: row.character_id,
      characterName: row.character_name,
      avatarUrl: avatarUrlMap[row.character_id] ?? row.avatar_url ?? null,
      lastMessageAt: row.last_message_at,
      latestChatId: row.latest_chat_id,
      latestChatTitle: row.latest_chat_title,
      preview: mapPreview(row),
    })),
    hasMore,
    nextCursor: hasMore ? encodeCursor(visibleRows[visibleRows.length - 1]) : null,
  }
}
