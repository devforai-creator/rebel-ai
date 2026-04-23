import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createApiErrorResponse,
  createUnexpectedRouteErrorResponse,
  parseJsonRequest,
  requireBearerToken,
} from '@/lib/http/api-contract'
import { importRbx } from '@/lib/rbx-importer'
import { parseRbxArchive } from '@/lib/rbx-parser'
import { assertRbxRuntimeContract } from '@/lib/rbx-runtime-contract'
import { SUPPORT_TIER_FEATURES, withSupportTierHeaders } from '@/lib/support-tier'

export const runtime = 'nodejs'
export const maxDuration = 300

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const DEFAULT_LOCAL_RBX_IMPORT_MAX_FILE_MB = 1024
const TRUSTED_LOCAL_MAX_ASSET_COUNT = 10_000
const TRUSTED_LOCAL_MAX_DECOMPRESSED_MB = 2_048
const TRUSTED_LOCAL_MAX_MANIFEST_BYTES = 32 * 1024 * 1024

const localRbxImportSchema = z.object({
  filePath: z.string().min(1),
  userId: z.string().min(1),
  visibility: z.enum(['private', 'draft', 'public']).optional(),
})

export async function POST(req: NextRequest) {
  const config = readLocalRbxImportConfig()

  if (!config.enabled) {
    return createLocalRbxImportErrorResponse(
      'Local RBX import is disabled. Set LOCAL_RBX_IMPORT_ENABLED=true to enable this maintainer tool.',
      403,
    )
  }

  if (!config.secret) {
    console.error('[Local RBX Import] LOCAL_RBX_IMPORT_SECRET is not configured')
    return createLocalRbxImportErrorResponse('Server misconfigured', 500)
  }

  const auth = requireBearerToken(req, config.secret, {
    missingSecretMessage: 'Server misconfigured',
    headers: withLocalRbxImportHeaders(),
  })
  if (!auth.success) {
    return auth.response
  }

  if (process.env.NODE_ENV === 'production') {
    return createLocalRbxImportErrorResponse('Local RBX import is disabled in production', 403)
  }

  if (!LOOPBACK_HOSTS.has(req.nextUrl.hostname)) {
    return createLocalRbxImportErrorResponse('Local RBX import only accepts loopback requests', 403)
  }

  const parsed = await parseJsonRequest(req, localRbxImportSchema, {
    invalidBodyMessage: 'Missing filePath or userId',
    headers: withLocalRbxImportHeaders(),
  })
  if (!parsed.success) {
    return parsed.response
  }

  const normalizedPath = normalizeLocalImportFilePath(parsed.data.filePath)
  if (!path.isAbsolute(normalizedPath)) {
    return createLocalRbxImportErrorResponse('filePath must be an absolute local path', 400)
  }

  if (path.extname(normalizedPath).toLowerCase() !== '.rbx') {
    return createLocalRbxImportErrorResponse('filePath must point to a .rbx file', 400)
  }

  try {
    const fileStat = await stat(normalizedPath)
    if (!fileStat.isFile()) {
      return createLocalRbxImportErrorResponse('Local RBX path must point to a file', 400)
    }

    if (fileStat.size > config.maxFileBytes) {
      return createLocalRbxImportErrorResponse(
        `Local RBX file exceeds ${formatMb(config.maxFileBytes / 1024 / 1024)}MB maintainer limit`,
        413,
      )
    }

    const buffer = await readFile(normalizedPath)
    const parseResult = await parseRbxArchive(buffer, {
      maxAssetCount: TRUSTED_LOCAL_MAX_ASSET_COUNT,
      maxDecompressedMb: TRUSTED_LOCAL_MAX_DECOMPRESSED_MB,
      maxManifestBytes: TRUSTED_LOCAL_MAX_MANIFEST_BYTES,
    })
    assertRbxRuntimeContract(parseResult.manifest)

    const importResult = await importRbx({
      userId: parsed.data.userId,
      visibility: parsed.data.visibility,
      parseResult,
      supabaseClient: createAdminClient(),
    })

    if (!importResult.success) {
      return createLocalRbxImportErrorResponse(importResult.error || 'RBX import failed', 500)
    }

    return createLocalRbxImportJsonResponse({
      success: true,
      characterId: importResult.characterId,
      filePath: normalizedPath,
      stats: importResult.stats,
    })
  } catch (error) {
    if (isMissingFileError(error)) {
      return createLocalRbxImportErrorResponse('Local RBX file not found', 404)
    }

    return createUnexpectedRouteErrorResponse('[Local RBX Import] Failed:', error, {
      message: 'Local RBX import failed',
      headers: withLocalRbxImportHeaders(),
    })
  }
}

function withLocalRbxImportHeaders(headers?: HeadersInit): Headers {
  return withSupportTierHeaders(SUPPORT_TIER_FEATURES.LOCAL_RBX_MAINTAINER_IMPORT.tier, headers)
}

function createLocalRbxImportErrorResponse(
  message: string,
  status: number,
  options?: {
    code?: string
    retryAfter?: number | null
  },
): Response {
  return createApiErrorResponse(message, status, {
    ...options,
    headers: withLocalRbxImportHeaders(),
  })
}

function createLocalRbxImportJsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: withLocalRbxImportHeaders(init?.headers),
  })
}

function normalizeLocalImportFilePath(filePath: string): string {
  const trimmed = filePath.trim()
  const windowsDriveMatch = /^([A-Za-z]):[\\/](.*)$/.exec(trimmed)
  if (!windowsDriveMatch) {
    return trimmed
  }

  const driveLetter = windowsDriveMatch[1].toLowerCase()
  const rest = windowsDriveMatch[2].replace(/\\/g, '/')
  return `/mnt/${driveLetter}/${rest}`
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT',
  )
}

function readLocalRbxImportConfig() {
  const enabled = readBooleanEnv('LOCAL_RBX_IMPORT_ENABLED')
  const secret = process.env.LOCAL_RBX_IMPORT_SECRET?.trim() || null
  const maxFileMb = readPositiveNumberEnv(
    'LOCAL_RBX_IMPORT_MAX_FILE_MB',
    DEFAULT_LOCAL_RBX_IMPORT_MAX_FILE_MB,
  )

  return {
    enabled,
    secret,
    maxFileBytes: maxFileMb * 1024 * 1024,
  }
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (!rawValue) {
    return fallback
  }

  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

function formatMb(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '')
}
