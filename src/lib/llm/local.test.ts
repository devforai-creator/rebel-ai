import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import { buildLanguageModel } from './model-factory'
import { buildLocalModel, localBaseURL } from './local'
import { normalizeProviderError } from './provider-error'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
function configure() {
  vi.stubEnv('LOCAL_LLM_ENABLED', 'true')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('LOCAL_LLM_BASE_URL', 'http://100.70.1.2:8000/v1')
}
describe('local provider', () => {
  it('requires opt-in and rejects Vercel', () => {
    vi.stubEnv('LOCAL_LLM_ENABLED', '')
    expect(localBaseURL).toThrow('LOCAL_LLM_DISABLED')
    configure()
    vi.stubEnv('VERCEL', '1')
    expect(localBaseURL).toThrow('LOCAL_LLM_DISABLED')
  })
  it.each([
    'https://example.com/v1',
    'http://100.63.0.1/v1',
    'http://100.128.0.1/v1',
    'http://127.0.0.1/other',
    'http://user:pass@localhost/v1',
    'http://localhost/v1?secret=x',
  ])('rejects destination %s', (url) => {
    configure()
    vi.stubEnv('LOCAL_LLM_BASE_URL', url)
    expect(localBaseURL).toThrow('LOCAL_LLM_CONFIGURATION')
  })
  it.each(['http://127.0.0.1:8000/v1', 'http://[::1]:8000/v1', 'http://100.70.1.2:8000/v1'])(
    'accepts explicit local destination %s',
    (url) => {
      configure()
      vi.stubEnv('LOCAL_LLM_BASE_URL', url)
      expect(localBaseURL()).toBe(url)
    },
  )
  it.each(['local-rp-base', 'local-rp-step500'])(
    'streams %s with roles, bearer auth and output limit',
    async (modelName) => {
      configure()
      const frames = [
        {
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'local-rp-base',
          choices: [
            { index: 0, delta: { role: 'assistant', content: '안녕하세요.' }, finish_reason: null },
          ],
        },
        {
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'local-rp-base',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        },
      ]
      const request = vi.fn(
        async () =>
          new Response(
            frames.map((f) => 'data: ' + JSON.stringify(f) + '\n\n').join('') + 'data: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      )
      vi.stubGlobal('fetch', request)
      const model = buildLanguageModel({
        provider: 'local',
        modelName,
        apiKey: 'synthetic-test-token',
      })
      const result = streamText({
        model,
        system: '테스트 설정',
        prompt: '테스트 질문',
        maxOutputTokens: 8000,
        temperature: 0.7,
        topP: 0.9,
        maxRetries: 0,
      })
      expect(await result.text).toBe('안녕하세요.')
      expect(request).toHaveBeenCalledOnce()
      const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
      expect(String(url)).toBe('http://100.70.1.2:8000/v1/chat/completions')
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-test-token')
      expect(init.redirect).toBe('error')
      const body = JSON.parse(String(init.body))
      expect(body.model).toBe(modelName)
      expect(body.max_tokens).toBe(2048)
      expect(body.temperature).toBe(0.7)
      expect(body.top_p).toBe(0.9)
      expect(body.messages).toEqual([
        { role: 'system', content: '테스트 설정' },
        { role: 'user', content: '테스트 질문' },
      ])
    },
  )
  it('fails closed on an unknown model', () => {
    configure()
    expect(() =>
      buildLanguageModel({ provider: 'local', modelName: 'cloud-model', apiKey: 'test' }),
    ).toThrow('LOCAL_LLM_MODEL')
  })
  it('does not expose local error response contents', async () => {
    configure()
    const request = vi.fn(async () => new Response('private response detail', { status: 401 }))
    vi.stubGlobal('fetch', request)
    await expect(
      buildLocalModel('test', 'local-rp-base').doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }],
      }),
    ).rejects.toThrow('LOCAL_LLM_AUTH')
    expect(request).toHaveBeenCalledOnce()
    const error = normalizeProviderError({ provider: 'local', error: new Error('private detail') })
    expect(JSON.stringify(error)).not.toContain('private detail')
    expect(error.technicalMessage).toBeNull()
  })
})
