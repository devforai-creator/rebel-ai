#!/usr/bin/env node

const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Vercel builds may set NODE_ENV=production; React interaction tests need test mode.
const result = spawnSync(
  process.execPath,
  [
    path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    'run',
    'tests/chat/memory-contract.integration.test.tsx',
  ],
  {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  },
)

if (result.error) console.error('[memory-contract]', result.error.message)
process.exit(result.status ?? 1)
