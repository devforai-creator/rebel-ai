import { afterEach, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import { buildChatContextRequest } from '@/lib/chat-memory/prompt-context'
import { buildLanguageModel } from '@/lib/llm/model-factory'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { resolvePromptCacheDecision } from '@/lib/llm/prompt-cache'
import { buildStreamPayloadPlan } from './stream-payload-builder'

type NativeBlock = { text: string; prompt_cache_breakpoint?: { mode: string } }
type NativeMessage = { role: string; content: NativeBlock[] }
type NativeBody = {
  prompt_cache_key?: string
  prompt_cache_options?: unknown
  input: NativeMessage[]
}

function sse(readTokens: number) {
  const item = {
    type: 'message',
    id: 'msg_cache',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Next reply', annotations: [] }],
  }
  const events = [
    {
      type: 'response.created',
      response: { id: 'resp_cache', created_at: 0, model: 'gpt-6.1-sol' },
    },
    { type: 'response.output_item.added', output_index: 0, item },
    {
      type: 'response.output_text.delta',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: 'Next reply',
    },
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 20000,
          output_tokens: 200,
          input_tokens_details: {
            cached_tokens: readTokens,
            cache_write_tokens: 12000 - readTokens,
          },
          output_tokens_details: { reasoning_tokens: 50 },
        },
      },
    },
  ]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each([1, 3, 20])(
  'retains the previous regular-chat cache endpoint after %i appended turns through the native SDK',
  async (turns) => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'auto')
    const bodies: NativeBody[] = []
    let savedPrefix: NativeMessage[] | undefined
    let savedKey: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body: NativeBody = JSON.parse(init.body as string)
        bodies.push(body)
        const canonical = body.input.slice(0, -1)
        // Simulate lookup against the actual wire payload, not the request number.
        // Identical prefix text alone cannot hit without its old explicit endpoint.
        const hit =
          savedPrefix &&
          body.prompt_cache_key === savedKey &&
          canonical[savedPrefix.length - 1]?.content.at(-1)?.prompt_cache_breakpoint?.mode ===
            'explicit' &&
          JSON.stringify(canonical.slice(0, savedPrefix.length)) === JSON.stringify(savedPrefix)
        savedPrefix = canonical
        savedKey = body.prompt_cache_key
        return sse(hit ? 12000 : 0)
      }),
    )
    const original = [
      { role: 'user' as const, content: 'First question' },
      { role: 'assistant' as const, content: 'First answer' },
      { role: 'user' as const, content: 'Previously cached last question' },
    ]
    const extra = Array.from({ length: turns * 2 }, (_, index) => ({
      role: index % 2 ? ('user' as const) : ('assistant' as const),
      content: `New message ${index}`,
    }))
    const usages = []
    for (const [index, messages] of [original, [...original, ...extra]].entries()) {
      const contextRequest = buildChatContextRequest({
        context: {
          instructions: 'Stable setting '.repeat(1000),
          memory: `Current memory ${index}`,
          turnContext: `Conditional lore ${index}`,
        },
        messages,
        toolInstruction: `ATR instructions ${index}`,
      })
      const cache = resolvePromptCacheDecision({
        provider: 'openai',
        modelName: 'gpt-6.1-sol',
        systemPrompt: contextRequest.system,
        messages: contextRequest.messages,
        totalInputTokens: 20000,
        // Match the regular runner's existing conversation-scoped routing key.
        cacheKeyOverride: 'chat:growing-chat',
        retentionPreference: '24h',
      })!
      const providerOptions = getProviderOptions('openai', {
        modelName: 'gpt-6.1-sol',
        promptCacheKey: cache.key,
        promptCacheRetention: cache.retention,
        conversationCache: true,
      })
      const plan = buildStreamPayloadPlan({
        provider: 'openai',
        finalSystemPrompt: contextRequest.system,
        staticSystemPrompt: contextRequest.system,
        dynamicContext: null,
        promptBlocks: [],
        recentMessages: messages,
        contextRequest,
        googleExplicitCache: null,
        anthropicCache: null,
        anthropicConversationMessages: [],
        providerOptions,
      })
      const stream = streamText({
        model: buildLanguageModel({
          provider: 'openai',
          modelName: 'gpt-6.1-sol',
          apiKey: 'fake-test-key',
        }),
        ...plan.streamRequest,
        maxRetries: 0,
      })
      await stream.consumeStream({
        onError: (error) => {
          throw error
        },
      })
      usages.push(await stream.usage)
      const marked = plan.actualPayload.conversationMessages.map((message) =>
        Boolean(message.cached),
      )
      expect(marked).toEqual([...messages.map(() => true), false])
      expect(plan.actualPayload.systemMessages[0].cached).toBe(true)
    }
    const [before, after] = bodies
    const previousPrefix = before.input.slice(0, -1)
    expect(after.input.slice(0, previousPrefix.length)).toEqual(previousPrefix)
    expect(after.input[previousPrefix.length - 1].content.at(-1)?.prompt_cache_breakpoint).toEqual({
      mode: 'explicit',
    })
    expect(after.input.at(-2)?.content.at(-1)?.prompt_cache_breakpoint).toEqual({
      mode: 'explicit',
    })
    expect(after.prompt_cache_key).toBe(before.prompt_cache_key)
    for (const body of bodies) {
      expect(body.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' })
      expect(body.input.at(-1)?.content.at(-1)).toMatchObject({
        text: expect.stringContaining('ATR instructions'),
      })
      expect(body.input.at(-1)?.content.at(-1)).not.toHaveProperty('prompt_cache_breakpoint')
    }
    expect(usages.map((usage) => usage.cachedInputTokens)).toEqual([0, 12000])
  },
)
