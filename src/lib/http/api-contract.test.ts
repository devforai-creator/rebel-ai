import { describe, expect, it } from 'vitest'
import {
  createApiError,
  readApiErrorMessage,
  requireAnyBearerToken,
  requireBearerToken,
} from './api-contract'

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

describe('requireBearerToken', () => {
  it('returns a 500 response when the expected token is missing', async () => {
    const request = new Request('http://localhost/test', {
      headers: { authorization: 'Bearer anything' },
    })

    const result = requireBearerToken(request, null)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected auth failure')
    }

    expect(result.response.status).toBe(500)
    await expect(result.response.json()).resolves.toEqual({ error: 'Server misconfigured' })
  })

  it('returns success when the bearer token matches', () => {
    const request = new Request('http://localhost/test', {
      headers: { authorization: 'Bearer admin-secret' },
    })

    expect(requireBearerToken(request, 'admin-secret')).toEqual({ success: true })
  })
})

describe('requireAnyBearerToken', () => {
  it('returns success when any configured token matches', () => {
    const request = new Request('http://localhost/test', {
      headers: { authorization: 'Bearer cron-secret' },
    })

    expect(requireAnyBearerToken(request, [undefined, 'admin-secret', 'cron-secret'])).toEqual({
      success: true,
    })
  })

  it('returns 401 when the header does not match any configured token', async () => {
    const request = new Request('http://localhost/test', {
      headers: { authorization: 'Bearer wrong-secret' },
    })

    const result = requireAnyBearerToken(request, ['admin-secret', 'cron-secret'])

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected auth failure')
    }

    expect(result.response.status).toBe(401)
    await expect(result.response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})
