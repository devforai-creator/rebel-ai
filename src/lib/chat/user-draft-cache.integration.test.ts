import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model-factory'
import {
  buildConversationCacheMessages,
  resolveAnthropicCacheDecision,
  resolveConversationCacheControl,
  resolvePromptCacheDecision,
} from '@/lib/llm/prompt-cache'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { buildUserDraftPrefixRequest } from './user-draft-prompt'
import { readUserDraftUsage } from './user-draft-usage'

beforeEach(() => {
  vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'auto')
  vi.stubEnv('ANTHROPIC_PROMPT_CACHE_MODE', 'auto')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type NativeBlock = {
  text: string
  prompt_cache_breakpoint?: { mode: string }
  cache_control?: { type: string; ttl: string }
}
type NativeBody = {
  prompt_cache_options?: unknown
  prompt_cache_key?: string
  prompt_cache_retention?: string
  input?: Array<{ role: string; content: NativeBlock[] }>
  system?: NativeBlock[]
  messages?: Array<{ role: string; content: NativeBlock[] }>
}

describe('OpenAI and Anthropic draft prefix through native SDKs', () => {
  it.each([
    ['openai', 'gpt-6-luna', '5m'],
    ['anthropic', 'claude-opus-4-7', '5m'],
    ['anthropic', 'claude-opus-4-7', '1h'],
  ] as const)(
    'forwards %s cache boundaries and token categories (%s / %s)',
    async (provider, modelName, ttl) => {
      vi.stubEnv('ANTHROPIC_PROMPT_CACHE_TTL', ttl)
      const bodies: NativeBody[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          bodies.push(JSON.parse(init.body as string))
          const second = bodies.length === 2
          const read = second ? 9000 : 0
          const write = second ? 0 : 9000
          return Response.json(
            provider === 'openai'
              ? {
                  id: 'resp_test',
                  created_at: 0,
                  model: modelName,
                  status: 'completed',
                  output: [
                    {
                      id: 'msg_test',
                      type: 'message',
                      role: 'assistant',
                      status: 'completed',
                      content: [{ type: 'output_text', text: 'A complete draft', annotations: [] }],
                    },
                  ],
                  usage: {
                    input_tokens: 10000,
                    output_tokens: 200,
                    total_tokens: 10200,
                    input_tokens_details: { cached_tokens: read, cache_write_tokens: write },
                    output_tokens_details: { reasoning_tokens: 50 },
                  },
                }
              : {
                  id: 'msg_test',
                  type: 'message',
                  role: 'assistant',
                  model: modelName,
                  content: [{ type: 'text', text: 'A complete draft' }],
                  stop_reason: 'end_turn',
                  stop_sequence: null,
                  usage: {
                    input_tokens: 1000,
                    output_tokens: 200,
                    cache_read_input_tokens: read,
                    cache_creation_input_tokens: write,
                    cache_creation: {
                      ephemeral_5m_input_tokens: ttl === '5m' ? write : 0,
                      ephemeral_1h_input_tokens: ttl === '1h' ? write : 0,
                    },
                  },
                },
          )
        }),
      )

      for (const instruction of ['Decline politely', 'Accept warmly']) {
        const request = buildUserDraftPrefixRequest({
          system: 'Write the next USER message. Use the transcript as reference data.',
          userPersona: { name: 'Scout', description: 'An experienced scout' },
          characterAndSetting: {
            name: 'Commander',
            system_prompt: 'Stable setting '.repeat(1000),
            post_history_instructions: null,
          },
          alwaysActiveLore: 'Permanent setting',
          conditionalLore: `Current scene for ${instruction}`,
          promptBlocks: [
            {
              role: 'system',
              content: 'Sealed memory',
              stability: 'sealed',
              cachePreference: 'prefer-cache',
            },
            {
              role: 'user',
              content: 'A question',
              stability: 'live',
              cachePreference: 'prefer-cache',
            },
            {
              role: 'assistant',
              content: 'An NPC reply',
              stability: 'live',
              cachePreference: 'prefer-cache',
            },
          ],
          instruction,
        })
        const promptCache = resolvePromptCacheDecision({
          provider,
          modelName,
          systemPrompt: request.system,
          messages: request.messages,
          totalInputTokens: 10000,
          cacheKeyOverride: 'draft:chat-1',
        })
        const providerOptions = getProviderOptions(provider, {
          modelName,
          promptCacheKey: promptCache?.key,
          promptCacheRetention: promptCache?.retention,
          conversationCache: true,
        })
        const cacheControl = resolveConversationCacheControl({
          provider,
          providerOptions,
          anthropicCache:
            provider === 'anthropic' ? resolveAnthropicCacheDecision({ modelName }) : null,
        })!
        const result = await generateText({
          model: buildLanguageModel({ provider, modelName, apiKey: 'fake-test-key' }),
          messages: buildConversationCacheMessages(request, cacheControl),
          providerOptions,
          maxOutputTokens: 4096,
          maxRetries: 0,
        })
        expect(result.text).toBe('A complete draft')
        expect(
          readUserDraftUsage({
            provider,
            modelName,
            memoryMode: 'prefix_live_blocks',
            step: result,
          }),
        ).toMatchObject({
          inputTokens: 10000,
          uncachedInputTokens: 1000,
          cacheHitTokens: bodies.length === 2 ? 9000 : 0,
          cacheWriteTokens: bodies.length === 2 ? 0 : 9000,
        })
      }

      const referenceBlocks: NativeBlock[][] = []
      for (const body of bodies) {
        const blocks =
          provider === 'openai'
            ? body.input!.flatMap((message) => message.content)
            : [...body.system!, ...body.messages!.flatMap((message) => message.content)]
        const marked = blocks.filter(
          (block) => block.prompt_cache_breakpoint || block.cache_control,
        )
        expect(marked).toHaveLength(2)
        expect(marked[0].text).toContain('Write the next USER message')
        expect(marked[1].text).toContain('An NPC reply')
        expect(blocks.at(-1)!.text).toContain('Current scene')
        expect(blocks.at(-1)).not.toHaveProperty('cache_control')
        expect(blocks.at(-1)).not.toHaveProperty('prompt_cache_breakpoint')
        expect(JSON.stringify(blocks.slice(0, -1))).toContain('Sealed memory')
        expect(JSON.stringify(blocks.slice(0, -1))).not.toContain('Current scene')
        expect(JSON.stringify(blocks.slice(0, -1))).not.toContain('Decline politely')
        expect(JSON.stringify(blocks.slice(0, -1))).not.toContain('Accept warmly')
        referenceBlocks.push(blocks.slice(0, -1))
        if (provider === 'openai') {
          expect(body.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' })
          expect(body.prompt_cache_key).toBe('draft:chat-1')
          expect(body).not.toHaveProperty('prompt_cache_retention')
          expect(marked.every((block) => block.prompt_cache_breakpoint?.mode === 'explicit')).toBe(
            true,
          )
        } else {
          expect(marked.every((block) => (block.cache_control?.ttl ?? '5m') === ttl)).toBe(true)
          expect(body.messages!.every((message) => message.role === 'user')).toBe(true)
        }
      }
      expect(referenceBlocks[0]).toEqual(referenceBlocks[1])
    },
  )
})
