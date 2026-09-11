#!/usr/bin/env node
// Trusted desktop backend. It owns admin DB credentials; it is not an untrusted agent.
const { spawn } = require('node:child_process')
const { setTimeout: sleep } = require('node:timers/promises')
const fs = require('node:fs')
if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local')

async function main() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CHAT_ADMIN_SECRET',
    'LOCAL_LLM_OWNER_ID',
    'LOCAL_LLM_BASE_URL',
  ]
  if (process.env.VERCEL || required.some((key) => !process.env[key])) {
    throw new Error('configuration')
  }
  const port = Number(process.env.LOCAL_WORKER_PORT ?? 3100)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port')
  const origin = 'http://127.0.0.1:' + port
  const child = spawn(
    process.execPath,
    process.env.LOCAL_WORKER_STANDALONE === 'true'
      ? ['server.js']
      : [
          require.resolve('next/dist/bin/next'),
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(port),
        ],
    {
      // Pipeline diagnostics may contain private content. Never relay them to the controller.
      stdio: ['ignore', 'ignore', 'ignore'],
      env: {
        ...process.env,
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
        CHAT_RUNNER_TARGET: 'local',
        LOCAL_LLM_ENABLED: 'true',
        LOCAL_LLM_QUEUE_ENABLED: 'true',
        INTERNAL_API_ORIGIN: origin,
      },
    },
  )
  let stopped = false
  let childFailed = false
  const stop = () => {
    stopped = true
    child.kill('SIGTERM')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  child.once('error', () => {
    childFailed = true
    stopped = true
  })
  child.once('exit', () => {
    childFailed = !stopped
    stopped = true
  })
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + process.env.CHAT_ADMIN_SECRET,
  }
  const request = (path, body, timeout) =>
    fetch(origin + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    })
  let heartbeatBusy = false
  const heartbeat = async () => {
    if (heartbeatBusy || stopped) return false
    heartbeatBusy = true
    try {
      const response = await request('/api/internal/local-worker', {}, 10000)
      await response.body?.cancel()
      return response.ok
    } catch {
      return false
    } finally {
      heartbeatBusy = false
    }
  }
  try {
    let ready = false
    for (let attempt = 0; attempt < 30 && !stopped; attempt++) {
      if (await heartbeat()) {
        ready = true
        break
      }
      await sleep(2000)
    }
    if (!ready) throw new Error('startup')
    console.log('Local worker ready. No prompt or response text is logged.')
    const timer = setInterval(() => {
      void heartbeat()
    }, 10000)
    try {
      while (!stopped) {
        try {
          const response = await request('/api/internal/chat-job-runner', { limit: 1 }, 790000)
          // Never print job IDs, payloads or provider error bodies.
          if (response.ok) {
            const result = await response.json()
            if (result.processedCount)
              console.log(
                JSON.stringify({
                  processed: result.processedCount,
                  succeeded: result.results.filter((row) => row.status === 'success').length,
                  failed: result.results.filter((row) => row.status === 'error').length,
                }),
              )
          } else {
            await response.body?.cancel()
            console.log('Worker request failed; check configuration.')
          }
        } catch {
          if (!stopped) console.log('Worker connection interrupted; waiting.')
        }
        if (!stopped) await sleep(3000)
      }
    } finally {
      clearInterval(timer)
    }
    if (childFailed) throw new Error('backend')
  } finally {
    stop()
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}
main().catch(() => {
  console.error('Local worker stopped: configuration or backend check required.')
  process.exitCode = 1
})
