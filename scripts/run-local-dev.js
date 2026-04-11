#!/usr/bin/env node

const { spawn } = require('node:child_process')

const LOCALHOST_ORIGIN = 'http://127.0.0.1:3000'

function createLocalDevEnv(env = process.env) {
  return {
    ...env,
    INTERNAL_API_ORIGIN: LOCALHOST_ORIGIN,
  }
}

function createNextDevCommand(argv = process.argv.slice(2)) {
  return {
    command: process.execPath,
    args: [require.resolve('next/dist/bin/next'), 'dev', ...argv],
  }
}

function runLocalDev({ argv = process.argv.slice(2), env = process.env, spawnImpl = spawn } = {}) {
  const { command, args } = createNextDevCommand(argv)
  const child = spawnImpl(command, args, {
    stdio: 'inherit',
    env: createLocalDevEnv(env),
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })

  child.on('error', (error) => {
    console.error('[run-local-dev] Failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })

  return child
}

if (require.main === module) {
  runLocalDev()
}

module.exports = {
  LOCALHOST_ORIGIN,
  createLocalDevEnv,
  createNextDevCommand,
  runLocalDev,
}
