import { describe, expect, it } from 'vitest'
import { normalizeProviderError } from './provider-error'

describe('normalizeProviderError', () => {
  it('recognizes prohibited Gemini content blocks from parsed response bodies', () => {
    const result = normalizeProviderError({
      provider: 'google',
      error: {
        responseBody: JSON.stringify({
          error: {
            message: 'prompt was blocked',
            code: 'SAFETY',
          },
          promptFeedback: {
            blockReason: 'PROHIBITED_CONTENT',
          },
        }),
      },
    })

    expect(result).toMatchObject({
      category: 'content_filter',
      technicalMessage: 'prompt was blocked',
      providerCode: 'SAFETY',
      retryable: false,
      recognized: true,
    })
  })

  it('classifies rate limit errors from provider codes', () => {
    const result = normalizeProviderError({
      provider: 'openai',
      error: {
        code: 'rate_limit_exceeded',
        message: 'too many requests',
      },
    })

    expect(result).toMatchObject({
      category: 'rate_limit',
      retryable: true,
      recognized: true,
    })
    expect(result.userMessage).toContain('OpenAI')
  })

  it('classifies quota errors with the OpenAI-specific user message', () => {
    const result = normalizeProviderError({
      provider: 'openai',
      error: {
        code: 'insufficient_quota',
        message: 'billing hard limit reached',
      },
    })

    expect(result).toMatchObject({
      category: 'quota',
      retryable: false,
      recognized: true,
    })
    expect(result.userMessage).toContain('This OpenAI API key')
  })

  it('classifies authentication failures from status codes', () => {
    const result = normalizeProviderError({
      provider: 'anthropic',
      error: {
        statusCode: 401,
        message: 'unauthorized',
      },
    })

    expect(result).toMatchObject({
      category: 'auth',
      retryable: false,
      recognized: true,
    })
  })

  it('classifies context window failures from upstream messages', () => {
    const result = normalizeProviderError({
      provider: 'anthropic',
      error: new Error('maximum context length exceeded'),
    })

    expect(result).toMatchObject({
      category: 'context_length',
      retryable: false,
      recognized: true,
    })
  })

  it('classifies generic content filter blocks from message text', () => {
    const result = normalizeProviderError({
      provider: 'openrouter',
      error: {
        message: 'blocked by content filter',
      },
    })

    expect(result).toMatchObject({
      category: 'content_filter',
      retryable: false,
      recognized: true,
    })
  })

  it('falls back to unknown errors and marks 5xx responses as retryable', () => {
    const result = normalizeProviderError({
      provider: 'custom',
      error: {
        status: 503,
        responseBody: '{"error":{"message":"upstream unavailable"}}',
      },
    })

    expect(result).toMatchObject({
      category: 'unknown',
      technicalMessage: 'upstream unavailable',
      retryable: true,
      recognized: false,
    })
  })

  it('handles non-object errors without crashing', () => {
    const result = normalizeProviderError({
      provider: 'custom',
      error: 'plain failure',
    })

    expect(result).toMatchObject({
      category: 'unknown',
      userMessage: 'plain failure',
      technicalMessage: 'plain failure',
      retryable: false,
      recognized: false,
    })
  })
})
