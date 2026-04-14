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

import { GoogleAICacheManager, type CachedContent } from '@google/generative-ai/server'
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
const DEFAULT_CACHE_TTL_SECONDS = 20
const GOOGLE_CACHE_DEBUG_ENABLED = process.env.GOOGLE_CACHE_DEBUG === 'true'

function logGoogleCacheDebug(...args: unknown[]): void {
  if (GOOGLE_CACHE_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getCachedTokenCount(cache: CachedContent): number {
  const usageMetadata = Reflect.get(cache, 'usageMetadata')

  if (!isRecord(usageMetadata) || typeof usageMetadata.totalTokenCount !== 'number') {
    return 0
  }

  return usageMetadata.totalTokenCount
}

export interface GoogleCacheConfig {
  apiKey: string
  modelName: string
  systemPrompt: string
  /** Messages to cache (excluding the last one) */
  messagesToCache: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Cache TTL in seconds (default: 20) */
  ttlSeconds?: number
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
    ttlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  } = config

  try {
    const cacheManager = new GoogleAICacheManager(apiKey)

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
