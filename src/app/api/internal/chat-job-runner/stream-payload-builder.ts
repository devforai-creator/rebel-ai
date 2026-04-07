import type { CoreMessage } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
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
      const conversationMetas = promptBlocks.filter((block) => block.role !== 'system')
      const placeholderCachePreference = conversationMetas[0]?.cachePreference ?? 'avoid-cache'
      const orderedConversationMetas = anthropicPlaceholderAdded
        ? [
            {
              role: 'user',
              content: '(continue)',
              cachePreference: placeholderCachePreference,
              stability: 'live',
            },
          ].concat(conversationMetas)
        : conversationMetas

      const lastCacheableIndex = anthropicCache?.enabled
        ? findLastCacheableIndex([...systemBlocks, ...orderedConversationMetas])
        : -1

      const systemMessages: Array<{ role: string; content: string; cached?: boolean }> = []
      const conversationMessages: Array<{ role: string; content: string }> = []
      const messagesForAnthropic: CoreMessage[] = []

      let orderedIndex = 0

      for (const block of systemBlocks) {
        const isCached = orderedIndex === lastCacheableIndex
        messagesForAnthropic.push(
          isCached
            ? {
                role: 'system',
                content: block.content,
                providerOptions: {
                  anthropic: buildAnthropicCacheControl(anthropicCache?.ttl ?? '5m'),
                },
              }
            : {
                role: 'system',
                content: block.content,
              },
        )
        systemMessages.push({ role: 'system', content: block.content, cached: isCached })
        orderedIndex += 1
      }

      for (const message of anthropicConversationMessages) {
        const isCached = orderedIndex === lastCacheableIndex
        messagesForAnthropic.push(
          isCached
            ? {
                role: message.role,
                content: message.content,
                providerOptions: {
                  anthropic: buildAnthropicCacheControl(anthropicCache?.ttl ?? '5m'),
                },
              }
            : {
                role: message.role,
                content: message.content,
              },
        )
        conversationMessages.push({ role: message.role, content: message.content })
        orderedIndex += 1
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
          conversationMessages,
        },
      }
    }

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

function findLastCacheableIndex(
  blocks: Array<
    | Pick<MemoryPromptBlock, 'cachePreference'>
    | { cachePreference: 'no-preference'; role: string; content: string }
  >,
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].cachePreference !== 'avoid-cache') {
      return index
    }
  }
  return -1
}
