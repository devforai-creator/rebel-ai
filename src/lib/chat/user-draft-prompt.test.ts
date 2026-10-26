import { describe, expect, it } from 'vitest'
import { generateText } from 'ai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { buildUserDraftPrefixRequest } from './user-draft-prompt'
import { readDeepSeekUsageStep } from '@/lib/llm/deepseek-usage'
import { buildGoogleExplicitCacheRequestContract } from '@/lib/llm/google-cache'
import type { MemoryPromptBlock } from '@/lib/chat-memory/types'

const blocks: MemoryPromptBlock[] = [
  {
    role: 'system',
    content: 'Draft instructions',
    stability: 'static',
    cachePreference: 'prefer-cache',
  },
  {
    role: 'system',
    content: 'Sealed summary',
    stability: 'sealed',
    cachePreference: 'prefer-cache',
  },
  { role: 'system', content: 'Sealed facts', stability: 'sealed', cachePreference: 'prefer-cache' },
  { role: 'user', content: 'A question', stability: 'live', cachePreference: 'prefer-cache' },
  {
    role: 'assistant',
    content: 'An NPC reply',
    stability: 'live',
    cachePreference: 'prefer-cache',
  },
]
const options = {
  system: 'Draft instructions',
  userPersona: { name: 'Scout', description: 'An experienced scout' },
  characterAndSetting: {
    name: 'Commander',
    system_prompt: 'Portray the commander',
    post_history_instructions: 'Do not write for the user',
  },
  alwaysActiveLore: 'Permanent setting',
  conditionalLore: 'Current scene',
  promptBlocks: blocks,
  instruction: 'Refuse politely',
}

describe('prefix memory adapted for user drafts', () => {
  it('keeps instructions, memory and labelled history stable when temporary context changes', () => {
    const before = buildUserDraftPrefixRequest(options)
    const after = buildUserDraftPrefixRequest({
      ...options,
      conditionalLore: 'A different scene',
      instruction: 'Accept the offer',
    })
    expect(after.system).toBe(before.system)
    expect(after.messages.slice(0, after.cacheableMessageCount)).toEqual(
      before.messages.slice(0, before.cacheableMessageCount),
    )
    expect(JSON.parse(before.messages[0].content)).toMatchObject({
      userPersona: options.userPersona,
      characterAndSetting: options.characterAndSetting,
      alwaysActiveLore: 'Permanent setting',
    })
    expect(before.messages.slice(1, 3).map((message) => JSON.parse(message.content))).toEqual([
      { memory: 'Sealed summary' },
      { memory: 'Sealed facts' },
    ])
    expect(after.messages.at(-1)?.content).toContain('A different scene')
    expect(after.messages.at(-1)?.content).toContain('Accept the offer')
    expect(after.messages.at(-1)?.content).not.toContain('Continue the conversation.')
    // NPC dialogue stays reference data and cannot become the active assistant persona.
    expect(before.messages.every((message) => message.role === 'user')).toBe(true)
    expect(JSON.parse(before.messages[4].content)).toEqual({
      transcript: { role: 'assistant', content: 'An NPC reply' },
    })
  })

  it('preserves the existing reference messages when the prefix transcript grows', () => {
    const before = buildUserDraftPrefixRequest(options)
    const after = buildUserDraftPrefixRequest({
      ...options,
      promptBlocks: [
        ...blocks,
        {
          role: 'user',
          content: 'Next action',
          stability: 'live',
          cachePreference: 'prefer-cache',
        },
      ],
    })
    expect(after.messages.slice(0, before.cacheableMessageCount)).toEqual(
      before.messages.slice(0, before.cacheableMessageCount),
    )
    expect(after.cacheableMessageCount).toBe(before.cacheableMessageCount + 1)
    expect(options.promptBlocks).toEqual(blocks)
  })

  it('suggests a first reaction without injecting synthetic dialogue into an empty transcript', () => {
    const result = buildUserDraftPrefixRequest({ ...options, promptBlocks: [], instruction: '' })
    expect(result.cacheableMessageCount).toBe(1)
    expect(result.messages).toHaveLength(2)
    expect(result.messages.at(-1)?.content).toContain('Suggest the next USER reaction')
    expect(result.messages.at(-1)?.content).toContain('"writingInstruction":null')
  })

  it.each(['Refuse politely', ''])(
    'caches selected lore after the shared reference history and leaves only the draft task live: %j',
    (instruction) => {
      const canonical = buildUserDraftPrefixRequest({ ...options, instruction })
      const request = buildUserDraftPrefixRequest({
        ...options,
        instruction,
        cacheConditionalLore: true,
      })
      const contract = buildGoogleExplicitCacheRequestContract({
        systemPrompt: request.system,
        messages: request.messages,
      })
      expect(request.system).toBe(canonical.system)
      expect(contract.cacheCreateInput.messagesToCache.slice(0, -1)).toEqual(
        canonical.messages.slice(0, canonical.cacheableMessageCount),
      )
      expect(contract.cacheCreateInput.messagesToCache.at(-1)).toEqual({
        role: 'user',
        content: '<application_context>\n{"activeLore":"Current scene"}\n</application_context>',
      })
      expect(JSON.stringify(contract.cacheCreateInput.messagesToCache)).not.toContain(
        'writingInstruction',
      )
      const liveTail = contract.liveRequestTail.messages
      expect(liveTail).toHaveLength(1)
      expect(liveTail[0].content).not.toContain('activeLore')
      expect(liveTail[0].content).toContain(
        JSON.stringify({ writingInstruction: instruction || null }).slice(1, -1),
      )
      expect(liveTail[0].content).toContain(
        instruction ? 'Expand the writingInstruction' : 'Suggest the next USER reaction',
      )
      expect(request.messages.every((message) => message.role === 'user')).toBe(true)
    },
  )

  it.each([null, ''])(
    'does not add an empty lore block to explicit cache preparation: %j',
    (conditionalLore) => {
      const request = buildUserDraftPrefixRequest({
        ...options,
        promptBlocks: [],
        conditionalLore,
        cacheConditionalLore: true,
      })
      expect(request.messages).toHaveLength(2)
      expect(request.cacheableMessageCount).toBe(1)
      expect(request.messages.at(-1)?.content).toContain('Refuse politely')
      expect(JSON.stringify(request.messages)).not.toContain('activeLore')
    },
  )

  it('preserves the shared prefix on the DeepSeek wire and reads native hit/miss usage', async () => {
    const bodies: Array<{ messages: unknown[] }> = []
    const deepseek = createDeepSeek({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init?.body as string))
        return new Response(
          JSON.stringify({
            id: 'test',
            object: 'chat.completion',
            created: 1_700_000_000,
            model: 'deepseek-v4-flash',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'A complete draft' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10000,
              completion_tokens: 200,
              total_tokens: 10200,
              prompt_cache_hit_tokens: 8000,
              prompt_cache_miss_tokens: 2000,
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      },
    })
    for (const instruction of ['Refuse politely', 'Accept the offer']) {
      const result = await generateText({
        model: deepseek('deepseek-v4-flash'),
        ...buildUserDraftPrefixRequest({ ...options, instruction }),
        maxRetries: 0,
      })
      expect(readDeepSeekUsageStep(result)).toMatchObject({
        promptTokens: 10000,
        cachedInputTokens: 8000,
        completionTokens: 200,
      })
    }
    expect(bodies[1].messages.slice(0, -1)).toEqual(bodies[0].messages.slice(0, -1))
    expect(JSON.stringify(bodies[1].messages.at(-1))).toContain('Accept the offer')
  })
})

it('includes cross-session canon in the stable draft reference envelope', () => {
  const result = buildUserDraftPrefixRequest({
    ...options,
    storySoFar: 'Established prior relationships',
  })
  expect(JSON.parse(result.messages[0].content).storySoFar).toBe('Established prior relationships')
})
