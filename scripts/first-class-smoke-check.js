#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

const DEFAULT_TIMEOUT_MS = 10_000

function loadEnvFiles(cwd = process.cwd()) {
  for (const file of ['.env.local', '.env']) {
    const envPath = path.join(cwd, file)
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath })
    }
  }
}

function parseArgs(argv) {
  const options = {
    activeRunners: false,
    origin: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--active-runners') {
      options.activeRunners = true
      continue
    }

    if (arg === '--origin') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('--origin requires a value')
      }
      options.origin = value
      index += 1
      continue
    }

    if (arg === '--timeout-ms') {
      const value = argv[index + 1]
      const parsed = Number(value)
      if (!value || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--timeout-ms requires a positive number')
      }
      options.timeoutMs = parsed
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function resolveAppOrigin({ explicitOrigin, env = process.env }) {
  return (
    explicitOrigin ||
    env.SMOKE_CHECK_APP_ORIGIN ||
    env.INTERNAL_API_ORIGIN ||
    'http://127.0.0.1:3000'
  )
}

function createCheckDefinitions({ origin, adminSecret, activeRunners }) {
  const baseHeaders = {
    Authorization: `Bearer ${adminSecret}`,
  }

  const checks = [
    {
      key: 'health',
      label: 'internal health',
      url: new URL('/api/internal/health', origin),
      init: {
        method: 'GET',
        headers: baseHeaders,
      },
      evaluate(response, body) {
        if (!response.ok && response.status !== 503) {
          return {
            status: 'fail',
            summary: `unexpected HTTP ${response.status}`,
            details: body,
          }
        }

        if (!body || typeof body !== 'object' || !body.services) {
          return {
            status: 'fail',
            summary: 'missing services payload',
            details: body,
          }
        }

        if (body.status === 'degraded') {
          return {
            status: 'warn',
            summary: 'health degraded',
            details: {
              healthSource: body.healthSource ?? null,
              degradedServices: Object.values(body.services)
                .filter((service) => service && service.status === 'degraded')
                .map((service) => service.label),
            },
          }
        }

        return {
          status: 'pass',
          summary: 'health ok',
          details: {
            healthSource: body.healthSource ?? null,
          },
        }
      },
    },
    {
      key: 'triage',
      label: 'internal triage',
      url: new URL('/api/internal/triage', origin),
      init: {
        method: 'GET',
        headers: baseHeaders,
      },
      evaluate(response, body) {
        if (!response.ok && response.status !== 503) {
          return {
            status: 'fail',
            summary: `unexpected HTTP ${response.status}`,
            details: body,
          }
        }

        if (!body || typeof body !== 'object' || !Array.isArray(body.recentFailedJobs)) {
          return {
            status: 'fail',
            summary: 'missing triage payload',
            details: body,
          }
        }

        if (body.status === 'degraded') {
          return {
            status: 'warn',
            summary: 'triage reports degraded state',
            details: {
              degradedServiceCount: Array.isArray(body.degradedServices)
                ? body.degradedServices.length
                : null,
              recentFailedJobCount: body.recentFailedJobs.length,
            },
          }
        }

        return {
          status: 'pass',
          summary: 'triage ok',
          details: {
            recentFailedJobCount: body.recentFailedJobs.length,
          },
        }
      },
    },
    {
      key: 'storage-janitor-dry-run',
      label: 'storage janitor dry-run',
      url: new URL('/api/internal/storage-janitor', origin),
      init: {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          execute: false,
          olderThanDays: 1,
          maxDelete: 10,
          sampleSize: 5,
        }),
      },
      evaluate(response, body) {
        if (!response.ok) {
          return {
            status: 'fail',
            summary: `unexpected HTTP ${response.status}`,
            details: body,
          }
        }

        if (!body || typeof body !== 'object' || body.ok !== true || body.mode !== 'dry-run') {
          return {
            status: 'fail',
            summary: 'unexpected janitor response',
            details: body,
          }
        }

        return {
          status: 'pass',
          summary: 'janitor dry-run ok',
          details: {
            characterAssetOrphans: body.results?.characterAssets?.orphanCount ?? null,
            moduleAssetOrphans: body.results?.moduleAssets?.orphanCount ?? null,
          },
        }
      },
    },
  ]

  if (activeRunners) {
    checks.push(
      {
        key: 'chat-runner',
        label: 'chat runner active probe',
        url: new URL('/api/internal/chat-job-runner', origin),
        init: {
          method: 'POST',
          headers: {
            ...baseHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ limit: 1 }),
        },
        evaluate(response, body) {
          if (!response.ok) {
            return {
              status: 'fail',
              summary: `unexpected HTTP ${response.status}`,
              details: body,
            }
          }

          if (!body || typeof body !== 'object' || typeof body.processedCount !== 'number') {
            return {
              status: 'fail',
              summary: 'unexpected chat runner response',
              details: body,
            }
          }

          return {
            status: 'pass',
            summary: 'chat runner responded',
            details: {
              processedCount: body.processedCount,
            },
          }
        },
      },
      {
        key: 'character-import-runner',
        label: 'character import runner active probe',
        url: new URL('/api/internal/character-import-runner', origin),
        init: {
          method: 'POST',
          headers: {
            ...baseHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ limit: 1 }),
        },
        evaluate(response, body) {
          if (!response.ok) {
            return {
              status: 'fail',
              summary: `unexpected HTTP ${response.status}`,
              details: body,
            }
          }

          if (!body || typeof body !== 'object' || typeof body.processedCount !== 'number') {
            return {
              status: 'fail',
              summary: 'unexpected import runner response',
              details: body,
            }
          }

          return {
            status: 'pass',
            summary: 'character import runner responded',
            details: {
              processedCount: body.processedCount,
            },
          }
        },
      },
    )
  }

  return checks
}

async function runSmokeChecks({ checks, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const results = []

  for (const check of checks) {
    try {
      const response = await fetchImpl(check.url, {
        ...check.init,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const body = await readResponseBody(response)
      const evaluated = check.evaluate(response, body)
      results.push({
        key: check.key,
        label: check.label,
        url: check.url.toString(),
        httpStatus: response.status,
        ...evaluated,
      })
    } catch (error) {
      results.push({
        key: check.key,
        label: check.label,
        url: check.url.toString(),
        httpStatus: null,
        status: 'fail',
        summary: error instanceof Error ? error.message : String(error),
        details: null,
      })
    }
  }

  return results
}

async function readResponseBody(response) {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function summarizeResults(results) {
  const hasFailures = results.some((result) => result.status === 'fail')
  const hasWarnings = results.some((result) => result.status === 'warn')

  return {
    ok: !hasFailures && !hasWarnings,
    hasFailures,
    hasWarnings,
  }
}

function printResults({ origin, activeRunners, results }) {
  console.log(`[first-class-smoke-check] origin=${origin}`)
  console.log(
    `[first-class-smoke-check] mode=${activeRunners ? 'active-runners' : 'passive-readonly'}`,
  )

  for (const result of results) {
    const prefix =
      result.status === 'pass' ? '[PASS]' : result.status === 'warn' ? '[WARN]' : '[FAIL]'
    console.log(`${prefix} ${result.label} (${result.httpStatus ?? 'network'}) ${result.summary}`)
    if (result.details) {
      console.log(`       ${JSON.stringify(result.details)}`)
    }
  }

  const summary = summarizeResults(results)
  console.log(
    `[first-class-smoke-check] summary=${summary.ok ? 'ok' : summary.hasFailures ? 'fail' : 'warn'}`,
  )

  return summary
}

async function main() {
  loadEnvFiles()

  try {
    const args = parseArgs(process.argv.slice(2))
    const adminSecret = process.env.CHAT_ADMIN_SECRET

    if (!adminSecret) {
      throw new Error('CHAT_ADMIN_SECRET is required for smoke checks.')
    }

    const origin = resolveAppOrigin({
      explicitOrigin: args.origin,
      env: process.env,
    })
    const checks = createCheckDefinitions({
      origin,
      adminSecret,
      activeRunners: args.activeRunners,
    })
    const results = await runSmokeChecks({
      checks,
      timeoutMs: args.timeoutMs,
    })
    const summary = printResults({
      origin,
      activeRunners: args.activeRunners,
      results,
    })

    if (!summary.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    console.error(
      '[first-class-smoke-check] Failed:',
      error instanceof Error ? error.message : String(error),
    )
    process.exit(1)
  }
}

if (require.main === module) {
  void main()
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  createCheckDefinitions,
  parseArgs,
  printResults,
  resolveAppOrigin,
  runSmokeChecks,
  summarizeResults,
}
