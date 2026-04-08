import type { Message, ApiKey } from '@/types/database.types'
import type { ChatModelConfig } from '@/lib/chat/model-config'

/**
 * Display-optimized message type for UI rendering
 */
export type DisplayMessage = {
  id: string
  role: Message['role']
  content: string
  chat_id?: string
  sequence?: number | null
  model_used?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  created_at?: string
  debug_info?: unknown
  temp?: boolean
}

/**
 * Token usage statistics for the latest message
 */
export type LatestMessageTokenStats = {
  id: string | null
  createdAt: string | null
  total: number | null
  prompt: number | null
  completion: number | null
  cachedPrompt: number | null
  cacheHit: boolean
  cacheKey: string | null
  cacheRetention: string | null
  costUsd: number | null
  promptCostUsd: number | null
  completionCostUsd: number | null
  cachedPromptCostUsd: number | null
  reasoningCostUsd: number | null
}

/**
 * Realtime message change payload from Supabase
 */
export type MessageChangePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Partial<Message> | null
  old: Partial<Message> | null
}

/**
 * Module regex entry type from character modules
 */
export interface ModuleRegexEntry {
  type: string
  comment: string
  in: string
  out: string
  ableFlag: boolean
  /** Capture group → variable name mapping. Only used with type: "extract". */
  bindings?: Record<string, string>
  /** Named inline card reference. When present, resolves against character.metadata.ui_cards. */
  card_ref?: string
}

export type InlineUiCardRegistry = Record<string, Record<string, unknown>>

export type ModuleAssetSummary = {
  moduleId: string
  moduleName: string | null
  assetCount: number
  expectedAssetCount: number
}

/**
 * API key option for dropdown selection
 */
export type ApiKeyOption = Pick<
  ApiKey,
  'id' | 'key_name' | 'provider' | 'model_preference' | 'service_tier'
>

/**
 * Debug information stored with assistant messages
 */
export interface DebugInfo {
  fullPrompt?: {
    system?: string
    messages?: Array<{ role: string; content: string }>
    anthropicConversationMessages?: Array<{ role: string; content: string }> | null
    anthropicPlaceholderAdded?: boolean
  }
  rawResponse?: string
  modelConfig?: {
    apiKeyId?: string
    provider?: string
    modelName?: string
    finishReason?: string
    usage?: {
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
      cachedInputTokens?: number
      reasoningTokens?: number
    }
  }
  promptCache?: {
    key?: string
    retention?: string
    totalInputTokens?: number
  }
  anthropicCache?: {
    enabled?: boolean
    ttl?: string
    minTokens?: number
    staticPromptTokens?: number
    estimatedMeetsMinTokens?: boolean
    dynamicContextTokens?: number
    cacheCreationInputTokens?: number | null
    cacheReadInputTokens?: number | null
  }
  googleCache?: {
    featureEnabled?: boolean
    cacheCreated?: boolean
    cacheName?: string | null
    cachedTokenCount?: number
    expireTime?: string | null
    actualTtl?: string | null
    error?: string | null
    minTokens?: number | null
    meetsMinTokens?: boolean
  }
  actualPayload?: {
    provider: string
    strategy: 'anthropic-split-system' | 'google-explicit-cache' | 'default'
    systemMessages?: Array<{ role: string; content: string; cached?: boolean }>
    conversationMessages?: Array<{ role: string; content: string }>
    cache?: {
      systemPrompt?: string
      cacheName?: string
      cachedTokenCount?: number
      messagesToCache?: Array<{ role: string; content: string }>
    }
  }
  cacheHit?: boolean
  timestamp?: string
  rag?: {
    enabled: boolean
    threshold: number
    topK: number
    results: Array<{
      seq: string
      similarity: number
      preview: string
    }>
  }
}

/**
 * Character data passed to ChatInterface
 */
export interface ChatCharacter {
  name: string
  avatar_url: string | null
  metadata: Record<string, unknown> | null
}

/**
 * Character asset data
 */
export interface ChatCharacterAsset {
  id: string
  file_name: string
  storage_path: string
  display_name?: string | null
  canonical_name?: string | null
  display_order?: number | null
  metadata: Record<string, unknown> | null
}

/**
 * Asset data loaded client-side to reduce SSR payload
 */
export interface ChatAssetData {
  characterAssets: ChatCharacterAsset[]
  assetUrlMap: Record<string, string>
  imageCommandUrlMap: Record<string, string>
  moduleRegex: ModuleRegexEntry[]
  moduleAssetSummary: ModuleAssetSummary[]
  globalVariables?: Record<string, unknown>
}

/**
 * Props for the main ChatInterface component
 */
export interface ChatInterfaceProps {
  chatId: string
  initialMessages: Message[]
  apiKeys: ApiKeyOption[]
  preselectedApiKeyId?: string
  initialModelConfig?: ChatModelConfig | null
  initialUsageStats: LatestMessageTokenStats | null
  character: ChatCharacter
  initialHistoryCursor: number | null
  hasMoreHistory: boolean
  isDeveloper?: boolean
}

/**
 * Map a database Message to DisplayMessage
 */
export function mapMessageToDisplay(message: Message): DisplayMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    chat_id: message.chat_id,
    sequence: message.sequence,
    model_used: message.model_used,
    prompt_tokens: message.prompt_tokens,
    completion_tokens: message.completion_tokens,
    created_at: message.created_at,
    debug_info: (message as Message & { debug_info?: unknown }).debug_info,
  }
}

/**
 * Build sanitized messages array for API request
 */
export function buildSanitizedMessages(
  history: Message[],
  current: DisplayMessage[],
): Array<{ role: 'user' | 'assistant'; content: string; messageId: string | null }> {
  const historyDisplay = history.map(mapMessageToDisplay)
  return [...historyDisplay, ...current]
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      messageId: msg.temp ? null : msg.id,
    }))
}
