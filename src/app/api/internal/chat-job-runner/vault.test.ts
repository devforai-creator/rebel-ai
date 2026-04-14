import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('chat job runner vault helper', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the decrypted secret when the RPC succeeds', async () => {
    const rpc = vi.fn(async () => ({ data: 'sk-test', error: null }))
    const { decryptSecret } = await import('./vault')

    await expect(
      decryptSecret({
        supabase: { rpc } as never,
        secretName: 'secret-name',
        requester: 'user-1',
      }),
    ).resolves.toBe('sk-test')
    expect(rpc).toHaveBeenCalledWith('get_decrypted_secret', {
      secret_name: 'secret-name',
      requester: 'user-1',
    })
  })

  it('throws with RPC details when decryption fails', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: '42501',
        message: 'permission denied',
        details: 'requester mismatch',
      },
    }))
    const { decryptSecret } = await import('./vault')

    await expect(
      decryptSecret({
        supabase: { rpc } as never,
        secretName: 'secret-name',
        requester: 'user-1',
      }),
    ).rejects.toThrow('Failed to decrypt API key: permission denied')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Chat Job Runner] Vault decryption RPC failed',
      expect.objectContaining({
        secretName: 'secret-name',
        requester: 'user-1',
        errorCode: '42501',
        errorMessage: 'permission denied',
        errorDetails: 'requester mismatch',
      }),
    )
  })

  it('throws when the RPC returns no secret value', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    const { decryptSecret } = await import('./vault')

    await expect(
      decryptSecret({
        supabase: { rpc } as never,
        secretName: 'secret-name',
        requester: 'user-1',
      }),
    ).rejects.toThrow(
      'API key decryption returned empty result. Secret may have been deleted or access denied.',
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Chat Job Runner] Vault decryption returned empty',
      expect.objectContaining({
        secretName: 'secret-name',
        requester: 'user-1',
      }),
    )
  })
})
