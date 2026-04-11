import { describe, expect, it, vi } from 'vitest'
import smokeCheck from './first-class-smoke-check.js'

const {
  DEFAULT_TIMEOUT_MS,
  createCheckDefinitions,
  parseArgs,
  resolveAppOrigin,
  runSmokeChecks,
  summarizeResults,
} = smokeCheck

describe('first-class-smoke-check', () => {
  it('parses active runner, origin, and timeout flags', () => {
    expect(
      parseArgs(['--active-runners', '--origin', 'https://example.com', '--timeout-ms', '5000']),
    ).toEqual({
      activeRunners: true,
      origin: 'https://example.com',
      timeoutMs: 5000,
    })
  })

  it('resolves origin using explicit argument first', () => {
    expect(
      resolveAppOrigin({
        explicitOrigin: 'https://explicit.example.com',
        env: {
          SMOKE_CHECK_APP_ORIGIN: 'https://env.example.com',
          INTERNAL_API_ORIGIN: 'https://internal.example.com',
        },
      }),
    ).toBe('https://explicit.example.com')
  })

  it('creates passive checks by default and adds active runner probes on demand', () => {
    const passive = createCheckDefinitions({
      origin: 'https://example.com',
      adminSecret: 'secret',
      activeRunners: false,
    })
    const active = createCheckDefinitions({
      origin: 'https://example.com',
      adminSecret: 'secret',
      activeRunners: true,
    })

    expect(passive.map((check) => check.key)).toEqual([
      'health',
      'triage',
      'storage-janitor-dry-run-dispatch',
    ])
    expect(active.map((check) => check.key)).toEqual([
      'health',
      'triage',
      'storage-janitor-dry-run-dispatch',
      'chat-runner',
      'character-import-runner',
    ])
    expect(passive[2].url.toString()).toContain('/api/internal/storage-janitor?')
    expect(passive[2].url.searchParams.get('dryRun')).toBe('1')
  })

  it('marks degraded health and triage as warnings and preserves janitor dispatch success', async () => {
    const checks = createCheckDefinitions({
      origin: 'https://example.com',
      adminSecret: 'secret',
      activeRunners: false,
    })

    const responseBodies = [
      {
        status: 'degraded',
        healthSource: 'durable',
        services: {
          assistantStreamBroadcast: {
            label: 'assistant-stream-broadcast',
            status: 'ok',
          },
          chatRunnerTrigger: {
            label: 'chat-job-runner-trigger',
            status: 'degraded',
          },
          summaryTrigger: {
            label: 'summary-generation',
            status: 'ok',
          },
        },
      },
      {
        status: 'degraded',
        degradedServices: [{ label: 'chat-job-runner-trigger' }],
        recentFailedJobs: [{ id: 'job-1' }],
      },
      {
        triggered: true,
        mode: 'dry-run',
        olderThanDays: 1,
        maxDelete: 10,
      },
    ]

    const fetchImpl = vi.fn().mockImplementation(async () => {
      const body = responseBodies.shift()
      return {
        ok: body?.status !== 'degraded',
        status: body?.status === 'degraded' ? 503 : body?.triggered ? 202 : 200,
        text: async () => JSON.stringify(body),
      }
    })

    const results = await runSmokeChecks({
      checks,
      fetchImpl,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })

    expect(results.map((result) => result.status)).toEqual(['warn', 'warn', 'pass'])
    expect(summarizeResults(results)).toEqual({
      ok: false,
      hasFailures: false,
      hasWarnings: true,
    })
  })

  it('marks thrown fetch errors as failures', async () => {
    const checks = [
      {
        key: 'health',
        label: 'internal health',
        url: new URL('https://example.com/api/internal/health'),
        init: { method: 'GET' },
        evaluate() {
          return { status: 'pass', summary: 'ok', details: null }
        },
      },
    ]

    const results = await runSmokeChecks({
      checks,
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down')),
    })

    expect(results).toEqual([
      expect.objectContaining({
        key: 'health',
        status: 'fail',
        summary: 'network down',
      }),
    ])
  })
})
