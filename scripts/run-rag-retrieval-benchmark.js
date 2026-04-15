#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const BENCHMARK_SQL_PATH = join(process.cwd(), 'scripts', 'rag-retrieval-benchmark.sql')

function runCommand(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    })
  } catch (error) {
    const stderr =
      typeof error?.stderr === 'string'
        ? error.stderr
        : Buffer.isBuffer(error?.stderr)
          ? error.stderr.toString('utf8')
          : ''
    const stdout =
      typeof error?.stdout === 'string'
        ? error.stdout
        : Buffer.isBuffer(error?.stdout)
          ? error.stdout.toString('utf8')
          : ''
    const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
    throw new Error(details || error.message || `${command} failed`)
  }
}

function resolveDbContainer() {
  const output = runCommand('docker', ['ps', '--format', '{{.Names}} {{.Image}}'])
  const rows = output
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const container = rows.find((row) => row.startsWith('supabase_db_'))
  if (!container) {
    throw new Error('Could not find a running local Supabase Postgres container.')
  }

  return container.split(' ')[0]
}

function main() {
  if (!existsSync(BENCHMARK_SQL_PATH)) {
    throw new Error(`Missing benchmark SQL file: ${BENCHMARK_SQL_PATH}`)
  }

  const dbContainer = resolveDbContainer()
  const sql = readFileSync(BENCHMARK_SQL_PATH, 'utf8')

  const output = runCommand(
    'docker',
    [
      'exec',
      '-i',
      dbContainer,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-f',
      '-',
    ],
    {
      input: sql,
    },
  )

  process.stdout.write(output)
}

try {
  main()
} catch (error) {
  console.error('[rag-retrieval-benchmark] failed')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
