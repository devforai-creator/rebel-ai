import type { CoreMessage } from 'ai'
import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { MemoryPromptBlock } from '@/lib/chat-memory'
import { buildAnthropicCacheControl } from '@/lib/llm/provider-options'
import type { AnthropicCacheDecision } from '@/lib/llm/prompt-cache'
import type { CreateGoogleCacheResult } from '@/lib/llm/google-cache'
import type { ChatRunnerActualPayload } from './usage-debug'

type ConversationMessage = { role: 'user' | 'assistant'; content: string }

type StreamRequest = {
  system?: string
  messages: CoreMessage[]
  providerOptions?: SharedV2ProviderOptions
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

type BuildStreamPayloadPlanArgs = {
  provider: string
  finalSystemPrompt: string
  staticSystemPrompt: string
  dynamicContext: string | null
  anthropicCache: AnthropicCacheDecision | null
  anthropicConversationMessages: ConversationMessage[]
  anthropicPlaceholderAdded: boolean
  promptBlocks: MemoryPromptBlock[]
  recentMessages: SanitizedMessage[]
  googleCacheResult: CreateGoogleCacheResult | null
  messagesToCacheForGoogle: ConversationMessage[]
  lastMessageForGoogle: ConversationMessage | null
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
  anthropicPlaceholderAdded,
  promptBlocks,
  recentMessages,
  googleCacheResult,
  messagesToCacheForGoogle,
  lastMessageForGoogle,
  providerOptions,
}: BuildStreamPayloadPlanArgs): StreamPayloadPlan {
  if (provider === 'anthropic') {
    if (promptBlocks.length > 0) {
      const systemBlocks = promptBlocks.filter((block) => block.role === 'system')
      const systemMessages: Array<{ role: string; content: string; cached?: boolean }> = []
      const conversationMessages: Array<{ role: string; content: string }> = []
      const messagesForAnthropic: CoreMessage[] = []
      const mergedProviderOptions = withAnthropicAutomaticCaching(providerOptions, anthropicCache)

      for (const block of systemBlocks) {
        messagesForAnthropic.push({
          role: 'system',
          content: block.content,
        })
        systemMessages.push({ role: 'system', content: block.content })
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

  if (provider === 'google' && googleCacheResult?.success && lastMessageForGoogle) {
    return {
      strategy: 'google-explicit-cache',
      streamRequest: {
        messages: [lastMessageForGoogle],
        providerOptions: {
          ...(providerOptions ?? {}),
          google: {
            ...((providerOptions?.google as Record<string, unknown>) || {}),
            cachedContent: googleCacheResult.cacheName,
          },
        },
      },
      actualPayload: {
        provider: 'google',
        strategy: 'google-explicit-cache',
        systemMessages: [],
        conversationMessages: [
          { role: lastMessageForGoogle.role, content: lastMessageForGoogle.content },
        ],
        cache: {
          systemPrompt: finalSystemPrompt,
          cacheName: googleCacheResult.cacheName,
          cachedTokenCount: googleCacheResult.cachedTokenCount,
          messagesToCache: messagesToCacheForGoogle.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        },
      },
    }
  }

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
