/**
 * Compatibility-only RisuAI <-> RebelAI chat conversion utilities.
 *
 * Keep this module for archived chat import/export and migration workflows.
 * It is not part of the first-class RBX/SUU product surface.
 */

import type {
  RisuChat,
  RisuMessage,
  RebelMessage,
  ChatExportMetadata,
  RebelSummary,
  RebelFact,
  RebelAIExtension,
} from '@/types/risu-chat'

/**
 * RebelAI extension data (summaries, facts)
 */
interface RebelAIExportData {
  summaries?: RebelSummary[]
  facts?: RebelFact[]
}

/**
 * Convert RebelAI messages to RisuAI format
 */
export function toRisuFormat(
  messages: RebelMessage[],
  metadata?: ChatExportMetadata,
  rebelaiData?: RebelAIExportData,
): RisuChat {
  const risuMessages: RisuMessage[] = messages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg, index) => {
      const baseMessage: RisuMessage = {
        role: msg.role === 'assistant' ? 'char' : 'user',
        data: msg.content,
        time: msg.created_at ? new Date(msg.created_at).getTime() : Date.now() + index,
        name: null,
        chatId: msg.id || crypto.randomUUID(),
      }

      // Add generationInfo to assistant messages
      if (msg.role === 'assistant') {
        baseMessage.saying = crypto.randomUUID()
        baseMessage.generationInfo = {
          model: msg.model_used || 'custom',
          generationId: crypto.randomUUID(),
          inputTokens: msg.prompt_tokens || 0,
          outputTokens: msg.completion_tokens || 0,
          maxContext: 100000,
        }
        baseMessage.promptInfo = {}
      }

      return baseMessage
    })

  // Generate chat name from metadata or default
  const chatName = metadata?.chatTitle || metadata?.characterName || 'Imported Chat'

  // Include RebelAI extension data only if summaries or facts exist
  let rebelaiExtension: RebelAIExtension | undefined
  if (rebelaiData && (rebelaiData.summaries?.length || rebelaiData.facts?.length)) {
    rebelaiExtension = {
      version: '0.9.x',
      summaries: rebelaiData.summaries || [],
      facts: rebelaiData.facts || [],
    }
  }

  return {
    type: 'risuChat',
    ver: 2,
    data: {
      message: risuMessages,
      note: '',
      name: chatName,
      localLore: [],
      fmIndex: 0,
      id: crypto.randomUUID(),
      ...(rebelaiExtension && { _rebelai: rebelaiExtension }),
    },
    folders: [],
  }
}

/**
 * Convert RisuAI format to RebelAI message array
 */
export function fromRisuFormat(risuChat: RisuChat): RebelMessage[] {
  if (!isValidRisuChat(risuChat)) {
    throw new Error('Invalid RisuAI chat format')
  }

  return risuChat.data.message.map((msg, index) => ({
    role: msg.role === 'char' ? 'assistant' : 'user',
    content: msg.data,
    sequence: index + 1,
    model_used: msg.generationInfo?.model || null,
    prompt_tokens: msg.generationInfo?.inputTokens || null,
    completion_tokens: msg.generationInfo?.outputTokens || null,
    created_at: new Date(msg.time || Date.now()).toISOString(),
  }))
}

/**
 * Validate RisuAI chat format
 */
export function isValidRisuChat(data: unknown): data is RisuChat {
  if (!data || typeof data !== 'object') {
    return false
  }

  const chat = data as Record<string, unknown>

  // Basic structure validation
  // Relaxed type check: consider valid if data.message exists even without type
  if (chat.type && chat.type !== 'risuChat') {
    // console.warn('[RisuConverter] Invalid type:', chat.type)
  }

  // Relaxed version check
  if (typeof chat.ver === 'number' && chat.ver < 1) {
    console.warn('[RisuConverter] Invalid version:', chat.ver)
    return false
  }

  if (!chat.data || typeof chat.data !== 'object') {
    console.warn('[RisuConverter] Missing data object')
    return false
  }

  const chatData = chat.data as Record<string, unknown>

  if (!Array.isArray(chatData.message)) {
    console.warn('[RisuConverter] message is not an array')
    return false
  }

  // Validate message array
  for (const [index, msg] of chatData.message.entries()) {
    if (!isValidRisuMessage(msg)) {
      console.warn(`[RisuConverter] Invalid message at index ${index}:`, msg)
      return false
    }
  }

  return true
}

/**
 * Validate RisuAI message
 */
function isValidRisuMessage(data: unknown): data is RisuMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const msg = data as Record<string, unknown>

  // Required field validation
  // Allow roles other than user/char (e.g., system) if structure is correct
  if (typeof msg.role !== 'string') {
    console.warn('[RisuConverter] Message missing role:', msg)
    return false
  }

  if (typeof msg.data !== 'string') {
    console.warn('[RisuConverter] Message missing data (content):', msg)
    return false
  }

  // Allow missing time field (use default value during conversion)
  // if (typeof msg.time !== 'number') {
  //   console.warn('[RisuConverter] Message missing time:', msg)
  //   return false
  // }

  return true
}

/**
 * Generate export filename
 */
export function generateExportFilename(characterName: string, chatTitle?: string): string {
  const sanitizedName = characterName.replace(/[^a-zA-Z0-9\u3131-\uD79D]/g, '_')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '')
  const suffix = chatTitle
    ? `_${chatTitle.slice(0, 20).replace(/[^a-zA-Z0-9\u3131-\uD79D]/g, '_')}`
    : ''

  return `${sanitizedName}${suffix}_${timestamp}_chat.json`
}

/**
 * Parse JSON string to RisuChat
 */
export function parseRisuChatJson(jsonString: string): RisuChat {
  let parsed: unknown

  try {
    parsed = JSON.parse(jsonString)
  } catch {
    throw new Error('Invalid JSON format')
  }

  if (!isValidRisuChat(parsed)) {
    throw new Error('Invalid RisuAI chat format: missing required fields')
  }

  return parsed
}

/**
 * Get message count (only valid user/char messages)
 */
export function getMessageCount(risuChat: RisuChat): number {
  return risuChat.data.message.filter((msg) => msg.role === 'user' || msg.role === 'char').length
}
