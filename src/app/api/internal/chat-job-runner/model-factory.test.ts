import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'

const createGoogleGenerativeAIMock = vi.fn()
const createOpenAIMock = vi.fn()
const createOpenAIWithServiceTierMock = vi.fn()
const createAnthropicMock = vi.fn()
const createDeepSeekMock = vi.fn()

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (...args: Parameters<typeof createGoogleGenerativeAIMock>) =>
    createGoogleGenerativeAIMock(...args),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: Parameters<typeof createOpenAIMock>) => createOpenAIMock(...args),
}))

vi.mock('@/lib/openai/service-tier', () => ({
  createOpenAIWithServiceTier: (...args: Parameters<typeof createOpenAIWithServiceTierMock>) =>
    createOpenAIWithServiceTierMock(...args),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: Parameters<typeof createAnthropicMock>) =>
    createAnthropicMock(...args),
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: (...args: Parameters<typeof createDeepSeekMock>) => createDeepSeekMock(...args),
}))

describe('buildLanguageModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds google model', async () => {
    const googleModel = { provider: 'google-model' } as unknown as LanguageModel
    const googleFactory = vi.fn(() => googleModel)
    createGoogleGenerativeAIMock.mockReturnValue(googleFactory)
    const { buildLanguageModel } = await import('./model-factory')

    const model = buildLanguageModel({
      provider: 'google',
      modelName: 'gemini-2.0-flash',
      apiKey: 'g-key',
      serviceTier: 'standard',
    })

    expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith({ apiKey: 'g-key' })
    expect(googleFactory).toHaveBeenCalledWith('gemini-2.0-flash')
    expect(model).toBe(googleModel)
  })

  it('builds openai model with service tier', async () => {
    const openaiModel = { provider: 'openai-model' } as unknown as LanguageModel
    const openaiFactory = vi.fn(() => openaiModel)
    createOpenAIWithServiceTierMock.mockReturnValue(openaiFactory)
    const { buildLanguageModel } = await import('./model-factory')

    const model = buildLanguageModel({
      provider: 'openai',
      modelName: 'gpt-4o',
      apiKey: 'o-key',
      serviceTier: 'flex',
    })

    expect(createOpenAIWithServiceTierMock).toHaveBeenCalledWith({
      apiKey: 'o-key',
      serviceTier: 'flex',
    })
    expect(openaiFactory).toHaveBeenCalledWith('gpt-4o')
    expect(model).toBe(openaiModel)
  })

  it('builds anthropic model', async () => {
    const anthropicModel = { provider: 'anthropic-model' } as unknown as LanguageModel
    const anthropicFactory = vi.fn(() => anthropicModel)
    createAnthropicMock.mockReturnValue(anthropicFactory)
    const { buildLanguageModel } = await import('./model-factory')

    const model = buildLanguageModel({
      provider: 'anthropic',
      modelName: 'claude-3-7-sonnet',
      apiKey: 'a-key',
      serviceTier: 'standard',
    })

    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: 'a-key' })
    expect(anthropicFactory).toHaveBeenCalledWith('claude-3-7-sonnet')
    expect(model).toBe(anthropicModel)
  })

  it('builds deepseek model', async () => {
    const deepseekModel = { provider: 'deepseek-model' } as unknown as LanguageModel
    const deepseekFactory = vi.fn(() => deepseekModel)
    createDeepSeekMock.mockReturnValue(deepseekFactory)
    const { buildLanguageModel } = await import('./model-factory')

    const model = buildLanguageModel({
      provider: 'deepseek',
      modelName: 'deepseek-chat',
      apiKey: 'd-key',
      serviceTier: 'standard',
    })

    expect(createDeepSeekMock).toHaveBeenCalledWith({ apiKey: 'd-key' })
    expect(deepseekFactory).toHaveBeenCalledWith('deepseek-chat')
    expect(model).toBe(deepseekModel)
  })

  it('builds openrouter model with chat() to avoid Responses API', async () => {
    const openrouterModel = { provider: 'openrouter-model' } as unknown as LanguageModel
    const openrouterChatMock = vi.fn(() => openrouterModel)
    createOpenAIMock.mockReturnValue({ chat: openrouterChatMock })
    const { buildLanguageModel } = await import('./model-factory')

    const model = buildLanguageModel({
      provider: 'openrouter',
      modelName: 'z-ai/glm-5',
      apiKey: 'or-key',
      serviceTier: 'standard',
    })

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: 'or-key',
      baseURL: 'https://openrouter.ai/api/v1',
    })
    expect(openrouterChatMock).toHaveBeenCalledWith('z-ai/glm-5')
    expect(model).toBe(openrouterModel)
  })

  it('throws for unsupported providers', async () => {
    const { buildLanguageModel } = await import('./model-factory')

    expect(() =>
      buildLanguageModel({
        provider: 'unsupported' as never,
        modelName: 'x',
        apiKey: 'k',
        serviceTier: 'standard',
      }),
    ).toThrow('Unsupported provider: unsupported')
  })
})
