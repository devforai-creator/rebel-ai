import type { createAdminClient } from '@/lib/supabase/admin'
import { StorageCleanupError, removeStorageObjects } from '@/lib/assets/storage-cleanup'
import type { CharacterAssetInsert, ModuleAssetInsert } from '@/types/database.types'
import type { RbxAssetFile, RbxParseResult } from '@/types/rbx.types'
import { sanitizeStorageKey } from './storage-key'
import { delay, getContentType, sanitizeMetadataForDb } from './rbx-import-helpers'

const STORAGE_UPLOAD_RETRY_ATTEMPTS = 4
const STORAGE_UPLOAD_RETRY_BASE_DELAY_MS = 500
const ASSET_UPLOAD_CONCURRENCY = 8
const ASSET_UPLOAD_CHUNK_DELAY_MS = 50
const MAX_FAILED_ASSET_SAMPLES = 20
const MAX_FAILED_ASSET_REASON_LENGTH = 240

export interface UploadedAsset {
  fileName: string
  assetId: string
  storagePath: string
  publicUrl: string
}

export interface AssetFailureSample {
  fileName: string
  reason: string
}

export type ImportRbxSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from' | 'storage'>
export type ImportRbxSupabaseLike = {
  from: (table: string) => unknown
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: Uint8Array,
        options?: { contentType?: string; upsert?: boolean },
      ) => PromiseLike<unknown>
      remove?: (paths: string[]) => PromiseLike<unknown>
      getPublicUrl: (path: string) => { data: { publicUrl: string } }
    }
  }
}

export async function uploadCharacterAssets(
  supabase: ImportRbxSupabaseClient,
  userId: string,
  characterId: string,
  manifestAssets: RbxParseResult['manifest']['assets'],
  assetFiles: RbxAssetFile[],
): Promise<{
  uploaded: UploadedAsset[]
  avatarUrl: string | null
  failedAssets: number
  failedAssetSamples: AssetFailureSample[]
}> {
  const uploaded: UploadedAsset[] = []
  let avatarUrl: string | null = null
  let failedAssets = 0
  const failedAssetSamples: AssetFailureSample[] = []
  let fatalCleanupError: StorageCleanupError | null = null

  const fileMap = new Map<string, Uint8Array>()
  for (const file of assetFiles) {
    fileMap.set(file.fileName, file.data)
  }

  const chunks: (typeof manifestAssets)[] = []
  for (let i = 0; i < manifestAssets.length; i += ASSET_UPLOAD_CONCURRENCY) {
    chunks.push(manifestAssets.slice(i, i + ASSET_UPLOAD_CONCURRENCY))
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (asset) => {
        const fileData = fileMap.get(asset.file_name)
        if (!fileData) {
          throw new Error(`File not found in ZIP: ${asset.file_name}`)
        }

        const sanitizedFileName = sanitizeStorageKey(asset.file_name)
        const ext = sanitizedFileName.split('.').pop() || 'bin'
        const uuid = crypto.randomUUID()
        const storagePath = `${userId}/${characterId}/${uuid}.${ext}`
        const contentType = asset.content_type || getContentType(asset.file_name)

        await uploadToStorageWithRetry(
          supabase,
          'character-assets',
          storagePath,
          fileData,
          contentType,
        )

        let assetRecord: { id: string } | null = null

        try {
          const characterAssetInsert: CharacterAssetInsert = {
            character_id: characterId,
            user_id: userId,
            asset_type: asset.asset_type,
            file_name: sanitizedFileName,
            storage_path: storagePath,
            content_type: contentType,
            file_size: fileData.length,
            display_name: asset.display_name,
            canonical_name: asset.canonical_name,
            display_order: asset.display_order,
            metadata: sanitizeMetadataForDb(asset.metadata as Record<string, unknown>),
          }
          const { data, error: dbError } = await supabase
            .from('character_assets')
            .insert(characterAssetInsert as never)
            .select('id')
            .single<{ id: string }>()

          if (dbError || !data) {
            throw new Error(
              `DB insert failed for ${asset.file_name}: ${dbError?.message || 'Unknown error'}`,
            )
          }

          assetRecord = data
        } catch (error) {
          await cleanupUploadedStoragePath(supabase, 'character-assets', storagePath, {
            entityId: characterId,
            entityType: 'import',
            operation: 'cleanupFailedCharacterAssetInsert',
          })
          throw error
        }

        const { data: urlData } = supabase.storage
          .from('character-assets')
          .getPublicUrl(storagePath)

        const result: UploadedAsset = {
          fileName: asset.file_name,
          assetId: assetRecord.id,
          storagePath,
          publicUrl: urlData.publicUrl,
        }

        if (asset.asset_type === 'icon') {
          avatarUrl = urlData.publicUrl
        }

        return result
      }),
    )

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]
      if (result.status === 'fulfilled') {
        uploaded.push(result.value)
      } else {
        if (!fatalCleanupError && result.reason instanceof StorageCleanupError) {
          fatalCleanupError = result.reason
        }
        failedAssets++
        if (failedAssetSamples.length < MAX_FAILED_ASSET_SAMPLES) {
          const reason =
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          failedAssetSamples.push({
            fileName: chunk[index].file_name,
            reason: reason.slice(0, MAX_FAILED_ASSET_REASON_LENGTH),
          })
        }
      }
    }

    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await delay(ASSET_UPLOAD_CHUNK_DELAY_MS)
    }
  }

  if (fatalCleanupError) {
    throw fatalCleanupError
  }

  return { uploaded, avatarUrl, failedAssets, failedAssetSamples }
}

export async function uploadModuleAssets(
  supabase: ImportRbxSupabaseClient,
  userId: string,
  moduleId: string,
  manifestAssets: RbxParseResult['manifest']['modules'][0]['module']['assets'],
  assetFiles: RbxAssetFile[],
): Promise<{
  uploadCount: number
  uploadedStoragePaths: string[]
}> {
  const fileMap = new Map<string, Uint8Array>()
  for (const file of assetFiles) {
    fileMap.set(file.fileName, file.data)
  }

  let uploadCount = 0
  const uploadedStoragePaths: string[] = []

  for (const asset of manifestAssets) {
    const fileData = fileMap.get(asset.file_name)
    if (!fileData) {
      console.warn(`[RBX Importer] Module asset file not found: ${asset.file_name}`)
      continue
    }

    const sanitizedFileName = sanitizeStorageKey(asset.file_name)
    const ext = sanitizedFileName.split('.').pop() || 'bin'
    const uuid = crypto.randomUUID()
    const storagePath = `${userId}/${moduleId}/${uuid}.${ext}`
    const contentType = asset.content_type || getContentType(asset.file_name)

    try {
      await uploadToStorageWithRetry(supabase, 'module-assets', storagePath, fileData, contentType)

      try {
        const moduleAssetInsert: ModuleAssetInsert = {
          user_id: userId,
          module_id: moduleId,
          file_name: sanitizedFileName,
          storage_path: storagePath,
          content_type: contentType,
          file_size: fileData.length,
          display_name: asset.display_name,
          display_order: asset.display_order,
          metadata: sanitizeMetadataForDb(asset.metadata as Record<string, unknown>),
        }
        const { error: dbError } = await supabase
          .from('module_assets')
          .insert(moduleAssetInsert as never)

        if (dbError) {
          await cleanupUploadedStoragePath(supabase, 'module-assets', storagePath, {
            entityId: moduleId,
            entityType: 'module',
            operation: 'cleanupFailedModuleAssetInsert',
          })
          console.error(`[RBX Importer] Failed to create module_assets record: ${dbError.message}`)
        } else {
          uploadCount++
          uploadedStoragePaths.push(storagePath)
        }
      } catch (error) {
        await cleanupUploadedStoragePath(supabase, 'module-assets', storagePath, {
          entityId: moduleId,
          entityType: 'module',
          operation: 'cleanupFailedModuleAssetInsert',
        })
        throw error
      }
    } catch (error) {
      if (error instanceof StorageCleanupError) {
        throw error
      }

      console.error(
        `[RBX Importer] Failed to upload module asset ${asset.file_name}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return {
    uploadCount,
    uploadedStoragePaths,
  }
}

async function uploadToStorageWithRetry(
  supabase: ImportRbxSupabaseClient,
  bucket: string,
  path: string,
  file: Uint8Array,
  contentType: string,
): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= STORAGE_UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType, upsert: false })

    if (!error) return

    lastError = error
    const statusCode = getErrorStatusCode(error)
    const isRetryable =
      (statusCode !== null && statusCode >= 500) ||
      /network|timeout|timed out/i.test(getErrorMessage(error))

    if (!isRetryable || attempt >= STORAGE_UPLOAD_RETRY_ATTEMPTS) {
      throw error
    }

    const backoffMs = STORAGE_UPLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
    console.warn(
      `[RBX Importer] Storage upload retry ${attempt}/${STORAGE_UPLOAD_RETRY_ATTEMPTS} in ${backoffMs}ms`,
      { bucket, path },
    )
    await delay(backoffMs)
  }

  if (lastError) throw lastError
}

async function cleanupUploadedStoragePath(
  supabase: ImportRbxSupabaseClient,
  bucket: string,
  storagePath: string,
  context: {
    entityId: string
    entityType: 'character' | 'import' | 'module'
    operation: string
  },
): Promise<void> {
  await removeStorageObjects(supabase, bucket, [storagePath], context)
}

function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  if (typeof status === 'number') return status
  const statusCode = (error as { statusCode?: unknown }).statusCode
  if (typeof statusCode === 'number') return statusCode
  return null
}

function getErrorMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}
