import { createApiError } from '@/lib/http/api-contract'
import type { CharacterChat } from './character-detail-types'

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
