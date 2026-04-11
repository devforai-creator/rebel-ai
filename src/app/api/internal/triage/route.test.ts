import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const createAdminClientMock = vi.fn()
const loadDurableServiceHealthStatsMock = vi.fn()
const getAssistantStreamBroadcastStatsMock = vi.fn()
const getChatJobLifecyclePersistenceStatsMock = vi.fn()
const getChatRunnerTriggerStatsMock = vi.fn()
const getSummaryTriggerStatsMock = vi.fn()
const getMessageTranslationTriggerStatsMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/monitoring/service-health-store', () => ({
  SERVICE_HEALTH_LABELS: [
    'assistant-stream-broadcast',
    'chat-job-lifecycle-persistence',
    'chat-job-runner-trigger',
    'summary-generation',
  ],
  createDefaultTriggerStats: (label: string) => ({
    label,
    totalSuccesses: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorMessage: null,
    lastMetadata: null,
  }),
  loadDurableServiceHealthStats: () => loadDurableServiceHealthStatsMock(),
}))

vi.mock('@/lib/chat/assistant-stream-monitor', () => ({
  getAssistantStreamBroadcastStats: () => getAssistantStreamBroadcastStatsMock(),
}))

vi.mock('@/lib/chat/job-lifecycle-store', () => ({
  getChatJobLifecyclePersistenceStats: () => getChatJobLifecyclePersistenceStatsMock(),
}))

vi.mock('@/lib/chat/runner-trigger-monitor', () => ({
  getChatRunnerTriggerStats: () => getChatRunnerTriggerStatsMock(),
}))

vi.mock('@/lib/chat/summary-trigger', () => ({
  getSummaryTriggerStats: () => getSummaryTriggerStatsMock(),
}))

vi.mock('@/lib/chat/translation-trigger-monitor', () => ({
  getMessageTranslationTriggerStats: () => getMessageTranslationTriggerStatsMock(),
}))

import { GET } from './route'

function buildRequest(auth?: string) {
  return new NextRequest('http://localhost/api/internal/triage', {
    method: 'GET',
    headers: auth ? { authorization: auth } : undefined,
  })
}

function createHealthyStats(label: string) {
  return {
    label,
    totalSuccesses: 1,
    totalFailures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: '2026-04-11T10:00:00.000Z',
    lastFailureAt: null,
    lastErrorMessage: null,
    lastMetadata: { label },
  }
}

type ChatGenerationJobsTableMock = {
  select: () => {
    eq: () => {
      gte: ReturnType<typeof vi.fn>
    }
  }
  gteMock: ReturnType<typeof vi.fn>
}

function createChatGenerationJobsTable({
  rows = [],
  error = null,
}: {
  rows?: Array<Record<string, unknown>>
  error?: { message: string } | null
}): ChatGenerationJobsTableMock {
  const gteMock = vi.fn(() => ({
    order: () => ({
      limit: async () => ({
        data: rows,
        error,
      }),
    }),
  }))

  return {
    select: () => ({
      eq: () => ({
        gte: gteMock,
      }),
    }),
    gteMock,
  }
}

describe('GET /api/internal/triage', () => {
  beforeEach(() => {
    restoreEnv()
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    createAdminClientMock.mockReset()
    loadDurableServiceHealthStatsMock.mockReset()
    getAssistantStreamBroadcastStatsMock.mockReset()
    getChatJobLifecyclePersistenceStatsMock.mockReset()
    getChatRunnerTriggerStatsMock.mockReset()
    getSummaryTriggerStatsMock.mockReset()
    getMessageTranslationTriggerStatsMock.mockReset()

    getAssistantStreamBroadcastStatsMock.mockReturnValue(
      createHealthyStats('assistant-stream-broadcast'),
    )
    getChatJobLifecyclePersistenceStatsMock.mockReturnValue(
      createHealthyStats('chat-job-lifecycle-persistence'),
    )
    getChatRunnerTriggerStatsMock.mockReturnValue(createHealthyStats('chat-job-runner-trigger'))
    getSummaryTriggerStatsMock.mockReturnValue(createHealthyStats('summary-generation'))
    getMessageTranslationTriggerStatsMock.mockReturnValue(
      createHealthyStats('message-translation-trigger'),
    )
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET

    const response = await GET(buildRequest('Bearer admin-secret'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Server misconfigured' })
  })

  it('returns 401 when authorization does not match', async () => {
    const response = await GET(buildRequest('Bearer wrong-secret'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns a degraded triage snapshot with recent failed jobs and degraded services', async () => {
    let gteMock: ReturnType<typeof vi.fn> | null = null
    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        expect(table).toBe('chat_generation_jobs')
        const jobsTable = createChatGenerationJobsTable({
          rows: [
            {
              id: 'job-1',
              chat_id: 'chat-1',
              status: 'error',
              error: 'Provider timeout',
              delivery_mode: 'streaming',
              lifecycle_stage: 'requesting_provider',
              failure_stage: 'requesting_provider',
              created_at: '2026-04-11T10:00:00.000Z',
              updated_at: '2026-04-11T10:01:00.000Z',
            },
          ],
        })
        gteMock = jobsTable.gteMock
        return jobsTable
      },
    })

    loadDurableServiceHealthStatsMock.mockResolvedValue(
      new Map([
        [
          'chat-job-runner-trigger',
          {
            label: 'chat-job-runner-trigger',
            totalSuccesses: 4,
            totalFailures: 2,
            consecutiveFailures: 1,
            lastSuccessAt: '2026-04-11T09:59:00.000Z',
            lastFailureAt: '2026-04-11T10:00:30.000Z',
            lastErrorMessage: 'runner down',
            lastMetadata: { jobId: 'job-1' },
          },
        ],
      ]),
    )

    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      status: 'degraded',
      healthSource: 'durable',
      failedJobWindowHours: 72,
      warningServices: [],
      degradedServices: [
        {
          label: 'chat-job-runner-trigger',
          status: 'degraded',
          consecutiveFailures: 1,
          lastErrorMessage: 'runner down',
        },
      ],
      recentFailedJobs: [
        {
          id: 'job-1',
          chatId: 'chat-1',
          status: 'error',
          error: 'Provider timeout',
          deliveryMode: 'streaming',
          lifecycleStage: 'requesting_provider',
          failureStage: 'requesting_provider',
        },
      ],
      experimentalSignals: {
        translationTrigger: {
          label: 'message-translation-trigger',
          status: 'ok',
        },
      },
    })
    if (!gteMock) {
      throw new Error('Expected gte mock to be captured')
    }
    expect(gteMock).toHaveBeenCalledWith('created_at', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
  })

  it('falls back to in-memory health stats when durable stats are unavailable', async () => {
    createAdminClientMock.mockReturnValue({
      from: () => createChatGenerationJobsTable({ rows: [] }),
    })

    loadDurableServiceHealthStatsMock.mockResolvedValue(null)
    getAssistantStreamBroadcastStatsMock.mockReturnValue({
      ...createHealthyStats('assistant-stream-broadcast'),
      totalFailures: 1,
      consecutiveFailures: 1,
      lastFailureAt: '2026-04-11T10:02:00.000Z',
      lastErrorMessage: 'socket down',
    })

    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.healthSource).toBe('memory-fallback')
    expect(body.warningServices).toEqual([])
    expect(body.degradedServices).toEqual([
      expect.objectContaining({
        label: 'assistant-stream-broadcast',
        status: 'degraded',
        consecutiveFailures: 1,
        lastErrorMessage: 'socket down',
      }),
    ])
  })

  it('returns warn when only summary fallback has a single consecutive failure', async () => {
    createAdminClientMock.mockReturnValue({
      from: () => createChatGenerationJobsTable({ rows: [] }),
    })

    getSummaryTriggerStatsMock.mockReturnValue({
      ...createHealthyStats('summary-generation'),
      totalFailures: 1,
      consecutiveFailures: 1,
      lastFailureAt: '2026-04-11T10:02:00.000Z',
      lastErrorMessage: 'summary trigger timeout',
    })

    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('warn')
    expect(body.degradedServices).toEqual([])
    expect(body.warningServices).toEqual([
      expect.objectContaining({
        label: 'summary-generation',
        status: 'warn',
        consecutiveFailures: 1,
        lastErrorMessage: 'summary trigger timeout',
      }),
    ])
  })

  it('returns warn when only the experimental translation trigger is failing', async () => {
    createAdminClientMock.mockReturnValue({
      from: () => createChatGenerationJobsTable({ rows: [] }),
    })

    getMessageTranslationTriggerStatsMock.mockReturnValue({
      ...createHealthyStats('message-translation-trigger'),
      totalFailures: 1,
      consecutiveFailures: 1,
      lastFailureAt: '2026-04-11T10:02:00.000Z',
      lastErrorMessage: 'translator down',
      lastMetadata: { stage: 'dispatch' },
    })

    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('warn')
    expect(body.degradedServices).toEqual([])
    expect(body.warningServices).toEqual([])
    expect(body.experimentalSignals.translationTrigger).toMatchObject({
      label: 'message-translation-trigger',
      status: 'warn',
      consecutiveFailures: 1,
      lastErrorMessage: 'translator down',
      lastMetadata: { stage: 'dispatch' },
    })
  })

  it('returns 500 when failed job lookup fails', async () => {
    createAdminClientMock.mockReturnValue({
      from: () =>
        createChatGenerationJobsTable({
          error: { message: 'db down' },
        }),
    })
    loadDurableServiceHealthStatsMock.mockResolvedValue(new Map())

    const response = await GET(buildRequest('Bearer admin-secret'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to load triage snapshot' })
  })
})
