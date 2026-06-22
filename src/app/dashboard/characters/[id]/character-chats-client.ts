import { createApiError } from '@/lib/http/api-contract'
import type { CharacterChat } from './character-detail-types'
import type { ChatImportResult } from '@/types/risu-chat'

export type CharacterChatsPage = {
  chats: CharacterChat[]
  hasMore: boolean
  nextCursor: string | null
}

export async function fetchCharacterChatsPage(
  characterId: string,
  cursor: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CharacterChatsPage> {
  const response = await fetchImpl(
    `/api/characters/${characterId}/chats?before=${encodeURIComponent(cursor)}`,
  )

  if (!response.ok) {
    throw await createApiError(response, 'Failed to load more chats')
  }

  const data = (await response.json()) as Partial<CharacterChatsPage>

  return {
    chats: Array.isArray(data.chats) ? data.chats : [],
    hasMore: Boolean(data.hasMore),
    nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
  }
}

export async function fetchCharacterChatExport(
  chatId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetchImpl(`/api/chats/${chatId}/export`)

  if (!response.ok) {
    throw await createApiError(response, 'Export failed')
  }

  return {
    blob: await response.blob(),
    filename: getExportFilename(response.headers.get('Content-Disposition')),
  }
}

export async function importCharacterChat(
  characterId: string,
  file: File,
  title?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatImportResult> {
  const formData = new FormData()
  formData.set('file', file)
  if (title?.trim()) {
    formData.set('title', title.trim())
  }

  const response = await fetchImpl(`/api/characters/${characterId}/chats/import`, {
    method: 'POST',
    body: formData,
  })

  const data = (await response.json().catch(() => null)) as Partial<ChatImportResult> | null
  if (!response.ok) {
    return {
      success: false,
      error: typeof data?.error === 'string' ? data.error : 'Import failed',
    }
  }

  return {
    success: data?.success === true,
    chatId: typeof data?.chatId === 'string' ? data.chatId : undefined,
    messageCount: typeof data?.messageCount === 'number' ? data.messageCount : undefined,
    error: typeof data?.error === 'string' ? data.error : undefined,
    warnings: Array.isArray(data?.warnings) ? data.warnings.filter(isString) : undefined,
  }
}

export function getExportFilename(contentDisposition: string | null) {
  if (!contentDisposition) {
    return 'chat_export.json'
  }

  const match = contentDisposition.match(/filename="(.+)"/)
  if (!match) {
    return 'chat_export.json'
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
