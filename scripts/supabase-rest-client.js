#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const MAX_BUFFER_BYTES = 32 * 1024 * 1024

function runSupabase(args, cwd = process.cwd()) {
  try {
    return execFileSync('supabase', ['--dns-resolver', 'https', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: MAX_BUFFER_BYTES,
    }).trim()
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
    throw new Error(details || error.message || 'Supabase CLI command failed')
  }
}

function readLinkedProjectRef(cwd = process.cwd()) {
  const refPath = join(cwd, 'supabase', '.temp', 'project-ref')
  if (!existsSync(refPath)) {
    throw new Error(
      'Missing linked project ref. Set SUPABASE_PROJECT_REF or run `supabase link` first.',
    )
  }

  const projectRef = readFileSync(refPath, 'utf8').trim()
  if (!projectRef) {
    throw new Error('Linked project ref file is empty.')
  }

  return projectRef
}

function loadServiceRoleKey(projectRef, cwd = process.cwd()) {
  const output = runSupabase(
    ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    cwd,
  )

  let parsed
  try {
    parsed = JSON.parse(output)
  } catch (error) {
    throw new Error(`Failed to parse Supabase API key response: ${error.message}`)
  }

  const serviceRole = parsed.find(
    (row) =>
      row?.name === 'service_role' && typeof row.api_key === 'string' && row.api_key.length > 0,
  )

  if (!serviceRole) {
    throw new Error(`Could not resolve service_role API key for project ${projectRef}.`)
  }

  return serviceRole.api_key
}

function loadSupabaseRestConfig({ cwd = process.cwd() } = {}) {
  const projectRef = process.env.SUPABASE_PROJECT_REF || readLinkedProjectRef(cwd)
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    `https://${projectRef}.supabase.co`
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || loadServiceRoleKey(projectRef, cwd)

  return {
    projectRef,
    supabaseUrl,
    serviceRoleKey,
  }
}

async function fetchRestJson(config, { path, searchParams = [], schema = 'public' }) {
  const url = new URL(path, `${config.supabaseUrl}/`)
  for (const [key, value] of searchParams) {
    url.searchParams.append(key, value)
  }

  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    Accept: 'application/json',
  }

  if (schema !== 'public') {
    headers['Accept-Profile'] = schema
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`REST GET ${url.pathname} failed (${response.status}): ${body}`)
  }

  return response.json()
}

async function postRestJson(config, { path, body }) {
  const url = new URL(path, `${config.supabaseUrl}/`)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`REST POST ${url.pathname} failed (${response.status}): ${text}`)
  }

  return response.json()
}

async function selectPage(
  config,
  { table, schema = 'public', select, orderBy, limit, cursor, filters },
) {
  const searchParams = [
    ['select', select],
    ['order', `${orderBy}.asc`],
    ['limit', String(limit)],
  ]

  for (const filter of filters) {
    searchParams.push([filter.column, `${filter.operator}.${filter.value}`])
  }

  if (cursor !== null) {
    searchParams.push([orderBy, `gt.${cursor}`])
  }

  return fetchRestJson(config, {
    path: `rest/v1/${table}`,
    searchParams,
    schema,
  })
}

async function listStoragePrefix(config, { bucket, prefix, limit, offset }) {
  return postRestJson(config, {
    path: `storage/v1/object/list/${bucket}`,
    body: {
      prefix,
      limit,
      offset,
      sortBy: {
        column: 'name',
        order: 'asc',
      },
    },
  })
}

async function walkStorageObjects(config, { bucket, prefix = '', pageSize, onFile, onProgress }) {
  const prefixes = [prefix]
  let pagesScanned = 0
  let filesScanned = 0

  while (prefixes.length > 0) {
    const currentPrefix = prefixes.pop()
    let offset = 0

    while (true) {
      const rows = await listStoragePrefix(config, {
        bucket,
        prefix: currentPrefix,
        limit: pageSize,
        offset,
      })

      if (rows.length === 0) {
        break
      }

      for (const row of rows) {
        const fullPath = currentPrefix ? `${currentPrefix}/${row.name}` : row.name

        if (row.id === null) {
          prefixes.push(fullPath)
          continue
        }

        filesScanned += 1
        await onFile({
          storagePath: fullPath,
          createdAt: row.created_at,
          metadata: row.metadata,
        })
      }

      pagesScanned += 1
      if (pagesScanned % 10 === 0 && typeof onProgress === 'function') {
        onProgress({
          pagesScanned,
          filesScanned,
          pendingPrefixes: prefixes.length,
          currentPrefix,
        })
      }

      if (rows.length < pageSize) {
        break
      }

      offset += rows.length
    }
  }
}

module.exports = {
  loadSupabaseRestConfig,
  runSupabase,
  selectPage,
  walkStorageObjects,
}
