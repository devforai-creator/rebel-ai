import { describe, expect, it } from 'vitest'

import { evaluateContentFilter } from './content-filter'

describe('evaluateContentFilter', () => {
  it('returns blocked for non-google provider when finish reason is content-filter', () => {
    const result = evaluateContentFilter({
      provider: 'openai',
      finishReason: 'content-filter',
      metadata: {},
    })

    expect(result).toEqual({ blocked: true, categories: [] })
  })

  it('returns not blocked for non-google provider when finish reason is not content-filter', () => {
    const result = evaluateContentFilter({
      provider: 'anthropic',
      finishReason: 'stop',
      metadata: {},
    })

    expect(result).toEqual({ blocked: false, categories: [] })
  })

  it('marks blocked for google safety finish reason and extracts category names', () => {
    const result = evaluateContentFilter({
      provider: 'google',
      finishReason: 'stop',
      metadata: {
        google: {
          finishReason: 'SAFETY',
          safetyRatings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT' },
            { category: 123 },
            {},
          ],
        },
      },
    })

    expect(result).toEqual({
      blocked: true,
      categories: ['HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_DANGEROUS_CONTENT'],
    })
  })

  it('preserves content-filter block signal for google even without safety metadata', () => {
    const result = evaluateContentFilter({
      provider: 'google',
      finishReason: 'content-filter',
      metadata: { google: {} },
    })

    expect(result).toEqual({ blocked: true, categories: [] })
  })

  it('handles malformed metadata safely', () => {
    const nullGoogle = evaluateContentFilter({
      provider: 'google',
      finishReason: undefined,
      metadata: { google: null },
    })
    const noGoogleField = evaluateContentFilter({
      provider: 'google',
      finishReason: undefined,
      metadata: { foo: 'bar' },
    })

    expect(nullGoogle).toEqual({ blocked: false, categories: [] })
    expect(noGoogleField).toEqual({ blocked: false, categories: [] })
  })
})
