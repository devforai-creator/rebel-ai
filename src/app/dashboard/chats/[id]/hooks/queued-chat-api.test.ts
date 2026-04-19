// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '@/types/database.types'
import { fetchChatJobStatus, fetchLatestChatMessage, requestQueuedChatJob } from './queued-chat-api'

function createJsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn(async () => payload),
    text: vi.fn(async () => JSON.stringify(payload)),
  }
}

function stubFetch(mockImpl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(mockImpl) as unknown as typeof fetch)
}

describe('queued-chat-api', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the latest chat message when the endpoint succeeds', async () => {
    const latestMessage = { id: 'message-1', role: 'assistant' } as Message
    stubFetch(async () => createJsonResponse(latestMessage))

    await expect(fetchLatestChatMessage('chat-1')).resolves.toEqual(latestMessage)
  })

  it('returns null when the latest-message endpoint responds non-200', async () => {
    stubFetch(async () => createJsonResponse({ error: 'missing' }, false, 404))

    await expect(fetchLatestChatMessage('chat-1')).resolves.toBeNull()
  })

  it('returns null and logs when latest-message fetch throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch(async () => {
      throw new Error('network down')
    })

    await expect(fetchLatestChatMessage('chat-1')).resolves.toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch latest message:',
      expect.any(Error),
    )
  })

  it('returns job status payloads for successful polling responses', async () => {
    stubFetch(async () => createJsonResponse({ status: 'processing' }))

    await expect(fetchChatJobStatus('job-1')).resolves.toEqual({ status: 'processing' })
  })

  it('returns null when job polling receives a non-ok response', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubFetch(async () => createJsonResponse({ error: 'oops' }, false, 503))

    await expect(fetchChatJobStatus('job-1')).resolves.toBeNull()
    expect(consoleWarnSpy).toHaveBeenCalledWith('Job status check failed (503), retrying...')
  })

  it('throws the response text when queue creation fails', async () => {
    stubFetch(async () => ({
      ok: false,
      text: vi.fn(async () => 'queue failed'),
    }))

    await expect(
      requestQueuedChatJob({
        chatId: 'chat-1',
        apiKeyId: 'key-1',
        userMessage: 'hello',
        deliveryMode: 'streaming',
      }),
    ).rejects.toThrow('queue failed')
  })

  it('returns the job id when queue creation succeeds with a slim userMessage payload', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ jobId: 'job-1' }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(
      requestQueuedChatJob({
        chatId: 'chat-1',
        apiKeyId: 'key-1',
        userMessage: 'hello',
        deliveryMode: 'streaming',
      }),
    ).resolves.toEqual({ jobId: 'job-1' })

    expect(fetchMock).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'key-1',
        userMessage: 'hello',
        deliveryMode: 'streaming',
      }),
    })
  })

  it('sends regeneration requests without a transcript payload', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ jobId: 'job-1' }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(
      requestQueuedChatJob({
        chatId: 'chat-1',
        apiKeyId: 'key-1',
        deliveryMode: 'streaming',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
      }),
    ).resolves.toEqual({ jobId: 'job-1' })

    expect(fetchMock).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: 'chat-1',
        apiKeyId: 'key-1',
        deliveryMode: 'streaming',
        isRegeneration: true,
        regenerateAssistantMessageId: 'assistant-1',
      }),
    })
  })
})
