import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import {
  buildGoogleCachedProviderOptions,
  buildGoogleExplicitCacheRequestContract,
  googleCachedContentOwnsRequestContract,
  getGoogleCacheMinTokens,
  shouldCreateGoogleCache,
  resolveGoogleCacheDecision,
  createGoogleCache,
  type GoogleCacheConfig,
} from './google-cache'

// Mock the Google AI SDK
const mockCreate = vi.fn()

vi.mock('@google/generative-ai/server', () => {
  return {
    FunctionCallingMode: {
      AUTO: 'AUTO',
      ANY: 'ANY',
      NONE: 'NONE',
    },
    GoogleAICacheManager: class MockGoogleAICacheManager {
      create = mockCreate
    },
  }
})

describe('google-cache', () => {
  describe('isGoogleExplicitCacheEnabled', () => {
    afterEach(() => {
      vi.resetModules()
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    })

    it('returns false when mode env var is not set (default)', async () => {
      const { isGoogleExplicitCacheEnabled } = await import('./google-cache')

      expect(isGoogleExplicitCacheEnabled()).toBe(false)
    })

    it('returns true when mode env var is "auto"', async () => {
      vi.stubEnv('GOOGLE_EXPLICIT_CACHE_MODE', 'auto')
      const { isGoogleExplicitCacheEnabled } = await import('./google-cache')

      expect(isGoogleExplicitCacheEnabled()).toBe(true)
    })

    it('returns false when mode env var is "off"', async () => {
      vi.stubEnv('GOOGLE_EXPLICIT_CACHE_MODE', 'off')
      const { isGoogleExplicitCacheEnabled } = await import('./google-cache')

      expect(isGoogleExplicitCacheEnabled()).toBe(false)
    })

    it('returns false for invalid mode values', async () => {
      vi.stubEnv('GOOGLE_EXPLICIT_CACHE_MODE', 'yes')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { isGoogleExplicitCacheEnabled } = await import('./google-cache')

      expect(isGoogleExplicitCacheEnabled()).toBe(false)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid GOOGLE_EXPLICIT_CACHE_MODE value "yes"'),
      )
    })
  })

  describe('getGoogleCacheMinTokens', () => {
    it('uses the registered 4096-token threshold for Gemini 3.8 Flash', () => {
      expect(getGoogleCacheMinTokens('gemini-3.8-flash')).toBe(4096)
    })

    it('uses the registered 4096-token threshold for Gemini 3.7 Flash', () => {
      expect(getGoogleCacheMinTokens('gemini-3.7-flash')).toBe(4096)
    })

    it('returns 1024 for Flash models', () => {
      expect(getGoogleCacheMinTokens('gemini-3.6-flash')).toBe(1024)
      expect(getGoogleCacheMinTokens('gemini-3.5-flash-lite')).toBe(1024)
      expect(getGoogleCacheMinTokens('gemini-2.5-flash')).toBe(1024)
      expect(getGoogleCacheMinTokens('gemini-3-flash-preview')).toBe(1024)
      expect(getGoogleCacheMinTokens('gemini-flash')).toBe(1024)
    })

    it('returns 4096 for Pro models', () => {
      expect(getGoogleCacheMinTokens('gemini-2.5-pro')).toBe(4096)
      expect(getGoogleCacheMinTokens('gemini-3.1-pro-preview')).toBe(4096)
      expect(getGoogleCacheMinTokens('gemini-pro')).toBe(4096)
    })

    it('returns null for unknown models', () => {
      expect(getGoogleCacheMinTokens('gemini-nano')).toBe(null)
      expect(getGoogleCacheMinTokens('gpt-4')).toBe(null)
      expect(getGoogleCacheMinTokens('claude-3')).toBe(null)
    })

    it('is case-insensitive', () => {
      expect(getGoogleCacheMinTokens('GEMINI-2.5-FLASH')).toBe(1024)
      expect(getGoogleCacheMinTokens('Gemini-3.1-Pro-Preview')).toBe(4096)
    })
  })

  describe('shouldCreateGoogleCache', () => {
    const shortPrompt = 'Hello' // ~2 tokens
    const longPrompt = 'A'.repeat(15000) // ~5000 tokens
    const mediumPrompt = 'B'.repeat(4500) // ~1500 tokens

    const emptyMessages: Array<{ role: string; content: string }> = []
    const shortMessages = [{ role: 'user', content: 'Hi' }]
    const longMessages = [
      { role: 'user', content: 'C'.repeat(6000) }, // ~2000 tokens
      { role: 'assistant', content: 'D'.repeat(6000) }, // ~2000 tokens
    ]

    it('returns false for unknown models', () => {
      expect(shouldCreateGoogleCache('gpt-4', longPrompt, longMessages)).toBe(false)
    })

    it('returns false when below minimum tokens for Flash (1024)', () => {
      // shortPrompt + shortMessages < 1024 tokens
      expect(shouldCreateGoogleCache('gemini-2.5-flash', shortPrompt, shortMessages)).toBe(false)
    })

    it('returns true when above minimum tokens for Flash (1024)', () => {
      // mediumPrompt (~1500 tokens) > 1024
      expect(shouldCreateGoogleCache('gemini-2.5-flash', mediumPrompt, emptyMessages)).toBe(true)
    })

    it('returns false when below minimum tokens for Pro (4096)', () => {
      // mediumPrompt (~1500 tokens) < 4096
      expect(shouldCreateGoogleCache('gemini-3.1-pro-preview', mediumPrompt, emptyMessages)).toBe(
        false,
      )
    })

    it('returns true when above minimum tokens for Pro (4096)', () => {
      // longPrompt (~5000 tokens) > 4096
      expect(shouldCreateGoogleCache('gemini-3.1-pro-preview', longPrompt, emptyMessages)).toBe(
        true,
      )
    })

    it('combines system prompt and message tokens', () => {
      // mediumPrompt (~1500) + longMessages (~4000) = ~5500 tokens > 4096
      expect(shouldCreateGoogleCache('gemini-3.1-pro-preview', mediumPrompt, longMessages)).toBe(
        true,
      )
    })
  })

  describe('resolveGoogleCacheDecision', () => {
    const longPrompt = 'A'.repeat(15000) // ~5000 tokens
    const shortPrompt = 'Hi'

    it('returns enabled=true and minTokens for Pro when threshold met', () => {
      const result = resolveGoogleCacheDecision({
        modelName: 'gemini-3.1-pro-preview',
        systemPrompt: longPrompt,
        messagesToCache: [],
      })

      expect(result.enabled).toBe(true)
      expect(result.minTokens).toBe(4096)
    })

    it('returns enabled=false when threshold not met', () => {
      const result = resolveGoogleCacheDecision({
        modelName: 'gemini-3.1-pro-preview',
        systemPrompt: shortPrompt,
        messagesToCache: [],
      })

      expect(result.enabled).toBe(false)
      expect(result.minTokens).toBe(4096)
    })

    it('returns minTokens=null for unknown models', () => {
      const result = resolveGoogleCacheDecision({
        modelName: 'gpt-4',
        systemPrompt: longPrompt,
        messagesToCache: [],
      })

      expect(result.enabled).toBe(false)
      expect(result.minTokens).toBe(null)
    })

    it('returns correct minTokens for Flash models', () => {
      const result = resolveGoogleCacheDecision({
        modelName: 'gemini-2.5-flash',
        systemPrompt: 'A'.repeat(4000), // ~1333 tokens > 1024
        messagesToCache: [],
      })

      expect(result.enabled).toBe(true)
      expect(result.minTokens).toBe(1024)
    })
  })

  describe('buildGoogleExplicitCacheRequestContract', () => {
    it('keeps a canonical uncached request and explicit cache split under one contract', () => {
      const providerOptions = {
        google: { safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }] },
      }
      const toolContract = {
        tools: [
          {
            name: 'fetch_source_range',
            description: 'Fetch older transcript evidence.',
            inputSchema: {
              type: 'object',
              properties: {
                rangeId: { type: 'string' },
              },
              required: ['rangeId'],
            },
          },
        ],
        toolChoice: { type: 'required' as const },
      }

      const result = buildGoogleExplicitCacheRequestContract({
        systemPrompt: 'FINAL',
        messages: [
          { role: 'assistant', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
        providerOptions,
        toolContract,
      })

      expect(result).toEqual({
        canonicalRequest: {
          systemPrompt: 'FINAL',
          messages: [
            { role: 'assistant', content: 'Older context' },
            { role: 'user', content: 'Last message' },
          ],
          providerOptions,
          toolContract,
        },
        cacheCreateInput: {
          systemPrompt: 'FINAL',
          messagesToCache: [{ role: 'assistant', content: 'Older context' }],
          toolContract: {
            ...toolContract,
            toolChoice: { type: 'auto' },
          },
        },
        liveRequestTail: {
          messages: [{ role: 'user', content: 'Last message' }],
          providerOptions,
          toolContract,
        },
      })
    })
  })

  describe('buildGoogleCachedProviderOptions', () => {
    it('overlays cachedContent without dropping existing google provider options', () => {
      expect(
        buildGoogleCachedProviderOptions({
          providerOptions: {
            google: {
              safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
            },
          },
          cacheName: 'cachedContents/demo',
        }),
      ).toEqual({
        google: {
          cachedContent: 'cachedContents/demo',
          safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
        },
      })
    })

    it('marks tool-aware cached requests when cachedContent owns the live request contract', () => {
      const providerOptions = buildGoogleCachedProviderOptions({
        providerOptions: {
          google: {
            safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
          },
        },
        cacheName: 'cachedContents/tools',
        cachedContentOwnsRequestContract: true,
      })

      expect(providerOptions).toEqual({
        google: {
          cachedContent: 'cachedContents/tools',
          rebelCachedContentOwnsRequestContract: true,
          safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
        },
      })
      expect(googleCachedContentOwnsRequestContract(providerOptions)).toBe(true)
    })
  })

  // ============================================================================
  // createGoogleCache Tests - Actual API interaction (mocked)
  // ============================================================================

  describe('createGoogleCache', () => {
    const baseConfig: GoogleCacheConfig = {
      apiKey: 'test-api-key',
      modelName: 'gemini-2.5-flash',
      systemPrompt: 'You are a helpful assistant.',
      messagesToCache: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      ttlSeconds: 30,
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    describe('success cases', () => {
      it('returns cache info on successful creation', async () => {
        mockCreate.mockResolvedValue({
          name: 'cachedContents/abc123',
          expireTime: '2025-01-26T12:00:00Z',
          ttl: '30s',
          usageMetadata: { totalTokenCount: 150 },
        })

        const result = await createGoogleCache(baseConfig)

        expect(result).toEqual({
          success: true,
          cacheName: 'cachedContents/abc123',
          cachedTokenCount: 150,
          expireTime: '2025-01-26T12:00:00Z',
          ttl: '30s',
        })
      })

      it('handles missing usageMetadata gracefully (undocumented API behavior)', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})

        // Google API might not return usageMetadata in some cases
        mockCreate.mockResolvedValue({
          name: 'cachedContents/xyz789',
          expireTime: '2025-01-26T12:00:00Z',
          ttl: '30s',
          // Note: no usageMetadata
        })

        const result = await createGoogleCache(baseConfig)

        expect(result).toEqual({
          success: true,
          cacheName: 'cachedContents/xyz789',
          cachedTokenCount: 0, // Falls back to 0
          expireTime: '2025-01-26T12:00:00Z',
          ttl: '30s',
        })
      })

      it('ignores malformed usageMetadata payloads', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})

        mockCreate.mockResolvedValue({
          name: 'cachedContents/bad-metadata',
          ttl: '30s',
          usageMetadata: { totalTokenCount: 'oops' },
        })

        const result = await createGoogleCache(baseConfig)

        expect(result).toEqual({
          success: true,
          cacheName: 'cachedContents/bad-metadata',
          cachedTokenCount: 0,
          expireTime: undefined,
          ttl: '30s',
        })
      })

      it('uses default TTL of 60 seconds when not specified', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})

        mockCreate.mockResolvedValue({
          name: 'cachedContents/default-ttl',
          ttl: '60s',
        })

        const configWithoutTtl: GoogleCacheConfig = {
          apiKey: 'test-key',
          modelName: 'gemini-2.5-flash',
          systemPrompt: 'Test prompt',
          messagesToCache: [],
          // No ttlSeconds specified
        }

        await createGoogleCache(configWithoutTtl)

        // Verify the default TTL was passed to the API
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            ttlSeconds: 60,
          }),
        )
      })
    })

    describe('role conversion (spec: assistant → model)', () => {
      it('converts assistant role to model for Google API compatibility', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})

        mockCreate.mockResolvedValue({
          name: 'cachedContents/role-test',
        })

        await createGoogleCache({
          ...baseConfig,
          messagesToCache: [
            { role: 'user', content: 'User message' },
            { role: 'assistant', content: 'Assistant response' },
            { role: 'user', content: 'Follow up' },
          ],
        })

        // Verify role conversion in the contents array
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            contents: [
              { role: 'user', parts: [{ text: 'User message' }] },
              { role: 'model', parts: [{ text: 'Assistant response' }] }, // assistant → model
              { role: 'user', parts: [{ text: 'Follow up' }] },
            ],
          }),
        )
      })
    })

    describe('model name handling (spec: auto-prefix models/)', () => {
      it('prepends models/ prefix when not present', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})

        mockCreate.mockResolvedValue({
          name: 'cachedContents/model-prefix',
        })

        await createGoogleCache({
          ...baseConfig,
          modelName: 'gemini-2.5-flash',
        })

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'models/gemini-2.5-flash',
          }),
        )
      })

      it('does not double-prefix when models/ already present', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})

        mockCreate.mockResolvedValue({
          name: 'cachedContents/already-prefixed',
        })

        await createGoogleCache({
          ...baseConfig,
          modelName: 'models/gemini-2.5-flash',
        })

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'models/gemini-2.5-flash', // Not models/models/...
          }),
        )
      })
    })

    describe('system instruction handling', () => {
      it('passes system prompt as systemInstruction with required role', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})

        mockCreate.mockResolvedValue({
          name: 'cachedContents/sys-instruction',
        })

        await createGoogleCache({
          ...baseConfig,
          systemPrompt: 'Custom system prompt here',
        })

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            systemInstruction: {
              role: 'user', // Required by API but ignored for system instruction
              parts: [{ text: 'Custom system prompt here' }],
            },
          }),
        )
      })

      it('includes function tool declarations in cache creation when a tool contract is provided', async () => {
        mockCreate.mockResolvedValue({
          name: 'cachedContents/tool-contract',
        })

        await createGoogleCache({
          ...baseConfig,
          toolContract: {
            tools: [
              {
                name: 'fetch_source_range',
                description: 'Fetch older transcript evidence.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    rangeId: { type: 'string', description: 'range id' },
                    reason: { type: 'string' },
                  },
                  required: ['rangeId', 'reason'],
                },
              },
            ],
            toolChoice: { type: 'required' },
          },
        })

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: [
              {
                functionDeclarations: [
                  {
                    name: 'fetch_source_range',
                    description: 'Fetch older transcript evidence.',
                    parameters: {
                      type: 'object',
                      properties: {
                        rangeId: { type: 'string', description: 'range id' },
                        reason: { type: 'string' },
                      },
                      required: ['rangeId', 'reason'],
                    },
                  },
                ],
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode: 'ANY',
              },
            },
          }),
        )
      })
    })

    describe('error cases', () => {
      it('returns error when cache created but no name returned', async () => {
        mockCreate.mockResolvedValue({
          // No name field
          expireTime: '2025-01-26T12:00:00Z',
        })

        const result = await createGoogleCache(baseConfig)

        expect(result).toEqual({
          success: false,
          error: 'Cache created but no name returned',
        })
      })

      it('returns error details when API throws with code', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const apiError = new Error('Rate limit exceeded')
        ;(apiError as Error & { code: string }).code = 'RESOURCE_EXHAUSTED'
        mockCreate.mockRejectedValue(apiError)

        const result = await createGoogleCache(baseConfig)

        expect(result).toEqual({
          success: false,
          error: 'Rate limit exceeded',
          code: 'RESOURCE_EXHAUSTED',
        })

        expect(consoleSpy).toHaveBeenCalledWith(
          '[Google Cache] Failed to create cache',
          expect.objectContaining({
            modelName: 'gemini-2.5-flash',
            error: 'Rate limit exceeded',
            code: 'RESOURCE_EXHAUSTED',
          }),
        )
      })

      it('returns error details when API throws generic error', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        mockCreate.mockRejectedValue(new Error('Network timeout'))

        const result = await createGoogleCache(baseConfig)

        expect(result).toEqual({
          success: false,
          error: 'Network timeout',
          code: undefined,
        })
      })

      it('handles non-Error thrown values', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        mockCreate.mockRejectedValue('String error message')

        const result = await createGoogleCache(baseConfig)

        expect(result).toEqual({
          success: false,
          error: 'String error message',
          code: undefined,
        })
      })
    })
  })
})
