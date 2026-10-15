import { describe, expect, it } from 'vitest'
import { attachTurnContext, buildGoogleContextRequest } from './prompt-context'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'

describe('Google context placement', () => {
  const messages = [
    { role: 'user' as const, content: 'old question', messageId: 'u1' },
    { role: 'assistant' as const, content: 'old answer', messageId: 'a1' },
    { role: 'user' as const, content: 'current question', messageId: 'u2' },
  ]
  it('keeps native system and history identical when memory, lore and tool inventory change', () => {
    const build = (value: string) =>
      buildGoogleContextRequest({
        context: {
          instructions: 'card\npermanent lore',
          memory: `memory ${value}`,
          turnContext: `lore ${value}`,
        },
        messages,
        toolInstruction: `range inventory ${value}`,
      })
    const before = build('A')
    const after = build('B')
    expect(after.system).toBe(before.system)
    expect(after.messages.slice(0, -1)).toEqual(before.messages.slice(0, -1))
    expect(after.messages.at(-1)?.content).toContain('memory B')
    expect(after.messages.at(-1)?.content).toContain('lore B')
    expect(after.messages.at(-1)?.content).toContain('range inventory B')
    expect(after.messages.at(-1)?.content).toMatch(/current question$/)
    expect(messages.at(-1)?.content).toBe('current question')
    expect(after.messages.at(-1)?.messageId).toBe('u2')
  })
  it('does not mutate history or attach context to a historical user in continuations', () => {
    const history = messages.slice(0, -1)
    const result = attachTurnContext(history, 'current lore')
    expect(result.slice(0, -1)).toEqual(history)
    expect(result.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('current lore'),
    })
    expect(attachTurnContext([], 'memory')).toHaveLength(1)
    expect(attachTurnContext(messages, null)).toBe(messages)
  })
  it('preserves the native Gemini prefix through the installed SDK conversion', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const google = createGoogleGenerativeAI({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init?.body as string))
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      },
    })
    for (const turnContext of ['Lore A', 'Lore B']) {
      await generateText({
        model: google('gemini-4-argon'),
        ...buildGoogleContextRequest({
          context: { instructions: 'Fixed card and permanent lore', memory: null, turnContext },
          messages,
        }),
      })
    }
    expect(bodies[1].systemInstruction).toEqual(bodies[0].systemInstruction)
    const before = bodies[0].contents as unknown[]
    const after = bodies[1].contents as unknown[]
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1))
    expect(JSON.stringify(after.at(-1))).toContain('Lore B')
    expect(JSON.stringify(after.at(-1))).not.toContain('Lore A')
  })
})
