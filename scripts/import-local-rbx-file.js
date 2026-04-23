#!/usr/bin/env node

/**
 * Import a local .rbx archive through the guarded maintainer-only internal route.
 *
 * Usage:
 *   npm run maintainer:import:rbx:file -- "/mnt/c/Users/name/Downloads/card.rbx" <user-id> [visibility]
 *
 * Requires a local dev server (`npm run dev` or `npm run dev:local`) because the
 * route only accepts loopback requests, is opt-in via env, and is disabled in production.
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

function printUsage() {
  console.error(
    'Usage: npm run maintainer:import:rbx:file -- <filePath> <userId> [private|draft|public]',
  )
  console.error(
    'Example: npm run maintainer:import:rbx:file -- "/mnt/c/Users/name/Downloads/card.rbx" user-123',
  )
}

async function main() {
  if (!['1', 'true', 'yes'].includes((process.env.LOCAL_RBX_IMPORT_ENABLED ?? '').toLowerCase())) {
    console.error(
      'LOCAL_RBX_IMPORT_ENABLED=true is required to run the maintainer-only local RBX import tool.',
    )
    process.exit(1)
  }

  const secret = process.env.LOCAL_RBX_IMPORT_SECRET
  if (!secret) {
    console.error('LOCAL_RBX_IMPORT_SECRET is required to run maintainer local RBX imports.')
    process.exit(1)
  }

  const filePath = process.argv[2]
  const userId = process.argv[3]
  const visibility = process.argv[4]

  if (!filePath || !userId) {
    printUsage()
    process.exit(1)
  }

  if (visibility && !['private', 'draft', 'public'].includes(visibility)) {
    console.error('Visibility must be one of: private, draft, public')
    process.exit(1)
  }

  const endpoint =
    process.env.LOCAL_RBX_IMPORT_URL ?? 'http://127.0.0.1:3000/api/internal/rbx-local-import'

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        filePath,
        userId,
        ...(visibility ? { visibility } : {}),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Local RBX import failed (${response.status}): ${errorText || 'Unknown error'}`,
      )
    }

    const result = await response.json()
    console.log('[local-rbx-import]', JSON.stringify(result, null, 2))
  } catch (error) {
    console.error('[local-rbx-import] Failed:', error)
    process.exit(1)
  }
}

void main()
