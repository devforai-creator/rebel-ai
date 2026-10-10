import { describe, expect, it, vi } from 'vitest'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import type { TurnClient } from '@/lib/chat/turn-types'
import { prepareExperimentalAgenticTranscriptRecallRequest } from '@/lib/experimental/agentic-transcript-recall/runner'
import type { AgenticTranscriptRecallRuntimeConfig } from '@/lib/experimental/agentic-transcript-recall/config'
import { buildStreamPayloadPlan } from './stream-payload-builder'

const runtimeConfig: AgenticTranscriptRecallRuntimeConfig = {
  configured: true,
  accountDefaultEnabled: false,
  preferenceSource: 'chat_override',
  globallyEnabled: true,
  providerSupported: true,
  providerAllowed: true,
  enabled: true,
  skipReason: null,
  maxToolCalls: 1,
  maxMessagesPerCall: 12,
  maxTotalMessages: 12,
  providerAllowlist: ['anthropic'],
}

type RequestBody = {
  cache_control?: unknown
  system: Array<{ type: string; text: string; cache_control?: { type: string; ttl?: string } }>
  messages: unknown[]
  tools: unknown[]
}

describe('Anthropic static prompt cache request', () => {
  it.each(['prefer-cache', 'avoid-cache'] as const)(
    'keeps the wire prefix identical when %s memory, lorebook, ATR ranges, and messages change',
    async (memoryCachePreference) => {
      const requests: RequestBody[] = []
      const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({
          id: 'msg-test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        })
      })
      const model = createAnthropic({ apiKey: 'mock-key', fetch: fetchMock })('claude-opus-4-7')

      for (const turn of [1, 2]) {
        const plan = buildStreamPayloadPlan({
          provider: 'anthropic',
          finalSystemPrompt: `STATIC\nMEMORY-${turn}\nLOREBOOK-${turn}`,
          staticSystemPrompt: 'STATIC',
          dynamicContext: `MEMORY-${turn}\nLOREBOOK-${turn}`,
          anthropicCache: { enabled: true, ttl: '1h', minTokens: 2048 },
          anthropicConversationMessages: [{ role: 'user', content: `user-${turn}` }],
          promptBlocks: [
            {
              role: 'system',
              content: 'STATIC',
              stability: 'static',
              cachePreference: 'prefer-cache',
            },
            {
              role: 'system',
              content: `MEMORY-${turn}`,
              stability: 'sealed',
              cachePreference: memoryCachePreference,
            },
            {
              role: 'system',
              content: `LOREBOOK-${turn}`,
              stability: 'sealed',
              cachePreference: 'avoid-cache',
            },
          ],
          recentMessages: [{ role: 'user', content: `user-${turn}` }],
          googleExplicitCache: null,
        })
        const wrapped = prepareExperimentalAgenticTranscriptRecallRequest({
          supabase: createSupabaseMock({ tables: {} }) as unknown as TurnClient,
          chatId: 'chat-static-cache',
          runtimeConfig,
          sourceHints: null,
          sourceMap: {
            rawContextStartOrdinal: turn * 10 + 1,
            cutoffOrdinal: turn * 10,
            directFetchRanges: [
              {
                rangeId: 'R1',
                kind: 'summary',
                label: 'summary',
                startSeq: 1,
                endSeq: turn * 10,
                preview: `Memory ${turn}`,
              },
            ],
            navigationParents: [],
          },
          streamRequest: plan.streamRequest,
          systemInstructionPlacement: 'after-system-messages',
          debugMetrics: {},
        })
        expect(wrapped.streamRequest.system).toBeUndefined()
        expect(wrapped.streamTextSettings?.tools).toHaveProperty('fetch_source_range')
        expect(
          await generateText({
            model,
            ...wrapped.streamRequest,
            tools: wrapped.streamTextSettings?.tools,
            toolChoice: wrapped.streamTextSettings?.toolChoice,
            maxOutputTokens: 128,
          }),
        ).toMatchObject({ text: 'Hello' })
      }

      expect(fetchMock).toHaveBeenCalledTimes(2)
      for (const [index, body] of requests.entries()) {
        expect(body).not.toHaveProperty('cache_control')
        expect(body.system[0]).toEqual({
          type: 'text',
          text: 'STATIC',
          cache_control: { type: 'ephemeral', ttl: '1h' },
        })
        expect(body.system.filter((block) => block.cache_control)).toHaveLength(1)
        expect(body.system[1].text).toBe(`MEMORY-${index + 1}`)
        expect(body.system[2].text).toBe(`LOREBOOK-${index + 1}`)
        expect(body.system[3].text).toContain(`R1=[Summary 1-${(index + 1) * 10}]`)
        expect(body.system[3].text).toContain('Experimental Transcript Recall')
      }
      expect(requests[0].system[0]).toEqual(requests[1].system[0])
      expect(requests[0].tools).toEqual(requests[1].tools)
      expect(requests[0].messages).not.toEqual(requests[1].messages)
    },
  )
})
