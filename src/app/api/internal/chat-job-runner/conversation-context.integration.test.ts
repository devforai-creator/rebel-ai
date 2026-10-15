import { describe, expect, it } from 'vitest'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import { buildChatContextRequest } from '@/lib/chat-memory/prompt-context'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { buildStreamPayloadPlan } from './stream-payload-builder'

type NativePart = {
  text: string
  cache_control?: { type: string }
  prompt_cache_breakpoint?: { mode: string }
}
type NativeBody = {
  system: NativePart[]
  messages: Array<{ content: string | NativePart[] }>
  input: Array<{ content: NativePart[] }>
  prompt_cache_options?: { mode: string; ttl: string }
}

describe('conversation boundary on native provider requests', () => {
  it.each(['anthropic', 'openai', 'deepseek'] as const)(
    'keeps dialogue intact and current lore outside cache markers for %s',
    async (provider) => {
      const bodies: NativeBody[] = []
      const fetchMock: typeof fetch = async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)))
        const response =
          provider === 'anthropic'
            ? {
                id: 'msg-test',
                type: 'message',
                role: 'assistant',
                model: 'claude-opus-4-7',
                content: [{ type: 'text', text: 'ok' }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 1 },
              }
            : provider === 'openai'
              ? {
                  id: 'resp-test',
                  object: 'response',
                  created_at: 1,
                  model: 'gpt-5.6',
                  status: 'completed',
                  output: [
                    {
                      type: 'message',
                      id: 'm',
                      role: 'assistant',
                      status: 'completed',
                      content: [{ type: 'output_text', text: 'ok', annotations: [] }],
                    },
                  ],
                  usage: {
                    input_tokens: 10,
                    output_tokens: 1,
                    total_tokens: 11,
                    input_tokens_details: { cached_tokens: 0 },
                    output_tokens_details: { reasoning_tokens: 0 },
                  },
                }
              : {
                  id: 'chat-test',
                  object: 'chat.completion',
                  created: 1,
                  model: 'deepseek-v4-flash',
                  choices: [
                    {
                      index: 0,
                      message: { role: 'assistant', content: 'ok' },
                      finish_reason: 'stop',
                    },
                  ],
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 1,
                    total_tokens: 11,
                    prompt_cache_hit_tokens: 0,
                  },
                }
        return Response.json(response)
      }
      const modelName =
        provider === 'openai'
          ? 'gpt-5.6'
          : provider === 'anthropic'
            ? 'claude-opus-4-7'
            : 'deepseek-v4-flash'
      const model =
        provider === 'anthropic'
          ? createAnthropic({ apiKey: 'mock', fetch: fetchMock })(modelName)
          : provider === 'openai'
            ? createOpenAI({ apiKey: 'mock', fetch: fetchMock })(modelName)
            : createDeepSeek({ apiKey: 'mock', fetch: fetchMock })(modelName)
      const canonical = [
        { role: 'user' as const, content: 'old question' },
        { role: 'assistant' as const, content: 'old answer' },
        { role: 'user' as const, content: 'current question' },
      ]
      for (const lore of ['LORE ACTIVE', null]) {
        const contextRequest = buildChatContextRequest({
          context: { instructions: 'FIXED', memory: 'SUMMARY', turnContext: lore },
          messages: canonical,
        })
        const plan = buildStreamPayloadPlan({
          provider,
          contextRequest,
          finalSystemPrompt: 'legacy',
          staticSystemPrompt: 'FIXED',
          dynamicContext: 'SUMMARY',
          anthropicCache: { enabled: true, ttl: '5m', minTokens: 1024 },
          anthropicConversationMessages: canonical,
          promptBlocks: [],
          recentMessages: canonical,
          googleExplicitCache: null,
          providerOptions: getProviderOptions(provider, {
            modelName,
            promptCacheKey: 'chat:test',
            conversationCache: true,
          }),
        })
        expect((await generateText({ model, ...plan.streamRequest })).text).toBe('ok')
      }
      const flatten = (body: NativeBody): NativePart[] =>
        provider === 'anthropic'
          ? [
              ...body.system,
              ...body.messages.flatMap((m) =>
                typeof m.content === 'string' ? [{ text: m.content }] : m.content,
              ),
            ]
          : provider === 'openai'
            ? body.input.flatMap((m) => m.content)
            : body.messages.map((m) => ({
                text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              }))
      const before = flatten(bodies[0])
      const after = flatten(bodies[1])
      expect(after.slice(0, -1)).toEqual(before.slice(0, -1))
      expect(after.slice(-4, -1).map((p) => p.text)).toEqual(canonical.map((m) => m.content))
      expect(before.at(-1)?.text).toContain('LORE ACTIVE')
      expect(after.at(-1)?.text).not.toContain('LORE ACTIVE')
      expect(after.at(-1)).not.toHaveProperty('cache_control')
      expect(after.at(-1)).not.toHaveProperty('prompt_cache_breakpoint')
      if (provider === 'anthropic')
        expect(after.at(-2)?.cache_control).toEqual({ type: 'ephemeral' })
      if (provider === 'openai') {
        expect(bodies[1].prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' })
        expect(after.at(-2)?.prompt_cache_breakpoint).toEqual({ mode: 'explicit' })
      }
    },
  )
})
