#!/usr/bin/env node

/**
 * Utility script to trigger the background character import runner locally.
 *
 * Usage:
 *   npm run character:jobs -- [limit]
 *
 * Loads environment variables from `.env.local`/`.env` automatically.
 * Optionally override the endpoint with CHARACTER_IMPORT_RUNNER_URL.
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
    console.error('CHAT_ADMIN_SECRET is required to run character import jobs.')
    process.exit(1)
  }

  const limitArg = process.argv[2]
  const limit =
    typeof limitArg === 'string' && Number(limitArg) > 0 ? Math.min(Number(limitArg), 5) : 1

  const endpoint =
    process.env.CHARACTER_IMPORT_RUNNER_URL ??
    process.env.CHARX_IMPORT_RUNNER_URL ??
    'http://localhost:3000/api/internal/character-import-runner'

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
      throw new Error(
        `Character import runner failed (${response.status}): ${errorText || 'Unknown error'}`,
      )
    }

    const result = await response.json()
    console.log('[character-import-runner]', JSON.stringify(result, null, 2))
  } catch (error) {
    console.error('[character-import-runner] Failed to process jobs:', error)
    process.exit(1)
  }
}

void main()
