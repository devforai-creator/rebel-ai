type MessageId = string

type StreamChunkSource = AsyncIterable<string> | Iterable<string>

export interface PersistStreamedAssistantMessageParams {
  textStream: StreamChunkSource
  updateIntervalMs: number
  now?: () => number
  insertAssistantMessage: (chunk: string) => Promise<MessageId>
  updateAssistantMessage: (messageId: MessageId, content: string) => Promise<void>
  deleteAssistantMessage: (messageId: MessageId) => Promise<void>
}

export interface PersistStreamedAssistantMessageResult {
  fullText: string
  assistantMessageId: MessageId | null
  messageInsertDuration: number | null
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export async function persistStreamedAssistantMessage({
  textStream,
  updateIntervalMs,
  now = () => performance.now(),
  insertAssistantMessage,
  updateAssistantMessage,
  deleteAssistantMessage,
}: PersistStreamedAssistantMessageParams): Promise<PersistStreamedAssistantMessageResult> {
  let fullText = ''
  let assistantMessageId: MessageId | null = null
  let lastMessageUpdateAt = now()
  let messageInsertDuration: number | null = null
  let updateInFlight: Promise<void> | null = null
  let updateError: Error | null = null
  let queuedUpdateContent: string | null = null

  const enqueueMessageUpdate = (content: string) => {
    if (!assistantMessageId || updateError) {
      return
    }

    if (updateInFlight) {
      queuedUpdateContent = content
      return
    }

    const messageId = assistantMessageId
    const contentSnapshot = content
    updateInFlight = updateAssistantMessage(messageId, contentSnapshot)
      .catch((error) => {
        updateError = normalizeError(error)
      })
      .finally(() => {
        updateInFlight = null
        if (queuedUpdateContent && !updateError) {
          const nextContent = queuedUpdateContent
          queuedUpdateContent = null
          enqueueMessageUpdate(nextContent)
        } else {
          queuedUpdateContent = null
        }
      })
  }

  const flushMessageUpdates = async () => {
    if (!assistantMessageId) {
      return
    }

    if (updateError) {
      throw updateError
    }

    while (updateInFlight) {
      await updateInFlight
      if (updateError) {
        throw updateError
      }
    }
  }

  try {
    for await (const chunk of textStream) {
      if (updateError) {
        throw updateError
      }

      fullText += chunk

      if (!assistantMessageId) {
        const insertStart = now()
        assistantMessageId = await insertAssistantMessage(chunk)
        messageInsertDuration = now() - insertStart
        lastMessageUpdateAt = now()
        continue
      }

      const currentTime = now()
      if (currentTime - lastMessageUpdateAt >= updateIntervalMs) {
        enqueueMessageUpdate(fullText)
        lastMessageUpdateAt = currentTime
      }
    }

    if (assistantMessageId) {
      enqueueMessageUpdate(fullText)
      await flushMessageUpdates()
    }
  } catch (error) {
    if (assistantMessageId) {
      await deleteAssistantMessage(assistantMessageId)
    }
    throw error
  }

  return {
    fullText,
    assistantMessageId,
    messageInsertDuration,
  }
}
