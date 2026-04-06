#!/usr/bin/env node

/**
 * Utility script to trigger the chat job runner locally.
 *
 * Usage:
 *   npm run chat:jobs [limit]
 *
 * Environment resolution order:
 *   1. Existing process.env variables (e.g., CI secrets)
 *   2. `.env.local` (if present)
 *
 * Optionally set CHAT_JOB_RUNNER_URL to override the default endpoint.
 */
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

const envFiles = ['.env.local', '.env']
for (const file of envFiles) {
  const envPath = path.join(process.cwd(), file)
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
}
async function main() {
  const secret = process.env.CHAT_ADMIN_SECRET
  if (!secret) {
    console.error('CHAT_ADMIN_SECRET is required to run chat jobs.')
    process.exit(1)
  }

  const limitArg = process.argv[2]
  const limit =
    typeof limitArg === 'string' && Number(limitArg) > 0 ? Math.min(Number(limitArg), 5) : 1

  const endpoint =
    process.env.CHAT_JOB_RUNNER_URL ?? 'http://localhost:3000/api/internal/chat-job-runner'

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ limit }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Job runner failed (${response.status}): ${errorText || 'Unknown error'}`)
    }

    const result = await response.json()
    console.log('[chat-job-runner]', JSON.stringify(result, null, 2))
  } catch (error) {
    console.error('[chat-job-runner] Failed to process jobs:', error)
    process.exit(1)
  }
}

void main()
