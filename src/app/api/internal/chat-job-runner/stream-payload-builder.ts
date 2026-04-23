import type { CoreMessage } from 'ai'
import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { MemoryPromptBlock } from '@/lib/chat-memory'
import { buildAnthropicCacheControl } from '@/lib/llm/provider-options'
import type { AnthropicCacheDecision } from '@/lib/llm/prompt-cache'
import type { LlmProvider } from '@/types/database.types'
import type { ChatRunnerActualPayload } from './usage-debug'
import type { GoogleExplicitCachePreparation } from './google-explicit-cache-adapter'

type ConversationMessage = { role: 'user' | 'assistant'; content: string }

type StreamRequest = {
  system?: string
  messages: CoreMessage[]
  providerOptions?: SharedV2ProviderOptions
}

function buildDefaultStreamPayloadPlan({
  provider,
  finalSystemPrompt,
  recentMessages,
  providerOptions,
}: {
  provider: LlmProvider
  finalSystemPrompt: string
  recentMessages: SanitizedMessage[]
  providerOptions?: SharedV2ProviderOptions
}): StreamPayloadPlan {
  return {
    strategy: 'default',
    streamRequest: {
      system: finalSystemPrompt,
      messages: recentMessages,
      providerOptions,
    },
    actualPayload: {
      provider,
      strategy: 'default',
      systemMessages: [{ role: 'system', content: finalSystemPrompt }],
      conversationMessages: recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    },
  }
}

function buildAnthropicMessage(
  role: 'system' | 'user' | 'assistant',
  content: string,
  ttl?: AnthropicCacheDecision['ttl'],
): CoreMessage {
  if (!ttl) {
    return { role, content }
  }

  return {
    role,
    content,
    providerOptions: {
      anthropic: buildAnthropicCacheControl(ttl),
    },
  }
}

function withAnthropicAutomaticCaching(
  providerOptions: SharedV2ProviderOptions | undefined,
  anthropicCache: AnthropicCacheDecision | null,
): SharedV2ProviderOptions | undefined {
  if (!anthropicCache?.enabled) {
    return providerOptions
  }

  const anthropicOptions =
    (providerOptions?.anthropic as Record<string, JSONValue> | undefined) ?? {}

  return {
    ...(providerOptions ?? {}),
    anthropic: {
      ...anthropicOptions,
      ...buildAnthropicCacheControl(anthropicCache.ttl),
    },
  }
}

function findSystemBreakpointBeforeDynamicSuffix(promptBlocks: MemoryPromptBlock[]): number {
  let systemIndex = -1
  let lastStableSystemIndex = -1
  let sawDynamicSystemSuffix = false
  let hasCacheableLiveAfter = false

  for (const block of promptBlocks) {
    if (block.role === 'system') {
      systemIndex += 1

      if (!sawDynamicSystemSuffix) {
        if (block.cachePreference === 'avoid-cache') {
          sawDynamicSystemSuffix = true
        } else {
          lastStableSystemIndex = systemIndex
        }
      }

      continue
    }

    if (
      sawDynamicSystemSuffix &&
      block.stability === 'live' &&
      block.cachePreference !== 'avoid-cache'
    ) {
      hasCacheableLiveAfter = true
    }
  }

  if (!sawDynamicSystemSuffix || !hasCacheableLiveAfter) {
    return -1
  }

  return lastStableSystemIndex
}

type BuildStreamPayloadPlanArgs = {
  provider: LlmProvider
  finalSystemPrompt: string
  staticSystemPrompt: string
  dynamicContext: string | null
  anthropicCache: AnthropicCacheDecision | null
  anthropicConversationMessages: ConversationMessage[]
  promptBlocks: MemoryPromptBlock[]
  recentMessages: SanitizedMessage[]
  googleExplicitCache: GoogleExplicitCachePreparation | null
  providerOptions?: SharedV2ProviderOptions
}

export type StreamPayloadPlan = {
  strategy: 'anthropic-split-system' | 'google-explicit-cache' | 'default'
  streamRequest: StreamRequest
  actualPayload: ChatRunnerActualPayload
}

export function buildStreamPayloadPlan({
  provider,
  finalSystemPrompt,
  staticSystemPrompt,
  dynamicContext,
  anthropicCache,
  anthropicConversationMessages,
  promptBlocks,
  recentMessages,
  googleExplicitCache,
  providerOptions,
}: BuildStreamPayloadPlanArgs): StreamPayloadPlan {
  if (provider === 'anthropic') {
    if (promptBlocks.length > 0) {
      const systemBlocks = promptBlocks.filter((block) => block.role === 'system')
      const systemMessages: Array<{ role: string; content: string; cached?: boolean }> = []
      const conversationMessages: Array<{ role: string; content: string }> = []
      const messagesForAnthropic: CoreMessage[] = []
      const mergedProviderOptions = withAnthropicAutomaticCaching(providerOptions, anthropicCache)
      const explicitSystemBreakpointIndex = anthropicCache?.enabled
        ? findSystemBreakpointBeforeDynamicSuffix(promptBlocks)
        : -1

      for (const [index, block] of systemBlocks.entries()) {
        const isExplicitBreakpoint = index === explicitSystemBreakpointIndex

        messagesForAnthropic.push(
          buildAnthropicMessage(
            'system',
            block.content,
            isExplicitBreakpoint ? anthropicCache?.ttl : undefined,
          ),
        )
        systemMessages.push({
          role: 'system',
          content: block.content,
          cached: isExplicitBreakpoint || undefined,
        })
      }

      for (const message of anthropicConversationMessages) {
        messagesForAnthropic.push({
          role: message.role,
          content: message.content,
        })
        conversationMessages.push({ role: message.role, content: message.content })
      }

      return {
        strategy: 'anthropic-split-system',
        streamRequest: {
          messages: messagesForAnthropic,
          providerOptions: mergedProviderOptions,
        },
        actualPayload: {
          provider: 'anthropic',
          strategy: 'anthropic-split-system',
          systemMessages,
          conversationMessages,
        },
      }
    }

    const messagesForAnthropic: CoreMessage[] = []
    const mergedProviderOptions = withAnthropicAutomaticCaching(providerOptions, anthropicCache)

    messagesForAnthropic.push({
      role: 'system',
      content: staticSystemPrompt,
    })

    if (dynamicContext) {
      messagesForAnthropic.push({
        role: 'system',
        content: dynamicContext,
      })
    }

    for (const msg of anthropicConversationMessages) {
      messagesForAnthropic.push({
        role: msg.role,
        content: msg.content,
      })
    }

    const systemMessages: Array<{ role: string; content: string; cached?: boolean }> = [
      {
        role: 'system',
        content: staticSystemPrompt,
      },
    ]
    if (dynamicContext) {
      systemMessages.push({ role: 'system', content: dynamicContext })
    }

    return {
      strategy: 'anthropic-split-system',
      streamRequest: {
        messages: messagesForAnthropic,
        providerOptions: mergedProviderOptions,
      },
      actualPayload: {
        provider: 'anthropic',
        strategy: 'anthropic-split-system',
        systemMessages,
        conversationMessages: anthropicConversationMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      },
    }
  }

  const defaultPlan = buildDefaultStreamPayloadPlan({
    provider,
    finalSystemPrompt,
    recentMessages,
    providerOptions,
  })

  if (provider === 'google' && googleExplicitCache?.streamRequestOverride) {
    return {
      strategy: 'google-explicit-cache',
      streamRequest: googleExplicitCache.streamRequestOverride,
      actualPayload: {
        ...defaultPlan.actualPayload,
        strategy: 'google-explicit-cache',
        cache: googleExplicitCache.cacheDebugInfo
          ? {
              systemPrompt: googleExplicitCache.cacheDebugInfo.systemPrompt,
              cacheName: googleExplicitCache.cacheDebugInfo.cacheName,
              cachedTokenCount: googleExplicitCache.cacheDebugInfo.cachedTokenCount,
              messagesToCache: googleExplicitCache.cacheDebugInfo.messagesToCache.map((m) => ({
                role: m.role,
                content: m.content,
              })),
            }
          : undefined,
      },
    }
  }

  return defaultPlan
}
