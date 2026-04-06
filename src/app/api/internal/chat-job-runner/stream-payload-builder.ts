import type { CoreMessage } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { SanitizedMessage } from '@/lib/chat-summaries'
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

type BuildStreamPayloadPlanArgs = {
  provider: string
  finalSystemPrompt: string
  staticSystemPrompt: string
  dynamicContext: string | null
  anthropicCache: AnthropicCacheDecision | null
  anthropicConversationMessages: ConversationMessage[]
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
  recentMessages,
  googleCacheResult,
  messagesToCacheForGoogle,
  lastMessageForGoogle,
  providerOptions,
}: BuildStreamPayloadPlanArgs): StreamPayloadPlan {
  if (provider === 'anthropic') {
    const messagesForAnthropic: CoreMessage[] = []

    // System 1: static prompt (base + character + persona) — cacheable.
    messagesForAnthropic.push(
      anthropicCache?.enabled
        ? {
            role: 'system',
            content: staticSystemPrompt,
            providerOptions: {
              anthropic: buildAnthropicCacheControl(anthropicCache.ttl),
            },
          }
        : {
            role: 'system',
            content: staticSystemPrompt,
          },
    )

    // System 2: summaries + facts — not cached because it changes with history.
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
        cached: anthropicCache?.enabled ?? false,
      },
    ]
    if (dynamicContext) {
      systemMessages.push({ role: 'system', content: dynamicContext, cached: false })
    }

    return {
      strategy: 'anthropic-split-system',
      streamRequest: {
        messages: messagesForAnthropic,
        providerOptions,
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
