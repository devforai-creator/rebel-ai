type ChatImportActionResult = {
  success: boolean
  chatId?: string
  messageCount?: number
  error?: string | null
}

type TextFileLike = {
  name: string
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

export async function submitChatImport<TFile extends TextFileLike>({
  characterId,
  selectedFile,
  chatTitle,
  importChatImpl,
}: {
  characterId: string
  selectedFile: TFile | null
  chatTitle: string
  importChatImpl: (
    characterId: string,
    file: TFile,
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
    const result = await importChatImpl(characterId, selectedFile, chatTitle || undefined)

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
