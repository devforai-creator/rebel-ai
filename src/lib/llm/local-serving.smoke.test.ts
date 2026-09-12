import { expect, it } from 'vitest'
import { streamText } from 'ai'
import { buildLocalModel } from './local'

// Explicitly opt-in, synthetic-only. No real conversations or DB access.
it.skipIf(!process.env.LOCAL_SERVING_SMOKE_TOKEN)(
  'streams through the actual local provider and switches adapters',
  async () => {
    const token = process.env.LOCAL_SERVING_SMOKE_TOKEN!
    const prompt =
      '가상의 기록 보관소입니다. '.repeat(700) +
      '\n마지막 확인 문구는 합성검사입니다. 확인 문구만 답하세요.'
    for (const name of [
      'local-rp-base',
      'local-rp-step200',
      'local-rp-step200',
      'local-rp-step500',
      'local-rp-base',
    ]) {
      const started = Date.now()
      const result = streamText({
        model: buildLocalModel(token, name),
        system: '당신은 가상의 기록 보관소 안내자입니다. 요청한 짧은 답만 출력하세요.',
        prompt,
        temperature: 0,
        seed: 42,
        maxOutputTokens: 32,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(180_000),
      })
      let text = ''
      for await (const part of result.textStream) text += part
      expect(text.length > 0).toBe(true)
      expect(['stop', 'length']).toContain(await result.finishReason)
      console.log(
        JSON.stringify({ model: name, stream_ok: true, seconds: (Date.now() - started) / 1000 }),
      )
    }
  },
  600_000,
)
