import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  __resetAssistantStreamBroadcastStatsForTest,
  recordAssistantStreamBroadcastFailure,
  recordAssistantStreamBroadcastSuccess,
} from '@/lib/chat/assistant-stream-monitor'
import { __resetChatRunnerTriggerStatsForTest } from '@/lib/chat/runner-trigger-monitor'
import { __resetSummaryTriggerStatsForTest } from '@/lib/chat/summary-trigger'
import { GET } from './route'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function buildRequest(auth?: string) {
  return new NextRequest('http://localhost/api/internal/health', {
    method: 'GET',
    headers: auth ? { authorization: auth } : undefined,
  })
}

describe('GET /api/internal/health', () => {
  beforeEach(() => {
    restoreEnv()
    __resetAssistantStreamBroadcastStatsForTest()
    __resetChatRunnerTriggerStatsForTest()
    __resetSummaryTriggerStatsForTest()
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET

    const response = await GET(buildRequest('Bearer test-secret'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Server misconfigured' })
  })

  it('returns 401 when authorization does not match', async () => {
    process.env.CHAT_ADMIN_SECRET = 'test-secret'

    const response = await GET(buildRequest('Bearer wrong-secret'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns assistant stream stats when services are healthy', async () => {
    process.env.CHAT_ADMIN_SECRET = 'test-secret'
    recordAssistantStreamBroadcastSuccess({
      chatId: 'chat-1',
      jobId: 'job-1',
      kind: 'snapshot',
      stage: 'send',
      status: 'ok',
    })

    const response = await GET(buildRequest('Bearer test-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.services.assistantStreamBroadcast).toMatchObject({
      label: 'assistant-stream-broadcast',
      status: 'ok',
      totalSuccesses: 1,
      totalFailures: 0,
      consecutiveFailures: 0,
      lastMetadata: {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'snapshot',
        stage: 'send',
        status: 'ok',
      },
    })
  })

  it('returns degraded when assistant stream broadcasts are failing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'test-secret'
    recordAssistantStreamBroadcastFailure(new Error('socket down'), {
      chatId: 'chat-1',
      jobId: 'job-1',
      kind: 'error',
      stage: 'send',
    })

    const response = await GET(buildRequest('Bearer test-secret'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.services.assistantStreamBroadcast).toMatchObject({
      label: 'assistant-stream-broadcast',
      status: 'degraded',
      totalFailures: 1,
      consecutiveFailures: 1,
      lastErrorMessage: 'socket down',
      lastMetadata: {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'error',
        stage: 'send',
      },
    })
  })
})
