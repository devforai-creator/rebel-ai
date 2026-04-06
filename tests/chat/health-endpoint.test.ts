import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/internal/health/route'
import {
  __resetChatRunnerTriggerStatsForTest,
  recordChatRunnerTriggerFailure,
} from '@/lib/chat/runner-trigger-monitor'
import {
  __resetSummaryTriggerStatsForTest,
  triggerSummaryGeneration,
} from '@/lib/chat/summary-trigger'

const baseHealthUrl = new URL('https://app.example.com/api/internal/health')
const summaryArgs = {
  origin: 'https://app.example.com',
  chatId: 'chat-1',
  userId: 'user-1',
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  apiKeyId: 'key-1',
}

function buildRequest(authHeader?: string) {
  return new NextRequest(baseHealthUrl, {
    method: 'GET',
    headers: authHeader ? new Headers({ authorization: authHeader }) : undefined,
  })
}

beforeEach(() => {
  __resetChatRunnerTriggerStatsForTest()
  __resetSummaryTriggerStatsForTest()
  process.env.CHAT_ADMIN_SECRET = 'admin-secret'
  process.env.SUMMARY_GENERATION_SECRET = 'summary-secret'
})

describe('internal health endpoint', () => {
  it('rejects unauthorized requests', async () => {
    const response = await GET(buildRequest())
    expect(response.status).toBe(401)
  })

  it('returns ok status when no consecutive failures exist', async () => {
    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.services.chatRunnerTrigger.status).toBe('ok')
    expect(body.services.summaryTrigger.status).toBe('ok')
  })

  it('reports degraded status when triggers are failing', async () => {
    recordChatRunnerTriggerFailure(new Error('cron never reached'), { attempt: 1 })

    await triggerSummaryGeneration(summaryArgs, {
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })

    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.services.chatRunnerTrigger.status).toBe('degraded')
    expect(body.services.summaryTrigger.status).toBe('degraded')
  })
})
