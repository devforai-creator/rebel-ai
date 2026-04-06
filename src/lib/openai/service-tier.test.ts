import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('service-tier', () => {
  let originalFetch: typeof fetch
  let capturedFetch: typeof fetch | undefined
  let mockCreateOpenAI: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    originalFetch = globalThis.fetch
    capturedFetch = undefined

    // Set up mock fetch before importing the module
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'))
    globalThis.fetch = mockFetch

    // Reset modules to pick up the new fetch
    vi.resetModules()

    // Mock createOpenAI to capture the fetch function
    vi.doMock('@ai-sdk/openai', () => ({
      createOpenAI: vi.fn(({ fetch }) => {
        capturedFetch = fetch
        return { mocked: true }
      }),
    }))

    // Import the mocked module
    const { createOpenAI } = await import('@ai-sdk/openai')
    mockCreateOpenAI = createOpenAI as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.doUnmock('@ai-sdk/openai')
  })

  describe('createOpenAIWithServiceTier', () => {
    it('creates standard OpenAI client when serviceTier is standard', async () => {
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'standard' })

      expect(mockCreateOpenAI).toHaveBeenCalledTimes(1)
      const callArgs = mockCreateOpenAI.mock.calls[0][0]
      expect(callArgs.apiKey).toBe('test-key')
      expect(callArgs.fetch).toBeUndefined()
    })

    it('creates standard OpenAI client when serviceTier is null', async () => {
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: null })

      expect(mockCreateOpenAI).toHaveBeenCalledTimes(1)
      const callArgs = mockCreateOpenAI.mock.calls[0][0]
      expect(callArgs.fetch).toBeUndefined()
    })

    it('creates standard OpenAI client when serviceTier is undefined', async () => {
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key' })

      expect(mockCreateOpenAI).toHaveBeenCalledTimes(1)
      const callArgs = mockCreateOpenAI.mock.calls[0][0]
      expect(callArgs.fetch).toBeUndefined()
    })

    it('creates custom fetch OpenAI client when serviceTier is flex', async () => {
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(mockCreateOpenAI).toHaveBeenCalledTimes(1)
      const callArgs = mockCreateOpenAI.mock.calls[0][0]
      expect(callArgs.apiKey).toBe('test-key')
      expect(callArgs.fetch).toBeDefined()
      expect(typeof callArgs.fetch).toBe('function')
    })

    it('creates custom fetch OpenAI client when serviceTier is priority', async () => {
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'priority' })

      expect(mockCreateOpenAI).toHaveBeenCalledTimes(1)
      const callArgs = mockCreateOpenAI.mock.calls[0][0]
      expect(callArgs.fetch).toBeDefined()
    })
  })

  describe('tier-aware fetch behavior', () => {
    it('injects service_tier for /chat/completions endpoint', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4', messages: [] }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBe('flex')
    })

    it('injects service_tier for /responses endpoint', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/responses', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4' }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBe('flex')
    })

    it('does not inject service_tier for non-matching endpoints', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        body: JSON.stringify({ model: 'text-embedding-ada-002' }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBeUndefined()
    })

    it('does not override existing service_tier in body', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4', service_tier: 'flex' }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBe('flex')
    })

    it('passes through when body is not a string', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: undefined,
      })

      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: undefined,
      })
    })

    it('passes through when init is undefined', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/chat/completions')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        undefined,
      )
    })

    it('handles URL object input', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      const url = new URL('https://api.openai.com/v1/chat/completions')
      await capturedFetch!(url, {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4' }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBe('flex')
    })

    it('handles Request object input', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      const request = new Request('https://api.openai.com/v1/chat/completions')
      await capturedFetch!(request, {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4' }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBe('flex')
    })

    it('handles object inputs with a url field', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      const requestLike = { url: 'https://api.openai.com/v1/chat/completions' }
      await capturedFetch!(requestLike as unknown as RequestInfo, {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4' }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBe('flex')
    })

    it('passes through when request url cannot be resolved', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      const unknownRequest = { method: 'POST' }
      await capturedFetch!(unknownRequest as unknown as RequestInfo, {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4' }),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      const parsedBody = JSON.parse(init.body)
      expect(parsedBody.service_tier).toBeUndefined()
    })

    it('handles invalid JSON body gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: 'not valid json {',
      })

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[OpenAI] Failed to inject service_tier',
        expect.objectContaining({ error: expect.any(String) }),
      )
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      expect(init.body).toBe('not valid json {')

      consoleWarnSpy.mockRestore()
    })
  })

  describe('edge cases', () => {
    it('handles empty body string', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      const { createOpenAIWithServiceTier } = await import('./service-tier')
      createOpenAIWithServiceTier({ apiKey: 'test-key', serviceTier: 'flex' })

      expect(capturedFetch).toBeDefined()
      await capturedFetch!('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: '',
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      expect(init.body).toBe('')
    })
  })
})
