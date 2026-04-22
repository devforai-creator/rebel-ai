import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

function buildRequest(body: unknown, authHeader?: string) {
  return new NextRequest('http://localhost/api/internal/chat-admin', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : undefined,
    body: JSON.stringify(body),
  })
}

function buildRawRequest(rawBody: string, authHeader?: string) {
  return new NextRequest('http://localhost/api/internal/chat-admin', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : undefined,
    body: rawBody,
  })
}

describe('POST /api/internal/chat-admin', () => {
  beforeEach(() => {
    vi.resetModules()
    createAdminClientMock.mockReset()
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Server misconfigured' })
  })

  it('returns 401 when secret does not match', async () => {
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer wrong'))

    expect(response.status).toBe(401)
  })

  it('returns 401 when authorization header is missing', async () => {
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(401)
  })

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer admin-secret'))

    expect(response.status).toBe(400)
  })

  it('returns 400 for malformed JSON body', async () => {
    const { POST } = await import('./route')

    const response = await POST(buildRawRequest('{ bad-json', 'Bearer admin-secret'))

    expect(response.status).toBe(400)
  })

  it('handles checkAnonRateLimit requests', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: true, remaining: 9, retry_after: null }],
      error: null,
    })
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const payload = {
      action: 'checkAnonRateLimit',
      requester: 'anonymous-user',
      args: {
        identifier: 'id-1',
        window_seconds: 60,
        max_requests: 10,
      },
    }

    const response = await POST(buildRequest(payload, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      data: [{ allowed: true, remaining: 9, retry_after: null }],
    })
    expect(rpc).toHaveBeenCalledWith('check_anon_rate_limit', payload.args)
  })

  it('returns 500 when checkAnonRateLimit RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'XX000' },
    })
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          action: 'checkAnonRateLimit',
          requester: 'anonymous-user',
          args: {
            identifier: 'id-1',
            window_seconds: 60,
            max_requests: 10,
          },
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(500)
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('returns 403 when requester does not match target_user_id', async () => {
    const rpc = vi.fn()
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          action: 'checkUserRateLimit',
          requester: 'user-1',
          args: {
            target_user_id: 'user-2',
            window_seconds: 60,
            max_requests: 30,
          },
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('handles checkUserRateLimit requests', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: true, remaining: 29, retry_after: null }],
      error: null,
    })
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const payload = {
      action: 'checkUserRateLimit',
      requester: 'user-1',
      args: {
        target_user_id: 'user-1',
        window_seconds: 60,
        max_requests: 30,
      },
    }

    const response = await POST(buildRequest(payload, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      data: [{ allowed: true, remaining: 29, retry_after: null }],
    })
    expect(rpc).toHaveBeenCalledWith('check_chat_rate_limit', payload.args)
  })

  it('returns 500 when checkUserRateLimit RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'XX001' },
    })
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          action: 'checkUserRateLimit',
          requester: 'user-1',
          args: {
            target_user_id: 'user-1',
            window_seconds: 60,
            max_requests: 30,
          },
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(500)
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('returns 403 when decryptSecret requester does not match args.requester', async () => {
    const rpc = vi.fn()
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          action: 'decryptSecret',
          requester: 'user-1',
          args: {
            secret_name: 'vault-key',
            requester: 'user-2',
          },
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('handles decryptSecret requests', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'sk-test', error: null })
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const payload = {
      action: 'decryptSecret',
      requester: 'user-1',
      args: {
        secret_name: 'vault-key',
        requester: 'user-1',
      },
    }

    const response = await POST(buildRequest(payload, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ data: 'sk-test' })
    expect(rpc).toHaveBeenCalledWith('get_decrypted_secret', payload.args)
  })

  it('returns 500 when decryptSecret RPC returns an error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'XX002' } })
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          action: 'decryptSecret',
          requester: 'user-1',
          args: {
            secret_name: 'vault-key',
            requester: 'user-1',
          },
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(500)
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('returns 500 when decryptSecret RPC returns empty data', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    createAdminClientMock.mockReturnValue({ rpc })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          action: 'decryptSecret',
          requester: 'user-1',
          args: {
            secret_name: 'vault-key',
            requester: 'user-1',
          },
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(500)
    expect(rpc).toHaveBeenCalledOnce()
  })
})
