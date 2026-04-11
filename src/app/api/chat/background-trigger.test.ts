import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const hoistedMocks = vi.hoisted(() => {
  const afterMock = vi.fn((callback: () => void | Promise<void>) => callback())
  const buildInternalApiUrlMock = vi.fn(
    (path: string | URL) => new URL(path, 'https://internal.example.com'),
  )
  const recordChatRunnerTriggerSuccessMock = vi.fn()
  const recordChatRunnerTriggerFailureMock = vi.fn()

  return {
    afterMock,
    buildInternalApiUrlMock,
    recordChatRunnerTriggerSuccessMock,
    recordChatRunnerTriggerFailureMock,
  }
})

const afterMock = hoistedMocks.afterMock
const buildInternalApiUrlMock = hoistedMocks.buildInternalApiUrlMock
const recordChatRunnerTriggerSuccessMock = hoistedMocks.recordChatRunnerTriggerSuccessMock
const recordChatRunnerTriggerFailureMock = hoistedMocks.recordChatRunnerTriggerFailureMock

async function flushBackgroundTask() {
  await afterMock.mock.results.at(-1)?.value
}

vi.mock('next/server', () => ({
  after: (callback: () => void | Promise<void>) => afterMock(callback),
}))

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrl: (...args: Parameters<typeof buildInternalApiUrlMock>) =>
    buildInternalApiUrlMock(...args),
}))

vi.mock('@/lib/chat/runner-trigger-monitor', () => ({
  recordChatRunnerTriggerSuccess: (
    ...args: Parameters<typeof recordChatRunnerTriggerSuccessMock>
  ) => recordChatRunnerTriggerSuccessMock(...args),
  recordChatRunnerTriggerFailure: (
    ...args: Parameters<typeof recordChatRunnerTriggerFailureMock>
  ) => recordChatRunnerTriggerFailureMock(...args),
}))

import { scheduleChatJobRunnerTrigger } from './background-trigger'

describe('scheduleChatJobRunnerTrigger', () => {
  const fetchMock = vi.fn<typeof global.fetch>()

  beforeEach(() => {
    restoreEnv()
    process.env.CHAT_ADMIN_SECRET = 'test-chat-admin-secret'
    afterMock.mockClear()
    buildInternalApiUrlMock.mockReset()
    buildInternalApiUrlMock.mockImplementation((path: string | URL) => {
      return new URL(path, 'https://internal.example.com')
    })
    recordChatRunnerTriggerSuccessMock.mockClear()
    recordChatRunnerTriggerFailureMock.mockClear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ triggered: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    restoreEnv()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('records a success when the trigger request succeeds', async () => {
    scheduleChatJobRunnerTrigger({
      chatId: 'chat-1',
      jobId: 'job-1',
      requestId: 'req-1',
    })

    await flushBackgroundTask()

    expect(afterMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://internal.example.com/api/internal/chat-job-runner/trigger',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-chat-admin-secret',
        },
      },
    )
    expect(recordChatRunnerTriggerSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        status: 202,
      }),
    )
    expect(recordChatRunnerTriggerFailureMock).not.toHaveBeenCalled()
  })

  it('records a failure when CHAT_ADMIN_SECRET is missing', () => {
    delete process.env.CHAT_ADMIN_SECRET
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    scheduleChatJobRunnerTrigger({
      chatId: 'chat-1',
      jobId: 'job-1',
      requestId: 'req-1',
    })

    expect(afterMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(recordChatRunnerTriggerFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'CHAT_ADMIN_SECRET is not configured',
      }),
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        stage: 'schedule',
      }),
    )
    expect(errorSpy).toHaveBeenCalledWith(
      '[Chat API] CHAT_ADMIN_SECRET missing; cannot trigger job runner',
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
      }),
    )
  })

  it('records a failure when trigger URL resolution fails', async () => {
    buildInternalApiUrlMock.mockImplementation(() => {
      throw new Error('bad internal origin')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    scheduleChatJobRunnerTrigger({
      chatId: 'chat-1',
      jobId: 'job-1',
      requestId: 'req-1',
    })

    await flushBackgroundTask()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(recordChatRunnerTriggerFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'bad internal origin',
      }),
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        stage: 'resolve-trigger-url',
      }),
    )
    expect(errorSpy).toHaveBeenCalledWith(
      '[Chat API] Failed to resolve job runner trigger URL',
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        error: 'bad internal origin',
      }),
    )
  })

  it('records a failure when the trigger responds with a non-OK status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('runner down', { status: 503 }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    scheduleChatJobRunnerTrigger({
      chatId: 'chat-1',
      jobId: 'job-1',
      requestId: 'req-1',
    })

    await flushBackgroundTask()

    expect(recordChatRunnerTriggerFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Job runner trigger responded with status 503: runner down',
      }),
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        status: 503,
      }),
    )
    expect(recordChatRunnerTriggerSuccessMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      '[Chat API] Job runner trigger responded with non-OK status',
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        status: 503,
        body: 'runner down',
      }),
    )
  })

  it('records a failure when the trigger fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    scheduleChatJobRunnerTrigger({
      chatId: 'chat-1',
      jobId: 'job-1',
      requestId: 'req-1',
    })

    await flushBackgroundTask()

    expect(recordChatRunnerTriggerFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'network down',
      }),
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        stage: 'fetch-trigger',
      }),
    )
    expect(errorSpy).toHaveBeenCalledWith(
      '[Chat API] Failed to trigger job runner',
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-1',
        requestId: 'req-1',
        error: 'network down',
      }),
    )
  })
})
