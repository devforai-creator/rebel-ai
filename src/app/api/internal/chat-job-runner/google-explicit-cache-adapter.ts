import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import {
  buildGoogleCachedProviderOptions,
  buildGoogleExplicitCacheRequestContract,
  createGoogleCache,
  isGoogleExplicitCacheEnabled,
  resolveGoogleCacheDecision,
  type CreateGoogleCacheResult,
  type GoogleConversationMessage,
  type GoogleExplicitCacheRequestContract,
} from '@/lib/llm/google-cache'
import type { SerializableFunctionToolContract } from '@/lib/llm/function-tool-contract'

type GoogleCacheDecision = ReturnType<typeof resolveGoogleCacheDecision>

function buildGoogleConversationMessages(
  recentMessages: SanitizedMessage[],
): GoogleConversationMessage[] {
  return recentMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

export type GoogleExplicitCachePreparation = {
  googleExplicitCacheEnabled: boolean
  googleCacheDecision: GoogleCacheDecision | null
  googleCacheResult: CreateGoogleCacheResult | null
  disabledForToolUsePreflight: boolean
  disabledForCompatibilityRetry: boolean
  requestContract: GoogleExplicitCacheRequestContract
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
  toolContract,
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
  toolContract?: SerializableFunctionToolContract | null
  toolCapableInvocation: boolean
  disableGoogleExplicitCache?: boolean
  jobId: string
  timings: Record<string, number>
  logDebug?: (...args: unknown[]) => void
}): Promise<GoogleExplicitCachePreparation> {
  const googleConversationMessages = buildGoogleConversationMessages(recentMessages)
  const requestContract = buildGoogleExplicitCacheRequestContract({
    systemPrompt,
    messages: googleConversationMessages,
    providerOptions,
    toolContract,
  })
  const lastMessage = requestContract.liveRequestTail.messages[0] ?? null

  const googleCacheDecision = resolveGoogleCacheDecision({
    modelName,
    systemPrompt: requestContract.cacheCreateInput.systemPrompt,
    messagesToCache: requestContract.cacheCreateInput.messagesToCache,
  })

  const googleExplicitCacheConfigured = isGoogleExplicitCacheEnabled()
  const hasCacheableToolContract = !!(
    requestContract.cacheCreateInput.toolContract &&
    requestContract.cacheCreateInput.toolContract.tools.length > 0
  )
  const disabledForToolUsePreflight =
    googleExplicitCacheConfigured &&
    !disableGoogleExplicitCache &&
    toolCapableInvocation &&
    !hasCacheableToolContract
  const googleExplicitCacheEnabled =
    googleExplicitCacheConfigured && !disableGoogleExplicitCache && !disabledForToolUsePreflight

  if (disabledForToolUsePreflight) {
    logDebug('[Chat Job Runner] Google explicit cache disabled before request build', {
      jobId,
      modelName,
      reason: 'tool-compatible invocation without cacheable tool contract',
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
      systemPrompt: requestContract.cacheCreateInput.systemPrompt,
      messagesToCache: requestContract.cacheCreateInput.messagesToCache,
      toolContract: requestContract.cacheCreateInput.toolContract,
      ttlSeconds: 20,
    })
    timings['7c_google_cache_create'] = performance.now() - googleCacheCreateStart

    if (googleCacheResult.success) {
      streamRequestOverride = {
        messages: requestContract.liveRequestTail.messages,
        providerOptions: buildGoogleCachedProviderOptions({
          providerOptions: requestContract.liveRequestTail.providerOptions,
          cacheName: googleCacheResult.cacheName,
          cachedContentOwnsRequestContract: hasCacheableToolContract,
        }),
      }
      cacheDebugInfo = {
        systemPrompt,
        cacheName: googleCacheResult.cacheName,
        cachedTokenCount: googleCacheResult.cachedTokenCount,
        messagesToCache: requestContract.cacheCreateInput.messagesToCache,
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
    requestContract,
    streamRequestOverride,
    cacheDebugInfo,
  }
}
