import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'
import { buildLanguageModel } from './model-factory'
import { getProviderOptions } from './provider-options'
import { resolveReasoningSnapshot, type ReasoningPreference } from './reasoning'

afterEach(() => vi.unstubAllGlobals())

describe.each(['deepseek-v4-flash', 'deepseek-v4-pro'])(
  '%s reasoning request contract',
  (modelName) => {
    it.each(['default', 'none', 'low', 'high', 'max'] as const)(
      'serializes %s through the installed SDK',
      async (preference: ReasoningPreference) => {
        const fetchMock = vi.fn().mockResolvedValue(
          Response.json({
            id: 'test-completion',
            created: 1,
            model: modelName,
            choices: [
              { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          }),
        )
        vi.stubGlobal('fetch', fetchMock)
        await generateText({
          model: buildLanguageModel({ provider: 'deepseek', modelName, apiKey: 'test-key' }),
          prompt: 'ok',
          providerOptions: getProviderOptions('deepseek', {
            modelName,
            reasoning: resolveReasoningSnapshot({ provider: 'deepseek', modelName, preference }),
          }),
        })
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
        expect(body.model).toBe(modelName)
        if (preference === 'default') {
          expect(body).not.toHaveProperty('thinking')
          expect(body).not.toHaveProperty('reasoning_effort')
        } else if (preference === 'none') {
          expect(body.thinking).toEqual({ type: 'disabled' })
          expect(body).not.toHaveProperty('reasoning_effort')
        } else {
          expect(body.thinking).toEqual({ type: 'enabled' })
          expect(body.reasoning_effort).toBe(preference)
        }
      },
    )
  },
)
