type ChatImportActionResult = {
  success: boolean
  chatId?: string
  messageCount?: number
  error?: string | null
}

type TextFileLike = {
  name: string
  text: () => Promise<string>
}

export function deriveChatImportTitle(fileName: string) {
  return fileName.replace(/_chat\.json$/i, '').replace(/\.json$/i, '')
}

export function buildPendingImportedChat(
  result: Pick<ChatImportActionResult, 'chatId' | 'messageCount'>,
) {
  if (!result.chatId) {
    return null
  }

  return {
    chatId: result.chatId,
    messageCount: result.messageCount ?? 0,
  }
}

export function getChatImportErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to read file'
}

export async function submitChatImport({
  characterId,
  selectedFile,
  chatTitle,
  importChatImpl,
}: {
  characterId: string
  selectedFile: TextFileLike | null
  chatTitle: string
  importChatImpl: (
    characterId: string,
    content: string,
    title?: string,
  ) => Promise<ChatImportActionResult>
}) {
  if (!selectedFile) {
    return {
      ok: false as const,
      error: 'Please select a file',
    }
  }

  try {
    const content = await selectedFile.text()
    const result = await importChatImpl(characterId, content, chatTitle || undefined)

    if (!result.success) {
      return {
        ok: false as const,
        error: result.error || 'Import failed',
      }
    }

    return {
      ok: true as const,
      pendingImportedChat: buildPendingImportedChat(result),
    }
  } catch (error) {
    return {
      ok: false as const,
      error: getChatImportErrorMessage(error),
    }
  }
}
