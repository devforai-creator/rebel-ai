import { describe, expect, it } from 'vitest'
import { buildChatContextRequest } from '@/lib/chat-memory/prompt-context'
import { buildStreamPayloadPlan } from './stream-payload-builder'
import { buildAnthropicBatchRequest } from './anthropic-batch-orchestrator'

describe('Anthropic Batch conversation cache boundary', () => {
  it.each([true, false])(
    'preserves the boundary before temporary lore with cache enabled=%s',
    (enabled) => {
      const contextRequest = buildChatContextRequest({
        context: { instructions: 'STATIC', memory: null, turnContext: 'CURRENT LORE' },
        messages: [{ role: 'user', content: 'canonical question' }],
      })
      const plan = buildStreamPayloadPlan({
        provider: 'anthropic',
        contextRequest,
        finalSystemPrompt: 'legacy',
        staticSystemPrompt: 'STATIC',
        dynamicContext: null,
        anthropicCache: enabled ? { enabled: true, ttl: '1h', minTokens: 1024 } : null,
        anthropicConversationMessages: [],
        promptBlocks: [],
        recentMessages: [],
        googleExplicitCache: null,
      })
      const request = buildAnthropicBatchRequest({
        modelName: 'claude-opus-4-7',
        streamPayloadPlan: plan,
      })
      expect(request.messages[0].content).toEqual(
        enabled
          ? [
              {
                type: 'text',
                text: 'canonical question',
                cache_control: { type: 'ephemeral', ttl: '1h' },
              },
            ]
          : 'canonical question',
      )
      expect(request.messages[1].content).toBe(contextRequest.messages[1].content)
      expect(JSON.stringify(request.messages[1])).not.toContain('cache_control')
    },
  )
})
