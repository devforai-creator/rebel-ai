import type { createAdminClient } from '@/lib/supabase/admin'
import {
  IMPORT_UPLOAD_BUCKET,
  MAX_IMPORT_UPLOAD_BYTES,
  MAX_IMPORT_UPLOAD_MB,
} from '@/lib/import/constants'
import { parseRbxArchive } from '@/lib/rbx-parser'
import { assertRbxRuntimeContract } from '@/lib/rbx-runtime-contract'
import { importRbx } from '@/lib/rbx-importer'
import type { Database, Json } from '@/types/database.types'

type CharacterImportSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from' | 'storage'>
type ImportJobUpdate = Database['public']['Tables']['charx_import_jobs']['Update']

export type CharacterImportJobPayload = {
  jobId: string
  userId: string
  storagePath: string
  fileName: string
  fileType?: string | null
}

export function validateStoragePath(storagePath: string, userId: string): boolean {
  return storagePath.startsWith(`${userId}/`)
}

export async function processCharacterImportJob(
  payload: CharacterImportJobPayload,
  supabase: CharacterImportSupabaseClient,
): Promise<void> {
  if (!validateStoragePath(payload.storagePath, payload.userId)) {
    console.error('[Character Import][runner] Security validation failed', {
      jobId: payload.jobId,
      userId: payload.userId,
      storagePath: payload.storagePath,
    })
    const securityFailureUpdate: ImportJobUpdate = {
      status: 'error',
      completed_at: new Date().toISOString(),
      error_message: 'Security validation failed: unauthorized storage path',
      result: null,
    }
    await supabase
      .from('charx_import_jobs')
      .update(securityFailureUpdate as never)
      .eq('id', payload.jobId)
    return
  }

  const processingUpdate: ImportJobUpdate = {
    status: 'processing',
    started_at: new Date().toISOString(),
    completed_at: null,
    error_message: null,
    result: null,
  }
  await supabase
    .from('charx_import_jobs')
    .update(processingUpdate as never)
    .eq('id', payload.jobId)

  try {
    const download = await supabase.storage.from(IMPORT_UPLOAD_BUCKET).download(payload.storagePath)
    if (download.error || !download.data) {
      throw new Error(download.error?.message || 'Failed to read uploaded file')
    }

    const buffer = await download.data.arrayBuffer()

    // Server-side size enforcement — catches bypasses that skip the enqueue gate
    if (buffer.byteLength > MAX_IMPORT_UPLOAD_BYTES) {
      throw new Error(
        `File size (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB) exceeds the ${MAX_IMPORT_UPLOAD_MB}MB limit`,
      )
    }

    const parseResult = await parseRbxArchive(buffer)
    assertRbxRuntimeContract(parseResult.manifest)
    const importResult = await importRbx({
      userId: payload.userId,
      parseResult,
      supabaseClient: supabase,
    })

    if (!importResult.success) {
      throw new Error(importResult.error || 'RBX import failed')
    }

    const successResult: Json = {
      success: true,
      characterId: importResult.characterId,
      format: 'rbx',
      stats: importResult.stats,
    }
    const successUpdate: ImportJobUpdate = {
      status: 'success',
      completed_at: new Date().toISOString(),
      error_message: null,
      result: successResult,
    }
    await supabase
      .from('charx_import_jobs')
      .update(successUpdate as never)
      .eq('id', payload.jobId)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Character Import][runner] Job failed', {
      jobId: payload.jobId,
      error: errorMessage,
    })

    const errorUpdate: ImportJobUpdate = {
      status: 'error',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      result: null,
    }
    await supabase
      .from('charx_import_jobs')
      .update(errorUpdate as never)
      .eq('id', payload.jobId)
  } finally {
    const removal = await supabase.storage.from(IMPORT_UPLOAD_BUCKET).remove([payload.storagePath])
    if (removal.error) {
      console.error('[Character Import][runner] Failed to delete staged upload:', removal.error)
    }
  }
}
