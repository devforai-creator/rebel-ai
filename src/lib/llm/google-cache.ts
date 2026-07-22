/**
 * Google Gemini Explicit Context Caching
 *
 * Pre-creates a cache with system prompt and conversation history,
 * then uses the cache ID for subsequent requests.
 *
 * Pricing (as of 2025-01):
 * - Cache creation: Possibly free for Google AI (not Vertex AI)
 * - Cache read: 10% of input price (90% discount)
 * - Storage: $4.50/1M tokens/hour
 *
 * Policy via environment variable:
 * - GOOGLE_EXPLICIT_CACHE_MODE=auto enables the current explicit-cache strategy
 * - GOOGLE_EXPLICIT_CACHE_MODE=off disables it
 * - Default: off when unset
 *
 * @see https://ai.google.dev/gemini-api/docs/caching
 * @see https://ai.google.dev/api/caching
 */

import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider'
import {
  GoogleAICacheManager,
  type CachedContent,
  FunctionCallingMode,
  type FunctionDeclarationSchema,
  type Tool,
  type ToolConfig,
} from '@google/generative-ai/server'
import { getModelFeatures } from '@/lib/models'
import type {
  SerializableFunctionToolChoice,
  SerializableFunctionToolContract,
} from './function-tool-contract'
import { resolveProviderCacheMode } from './cache-mode'

/**
 * Check if Google explicit caching is enabled via environment variable
 * Default: false when the mode is unset
 */
export function isGoogleExplicitCacheEnabled(): boolean {
  return (
    resolveProviderCacheMode({
      modeEnvName: 'GOOGLE_EXPLICIT_CACHE_MODE',
      legacyEnvNames: ['GOOGLE_EXPLICIT_CACHE_ENABLED'],
    }) === 'auto'
  )
}

/** Minimum token thresholds for caching (Google's requirement) */
const MIN_TOKENS_FLASH = 1024
const MIN_TOKENS_PRO = 4096

/** Default cache TTL in seconds (matches 부엉's strategy) */
const DEFAULT_CACHE_TTL_SECONDS = 60
const GOOGLE_CACHE_DEBUG_ENABLED = process.env.GOOGLE_CACHE_DEBUG === 'true'
const GOOGLE_CACHED_CONTENT_OWNS_REQUEST_CONTRACT_PROVIDER_OPTION =
  'rebelCachedContentOwnsRequestContract'

function logGoogleCacheDebug(...args: unknown[]): void {
  if (GOOGLE_CACHE_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEmptyObjectSchema(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.type === 'object' &&
    (!isRecord(value.properties) || Object.keys(value.properties).length === 0) &&
    value.additionalProperties !== true
  )
}

function getCachedTokenCount(cache: CachedContent): number {
  const usageMetadata = Reflect.get(cache, 'usageMetadata')

  if (!isRecord(usageMetadata) || typeof usageMetadata.totalTokenCount !== 'number') {
    return 0
  }

  return usageMetadata.totalTokenCount
}

function getGoogleProviderOptions(
  providerOptions: SharedV2ProviderOptions | undefined,
): Record<string, unknown> | null {
  const googleOptions = providerOptions?.google

  return googleOptions && typeof googleOptions === 'object'
    ? (googleOptions as Record<string, unknown>)
    : null
}

function normalizeGoogleCacheCreateToolContract(
  toolContract?: SerializableFunctionToolContract | null,
): SerializableFunctionToolContract | null {
  if (!toolContract || toolContract.tools.length === 0) {
    return toolContract ?? null
  }

  return {
    ...toolContract,
    // Cached Google tool turns keep function calling in AUTO mode. The live
    // request must not mutate toolConfig when cachedContent owns the contract.
    toolChoice: { type: 'auto' },
  }
}

export function splitGoogleConversationMessagesForExplicitCache(
  messages: GoogleConversationMessage[],
): {
  messagesToCache: GoogleConversationMessage[]
  lastMessage: GoogleConversationMessage | null
} {
  return {
    messagesToCache: messages.length > 1 ? messages.slice(0, -1) : [],
    lastMessage: messages.length > 0 ? messages[messages.length - 1] : null,
  }
}

export function buildGoogleCachedProviderOptions({
  providerOptions,
  cacheName,
  cachedContentOwnsRequestContract = false,
}: {
  providerOptions: SharedV2ProviderOptions | undefined
  cacheName: string
  cachedContentOwnsRequestContract?: boolean
}): SharedV2ProviderOptions | undefined {
  const googleOptions = getGoogleProviderOptions(providerOptions)

  return {
    ...(providerOptions ?? {}),
    google: {
      ...(googleOptions ?? {}),
      cachedContent: cacheName,
      ...(cachedContentOwnsRequestContract
        ? { [GOOGLE_CACHED_CONTENT_OWNS_REQUEST_CONTRACT_PROVIDER_OPTION]: true }
        : {}),
    },
  }
}

export function googleCachedContentOwnsRequestContract(
  providerOptions: SharedV2ProviderOptions | undefined,
): boolean {
  const googleOptions = getGoogleProviderOptions(providerOptions)

  return (
    !!googleOptions &&
    typeof googleOptions.cachedContent === 'string' &&
    googleOptions.cachedContent.length > 0 &&
    googleOptions[GOOGLE_CACHED_CONTENT_OWNS_REQUEST_CONTRACT_PROVIDER_OPTION] === true
  )
}

export function stripGoogleCachedRequestContractMarker(
  providerOptions: SharedV2ProviderOptions | undefined,
): SharedV2ProviderOptions | undefined {
  const googleOptions = getGoogleProviderOptions(providerOptions)

  if (
    !googleOptions ||
    !(GOOGLE_CACHED_CONTENT_OWNS_REQUEST_CONTRACT_PROVIDER_OPTION in googleOptions)
  ) {
    return providerOptions
  }

  const sanitizedGoogleOptions = { ...googleOptions }
  delete sanitizedGoogleOptions[GOOGLE_CACHED_CONTENT_OWNS_REQUEST_CONTRACT_PROVIDER_OPTION]

  return {
    ...(providerOptions ?? {}),
    google: sanitizedGoogleOptions as Record<string, JSONValue>,
  }
}

export function buildGoogleExplicitCacheRequestContract({
  systemPrompt,
  messages,
  providerOptions,
  toolContract,
}: {
  systemPrompt: string
  messages: GoogleConversationMessage[]
  providerOptions?: SharedV2ProviderOptions
  toolContract?: SerializableFunctionToolContract | null
}): GoogleExplicitCacheRequestContract {
  const normalizedToolContract = toolContract ?? null
  const cacheCreateToolContract = normalizeGoogleCacheCreateToolContract(normalizedToolContract)
  const { messagesToCache, lastMessage } = splitGoogleConversationMessagesForExplicitCache(messages)

  return {
    canonicalRequest: {
      systemPrompt,
      messages,
      providerOptions,
      toolContract: normalizedToolContract,
    },
    cacheCreateInput: {
      systemPrompt,
      messagesToCache,
      toolContract: cacheCreateToolContract,
    },
    liveRequestTail: {
      messages: lastMessage ? [lastMessage] : [],
      providerOptions,
      toolContract: normalizedToolContract,
    },
  }
}

function buildGoogleCacheToolConfig(
  toolChoice?: SerializableFunctionToolChoice,
): ToolConfig | undefined {
  switch (toolChoice?.type) {
    case 'none':
      return {
        functionCallingConfig: {
          mode: FunctionCallingMode.NONE,
        },
      }
    case 'required':
      return {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
        },
      }
    case 'tool':
      return {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          allowedFunctionNames: [toolChoice.toolName],
        },
      }
    case 'auto':
    default:
      return {
        functionCallingConfig: {
          mode: FunctionCallingMode.AUTO,
        },
      }
  }
}

function convertJSONSchemaToGoogleOpenAPISchema(
  jsonSchema: unknown,
  isRoot = true,
): Record<string, unknown> | undefined {
  if (jsonSchema == null) {
    return undefined
  }

  if (isEmptyObjectSchema(jsonSchema)) {
    if (isRoot) {
      return undefined
    }

    return typeof jsonSchema.description === 'string'
      ? { type: 'object', description: jsonSchema.description }
      : { type: 'object' }
  }

  if (typeof jsonSchema === 'boolean') {
    return { type: 'boolean', properties: {} }
  }

  if (!isRecord(jsonSchema)) {
    return undefined
  }

  const result: Record<string, unknown> = {}

  if (typeof jsonSchema.description === 'string') {
    result.description = jsonSchema.description
  }

  if (Array.isArray(jsonSchema.required)) {
    result.required = jsonSchema.required
  }

  if (typeof jsonSchema.format === 'string') {
    result.format = jsonSchema.format
  }

  if ('const' in jsonSchema && jsonSchema.const !== undefined) {
    result.enum = [jsonSchema.const]
  }

  if (jsonSchema.type) {
    if (Array.isArray(jsonSchema.type)) {
      const hasNull = jsonSchema.type.includes('null')
      const nonNullTypes = jsonSchema.type.filter((type) => type !== 'null')

      if (nonNullTypes.length === 0) {
        result.type = 'null'
      } else {
        result.anyOf = nonNullTypes.map((type) => ({ type }))
        if (hasNull) {
          result.nullable = true
        }
      }
    } else {
      result.type = jsonSchema.type
    }
  }

  if (Array.isArray(jsonSchema.enum)) {
    result.enum = jsonSchema.enum
  }

  if (isRecord(jsonSchema.properties)) {
    result.properties = Object.entries(jsonSchema.properties).reduce<Record<string, unknown>>(
      (acc, [key, value]) => {
        acc[key] = convertJSONSchemaToGoogleOpenAPISchema(value, false)
        return acc
      },
      {},
    )
  }

  if (jsonSchema.items) {
    result.items = Array.isArray(jsonSchema.items)
      ? jsonSchema.items.map((item) => convertJSONSchemaToGoogleOpenAPISchema(item, false))
      : convertJSONSchemaToGoogleOpenAPISchema(jsonSchema.items, false)
  }

  if (Array.isArray(jsonSchema.allOf)) {
    result.allOf = jsonSchema.allOf.map((item) =>
      convertJSONSchemaToGoogleOpenAPISchema(item, false),
    )
  }

  if (Array.isArray(jsonSchema.anyOf)) {
    const hasNullSchema = jsonSchema.anyOf.some(
      (schema) => isRecord(schema) && schema.type === 'null',
    )

    if (hasNullSchema) {
      const nonNullSchemas = jsonSchema.anyOf.filter(
        (schema) => !(isRecord(schema) && schema.type === 'null'),
      )

      if (nonNullSchemas.length === 1) {
        const converted = convertJSONSchemaToGoogleOpenAPISchema(nonNullSchemas[0], false)
        if (converted) {
          result.nullable = true
          Object.assign(result, converted)
        }
      } else {
        result.anyOf = nonNullSchemas.map((item) =>
          convertJSONSchemaToGoogleOpenAPISchema(item, false),
        )
        result.nullable = true
      }
    } else {
      result.anyOf = jsonSchema.anyOf.map((item) =>
        convertJSONSchemaToGoogleOpenAPISchema(item, false),
      )
    }
  }

  if (Array.isArray(jsonSchema.oneOf)) {
    result.oneOf = jsonSchema.oneOf.map((item) =>
      convertJSONSchemaToGoogleOpenAPISchema(item, false),
    )
  }

  if (typeof jsonSchema.minLength === 'number') {
    result.minLength = jsonSchema.minLength
  }

  return result
}

function buildGoogleCacheCreateToolPayload({
  toolContract,
}: {
  toolContract?: SerializableFunctionToolContract | null
}): {
  tools?: Tool[]
  toolConfig?: ToolConfig
} {
  if (!toolContract || toolContract.tools.length === 0) {
    return {}
  }

  return {
    tools: [
      {
        functionDeclarations: toolContract.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: convertJSONSchemaToGoogleOpenAPISchema(tool.inputSchema) as
            | FunctionDeclarationSchema
            | undefined,
        })),
      },
    ],
    toolConfig: buildGoogleCacheToolConfig(toolContract.toolChoice),
  }
}

export interface GoogleCacheConfig {
  apiKey: string
  modelName: string
  systemPrompt: string
  /** Messages to cache (excluding the last one) */
  messagesToCache: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Serializable function-tool contract owned at cache-create time. */
  toolContract?: SerializableFunctionToolContract | null
  /** Cache TTL in seconds (default: 20) */
  ttlSeconds?: number
}

export type GoogleConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type GoogleExplicitCacheLogicalRequest = {
  systemPrompt: string
  messages: GoogleConversationMessage[]
  providerOptions: SharedV2ProviderOptions | undefined
  toolContract: SerializableFunctionToolContract | null
}

export type GoogleExplicitCacheRequestContract = {
  canonicalRequest: GoogleExplicitCacheLogicalRequest
  cacheCreateInput: {
    systemPrompt: string
    messagesToCache: GoogleConversationMessage[]
    toolContract: SerializableFunctionToolContract | null
  }
  liveRequestTail: {
    messages: GoogleConversationMessage[]
    providerOptions: SharedV2ProviderOptions | undefined
    toolContract: SerializableFunctionToolContract | null
  }
}

export interface GoogleCacheResult {
  success: true
  cacheName: string
  cachedTokenCount: number
  /** Actual expiration time returned by Google API (ISO string) */
  expireTime?: string
  /** Actual TTL returned by Google API (e.g., "3600s") */
  ttl?: string
}

export interface GoogleCacheError {
  success: false
  error: string
  code?: string
}

export type CreateGoogleCacheResult = GoogleCacheResult | GoogleCacheError

/**
 * Determines if a model supports explicit caching and returns minimum token requirement
 */
export function getGoogleCacheMinTokens(modelName: string): number | null {
  const configuredMinTokens = getModelFeatures({
    provider: 'google',
    modelName,
  })?.promptCacheMinTokens
  if (typeof configuredMinTokens === 'number') {
    return configuredMinTokens
  }

  const lowerModel = modelName.toLowerCase()

  // Flash models: 1024 minimum
  if (lowerModel.includes('flash')) {
    return MIN_TOKENS_FLASH
  }

  // Pro models: 4096 minimum
  if (lowerModel.includes('pro')) {
    return MIN_TOKENS_PRO
  }

  // Unknown model - don't cache
  return null
}

/**
 * Estimates token count for caching decision
 * (Simple heuristic: ~3 chars per token for English/Korean mixed content)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

/**
 * Checks if the content meets minimum token requirements for caching
 */
export function shouldCreateGoogleCache(
  modelName: string,
  systemPrompt: string,
  messagesToCache: Array<{ role: string; content: string }>,
): boolean {
  const minTokens = getGoogleCacheMinTokens(modelName)
  if (minTokens === null) {
    return false
  }

  const systemTokens = estimateTokens(systemPrompt)
  const messageTokens = messagesToCache.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
  const totalTokens = systemTokens + messageTokens

  return totalTokens >= minTokens
}

/**
 * Creates a Google AI context cache
 *
 * @returns Cache name on success, or error details on failure
 */
export async function createGoogleCache(
  config: GoogleCacheConfig,
): Promise<CreateGoogleCacheResult> {
  const {
    apiKey,
    modelName,
    systemPrompt,
    messagesToCache,
    toolContract,
    ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  } = config

  try {
    const cacheManager = new GoogleAICacheManager(apiKey)
    const cacheToolPayload = buildGoogleCacheCreateToolPayload({ toolContract })

    // Build contents array for caching
    // Note: systemInstruction is separate from contents
    const contents = messagesToCache.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    // Resolve full model name (Google API expects "models/gemini-..." format)
    const fullModelName = modelName.startsWith('models/') ? modelName : `models/${modelName}`

    const cache: CachedContent = await cacheManager.create({
      model: fullModelName,
      systemInstruction: {
        role: 'user', // Required by API but ignored for system instruction
        parts: [{ text: systemPrompt }],
      },
      contents,
      ...cacheToolPayload,
      ttlSeconds,
    })

    if (!cache.name) {
      return {
        success: false,
        error: 'Cache created but no name returned',
      }
    }

    const cachedTokenCount = getCachedTokenCount(cache)

    // Log actual TTL for debugging storage costs
    logGoogleCacheDebug('[Google Cache] Cache created', {
      cacheName: cache.name,
      requestedTtlSeconds: ttlSeconds,
      actualTtl: cache.ttl,
      expireTime: cache.expireTime,
      cachedTokenCount,
    })

    return {
      success: true,
      cacheName: cache.name,
      cachedTokenCount,
      expireTime: cache.expireTime,
      ttl: cache.ttl,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: string })?.code

    console.warn('[Google Cache] Failed to create cache', {
      modelName,
      error: message,
      code,
    })

    return {
      success: false,
      error: message,
      code,
    }
  }
}

/**
 * Resolves Google cache decision based on model and content size
 */
export function resolveGoogleCacheDecision({
  modelName,
  systemPrompt,
  messagesToCache,
}: {
  modelName: string
  systemPrompt: string
  messagesToCache: Array<{ role: string; content: string }>
}): { enabled: boolean; minTokens: number | null } {
  const minTokens = getGoogleCacheMinTokens(modelName)
  const enabled = shouldCreateGoogleCache(modelName, systemPrompt, messagesToCache)

  return { enabled, minTokens }
}
