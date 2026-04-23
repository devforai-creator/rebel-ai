import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import {
  createGoogleCache,
  isGoogleExplicitCacheEnabled,
  resolveGoogleCacheDecision,
  type CreateGoogleCacheResult,
} from '@/lib/llm/google-cache'

type GoogleConversationMessage = { role: 'user' | 'assistant'; content: string }
type GoogleCacheDecision = ReturnType<typeof resolveGoogleCacheDecision>

function buildGoogleConversationMessages(
  recentMessages: SanitizedMessage[],
): GoogleConversationMessage[] {
  return recentMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function splitGoogleConversationMessagesForExplicitCache(messages: GoogleConversationMessage[]): {
  messagesToCache: GoogleConversationMessage[]
  lastMessage: GoogleConversationMessage | null
} {
  return {
    messagesToCache: messages.length > 1 ? messages.slice(0, -1) : [],
    lastMessage: messages.length > 0 ? messages[messages.length - 1] : null,
  }
}

function buildGoogleCachedProviderOptions({
  providerOptions,
  cacheName,
}: {
  providerOptions: SharedV2ProviderOptions | undefined
  cacheName: string
}): SharedV2ProviderOptions | undefined {
  return {
    ...(providerOptions ?? {}),
    google: {
      ...((providerOptions?.google as Record<string, unknown>) || {}),
      cachedContent: cacheName,
    },
  }
}

export type GoogleExplicitCachePreparation = {
  googleExplicitCacheEnabled: boolean
  googleCacheDecision: GoogleCacheDecision | null
  googleCacheResult: CreateGoogleCacheResult | null
  disabledForToolUsePreflight: boolean
  disabledForCompatibilityRetry: boolean
  streamRequestOverride: {
    messages: GoogleConversationMessage[]
    providerOptions: SharedV2ProviderOptions | undefined
  } | null
  cacheDebugInfo: {
    systemPrompt: string
    cacheName: string
    cachedTokenCount: number
    messagesToCache: GoogleConversationMessage[]
  } | null
}

export async function prepareGoogleExplicitCache({
  apiKey,
  modelName,
  systemPrompt,
  recentMessages,
  providerOptions,
  toolCapableInvocation,
  disableGoogleExplicitCache = false,
  jobId,
  timings,
  logDebug = () => undefined,
}: {
  apiKey: string
  modelName: string
  systemPrompt: string
  recentMessages: SanitizedMessage[]
  providerOptions?: SharedV2ProviderOptions
  toolCapableInvocation: boolean
  disableGoogleExplicitCache?: boolean
  jobId: string
  timings: Record<string, number>
  logDebug?: (...args: unknown[]) => void
}): Promise<GoogleExplicitCachePreparation> {
  const googleConversationMessages = buildGoogleConversationMessages(recentMessages)
  const { messagesToCache, lastMessage } = splitGoogleConversationMessagesForExplicitCache(
    googleConversationMessages,
  )

  const googleCacheDecision = resolveGoogleCacheDecision({
    modelName,
    systemPrompt,
    messagesToCache,
  })

  const googleExplicitCacheConfigured = isGoogleExplicitCacheEnabled()
  const disabledForToolUsePreflight =
    googleExplicitCacheConfigured && !disableGoogleExplicitCache && toolCapableInvocation
  const googleExplicitCacheEnabled =
    googleExplicitCacheConfigured && !disableGoogleExplicitCache && !disabledForToolUsePreflight

  if (disabledForToolUsePreflight) {
    logDebug('[Chat Job Runner] Google explicit cache disabled before request build', {
      jobId,
      modelName,
      reason: 'tool-compatible invocation',
    })
  }

  if (disableGoogleExplicitCache) {
    logDebug('[Chat Job Runner] Google explicit cache disabled for compatibility retry', {
      jobId,
      modelName,
    })
  }

  let googleCacheResult: CreateGoogleCacheResult | null = null
  let streamRequestOverride: GoogleExplicitCachePreparation['streamRequestOverride'] = null
  let cacheDebugInfo: GoogleExplicitCachePreparation['cacheDebugInfo'] = null

  if (googleExplicitCacheEnabled && googleCacheDecision.enabled && lastMessage) {
    const googleCacheCreateStart = performance.now()
    googleCacheResult = await createGoogleCache({
      apiKey,
      modelName,
      systemPrompt,
      messagesToCache,
      ttlSeconds: 20,
    })
    timings['7c_google_cache_create'] = performance.now() - googleCacheCreateStart

    if (googleCacheResult.success) {
      streamRequestOverride = {
        messages: [lastMessage],
        providerOptions: buildGoogleCachedProviderOptions({
          providerOptions,
          cacheName: googleCacheResult.cacheName,
        }),
      }
      cacheDebugInfo = {
        systemPrompt,
        cacheName: googleCacheResult.cacheName,
        cachedTokenCount: googleCacheResult.cachedTokenCount,
        messagesToCache,
      }

      logDebug('[Chat Job Runner] Google explicit caching enabled', {
        cacheName: googleCacheResult.cacheName,
        cachedTokenCount: googleCacheResult.cachedTokenCount,
        lastMessageRole: lastMessage.role,
      })
    } else {
      console.warn(
        '[Chat Job Runner] Google cache creation failed, falling back to normal request',
        {
          error: googleCacheResult.error,
          code: googleCacheResult.code,
          modelName,
        },
      )
    }
  }

  return {
    googleExplicitCacheEnabled,
    googleCacheDecision,
    googleCacheResult,
    disabledForToolUsePreflight,
    disabledForCompatibilityRetry: disableGoogleExplicitCache,
    streamRequestOverride,
    cacheDebugInfo,
  }
}
