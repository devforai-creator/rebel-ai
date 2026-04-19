import { describe, expect, it } from 'vitest'
import { createApiError, readApiErrorMessage } from './api-contract'

describe('readApiErrorMessage', () => {
  it('returns the structured error field from JSON payloads', async () => {
    const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(readApiErrorMessage(response, 'Request failed')).resolves.toBe('Unauthorized')
  })

  it('falls back to plain text when the body is not JSON', async () => {
    const response = new Response('bad gateway', { status: 502 })

    await expect(readApiErrorMessage(response, 'Request failed')).resolves.toBe('bad gateway')
  })

  it('returns the fallback when the response body is empty', async () => {
    const response = new Response(null, { status: 500 })

    await expect(readApiErrorMessage(response, 'Request failed')).resolves.toBe('Request failed')
  })
})

describe('createApiError', () => {
  it('wraps the parsed API message in an Error instance', async () => {
    const response = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(createApiError(response, 'Request failed')).resolves.toEqual(
      expect.objectContaining({
        message: 'Forbidden',
      }),
    )
  })
})
