/**
 * RBX Importer
 *
 * Imports .rbx (Rebel eXchange) archives into RebelAI database.
 * This importer has no translation layers:
 * - No RPack decoding
 * - No description ↔ system_prompt swapping
 * - No defaultVariables string parsing
 * - No 4-tier fuzzy asset matching
 * - No regex script sanitization (scripts excluded from spec)
 *
 * See docs/rbx-spec.md for the full specification.
 */

import type { RbxParseResult, RbxImportResult } from '@/types/rbx.types'
import type { RbxAssetFile } from '@/types/rbx.types'
import type { createAdminClient } from '@/lib/supabase/admin'
import type {
  CharacterAssetInsert,
  CharacterInsert,
  CharacterModuleInsert,
  CharacterUpdate,
  Json,
  ModuleAssetInsert,
  ModuleInsert,
} from '@/types/database.types'
import { sanitizeStorageKey } from './storage-key'
import { formatSuuImportValidationIssue, validateSuuImportMetadata } from './suu-import-validation'

// ============================================================================
// Constants
// ============================================================================

const STORAGE_UPLOAD_RETRY_ATTEMPTS = 4
const STORAGE_UPLOAD_RETRY_BASE_DELAY_MS = 500
const ASSET_UPLOAD_CONCURRENCY = 8
const ASSET_UPLOAD_CHUNK_DELAY_MS = 50
const MAX_FAILED_ASSET_SAMPLES = 20
const MAX_FAILED_ASSET_REASON_LENGTH = 240

// ============================================================================
// Types
// ============================================================================

interface ImportRbxOptions {
  userId: string
  parseResult: RbxParseResult
  visibility?: 'private' | 'draft' | 'public'
  supabaseClient: ImportRbxSupabaseLike
}

interface UploadedAsset {
  fileName: string // original file_name from manifest
  assetId: string // character_assets.id (UUID)
  storagePath: string
  publicUrl: string
}

interface AssetFailureSample {
  fileName: string
  reason: string
}

type ImportRbxSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from' | 'storage'>
type ImportRbxSupabaseLike = {
  from: (table: string) => unknown
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: Uint8Array,
        options?: { contentType?: string; upsert?: boolean },
      ) => PromiseLike<unknown>
      getPublicUrl: (path: string) => { data: { publicUrl: string } }
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Import an .rbx archive into the database.
 *
 * Flow:
 * 1. Create character record (1:1 from manifest, no transformation)
 * 2. Upload character assets → build file_name → asset_id / URL maps
 * 3. Resolve image_commands (file_name → asset_id)
 * 4. Update character metadata with resolved references
 * 5. Create modules with lorebook and regex
 * 6. Upload module assets
 *
 * On error: DELETE character (CASCADE deletes assets/modules).
 */
export async function importRbx(options: ImportRbxOptions): Promise<RbxImportResult> {
  const { userId, parseResult } = options
  const supabase = options.supabaseClient as unknown as ImportRbxSupabaseClient
  const { manifest, characterAssets, moduleAssets, missingAssets } = parseResult
  const suuValidation = validateSuuImportMetadata(manifest.character.metadata)
  const validationWarnings = suuValidation.warnings.map(formatSuuImportValidationIssue)

  // Use manifest visibility unless caller overrides
  const visibility = options.visibility ?? manifest.character.visibility ?? 'private'

  if (suuValidation.errors.length > 0) {
    const formattedErrors = suuValidation.errors.map(formatSuuImportValidationIssue)
    return {
      success: false,
      error:
        'Unsafe SUU content detected in RBX import:\n' +
        formattedErrors
          .slice(0, 5)
          .map((issue) => `  - ${issue}`)
          .join('\n'),
    }
  }

  if (validationWarnings.length > 0) {
    console.warn(
      `[RBX Importer] ${validationWarnings.length} SUU validation warning(s); import will continue:`,
      validationWarnings.slice(0, 10),
    )
  }

  // Warn about missing assets (parser already collected them)
  if (missingAssets.length > 0) {
    console.warn(
      `[RBX Importer] ${missingAssets.length} asset(s) missing from ZIP — import will proceed but some references may be unresolved:`,
      missingAssets.slice(0, 10),
    )
  }

  let characterId: string | undefined
  const createdModuleIds: string[] = [] // Track for rollback

  try {
    // ── Step 1: Create character ──
    const char = manifest.character
    const characterInsert: CharacterInsert = {
      user_id: userId,
      name: char.name,
      description: char.description,
      system_prompt: char.system_prompt,
      greeting_message: char.greeting_message,
      visibility,
      metadata: sanitizeMetadataForDb(
        buildCharacterMetadataForImport(char.metadata, {
          importedFrom: 'rbx_v1',
        }),
      ),
    }
    const { data: charRecord, error: charError } = await supabase
      .from('characters')
      .insert(characterInsert as never)
      .select('id')
      .single<{ id: string }>()

    if (charError || !charRecord) {
      throw new Error(`Failed to create character: ${charError?.message || 'Unknown error'}`)
    }
    characterId = charRecord.id as string

    // ── Step 2: Upload character assets ──
    const { uploaded, avatarUrl, failedAssets, failedAssetSamples } = await uploadCharacterAssets(
      supabase,
      userId,
      characterId!,
      manifest.assets,
      characterAssets,
    )

    // ── Step 3: Build file_name → asset_id / URL maps ──
    const fileNameToAssetId = new Map<string, string>()
    const fileNameToUrl = new Map<string, string>()
    for (const asset of uploaded) {
      fileNameToAssetId.set(asset.fileName, asset.assetId)
      fileNameToUrl.set(asset.fileName, asset.publicUrl)
    }

    // ── Step 4: Resolve image_commands ──
    const resolvedImageCommands: Record<string, string> = {}
    for (const [npcName, fileName] of Object.entries(char.metadata.image_commands)) {
      const assetId = fileNameToAssetId.get(fileName)
      if (assetId) {
        resolvedImageCommands[npcName] = assetId
      } else {
        console.warn(
          `[RBX Importer] image_commands: "${npcName}" references "${fileName}" but no matching uploaded asset`,
        )
      }
    }

    // ── Step 5: Update character metadata with resolved references ──
    const characterUpdate: CharacterUpdate = {
      avatar_url: avatarUrl,
      metadata: sanitizeMetadataForDb(
        buildCharacterMetadataForImport(char.metadata, {
          imageCommands: resolvedImageCommands,
          importedFrom: 'rbx_v1.1',
        }),
      ),
    }
    const { error: updateError } = await supabase
      .from('characters')
      .update(characterUpdate as never)
      .eq('id', characterId)

    if (updateError) {
      console.error('[RBX Importer] Failed to update character metadata:', updateError)
      throw new Error(`Failed to update character metadata: ${updateError.message}`)
    }

    // ── Step 6: Create modules ──
    let totalLorebookEntries = 0
    let totalModuleAssetsUploaded = 0

    for (let i = 0; i < manifest.modules.length; i++) {
      const attachment = manifest.modules[i]
      const mod = attachment.module

      // Build module assets metadata for the modules.assets column (legacy/diagnostic)
      // Format: [name, dataUrl | null, type] — matches the modules.assets reader contract
      const moduleAssetsMetadata: Json[] = mod.assets.map((a) => [
        a.display_name || a.file_name, // [0] name
        null, // [1] dataUrl (null — actual data is in module_assets table/bucket)
        (a.file_name.split('.').pop() || 'bin').toLowerCase(), // [2] type (extension)
      ])

      // Create module record
      const moduleInsert: ModuleInsert = {
        user_id: userId,
        name: mod.name,
        description: mod.description,
        lorebook: mod.lorebook as unknown as Json[],
        regex: mod.regex as unknown as Json[],
        hide_icon: mod.hide_icon,
        assets: moduleAssetsMetadata,
      }
      const { data: moduleRecord, error: moduleError } = await supabase
        .from('modules')
        .insert(moduleInsert as never)
        .select('id')
        .single<{ id: string }>()

      if (moduleError || !moduleRecord) {
        throw new Error(
          `Failed to create module "${mod.name}": ${moduleError?.message || 'Unknown error'}`,
        )
      }

      const moduleId = moduleRecord.id as string
      createdModuleIds.push(moduleId)

      // Link module to character
      const characterModuleInsert: CharacterModuleInsert = {
        character_id: characterId,
        module_id: moduleId,
        enabled: attachment.enabled,
        priority: attachment.priority,
      }
      const { error: linkError } = await supabase
        .from('character_modules')
        .insert(characterModuleInsert as never)

      if (linkError) {
        throw new Error(`Failed to link module "${mod.name}" to character: ${linkError.message}`)
      }

      totalLorebookEntries += mod.lorebook.length

      // Upload module assets
      const moduleAssetFiles = moduleAssets.get(i) || []
      if (mod.assets.length > 0 && moduleAssetFiles.length > 0) {
        const moduleUploaded = await uploadModuleAssets(
          supabase,
          userId,
          moduleId,
          mod.assets,
          moduleAssetFiles,
        )
        totalModuleAssetsUploaded += moduleUploaded
      }
    }

    return {
      success: true,
      characterId,
      stats: {
        assetsUploaded: uploaded.length,
        failedAssets,
        failedAssetSamples,
        modulesCreated: manifest.modules.length,
        lorebookEntries: totalLorebookEntries,
        moduleAssetsUploaded: totalModuleAssetsUploaded,
        ...(validationWarnings.length > 0 ? { validationWarnings } : {}),
      },
    }
  } catch (error) {
    // Rollback: delete character (CASCADE deletes character_assets and character_modules links)
    if (characterId) {
      console.error('[RBX Importer] Rolling back character creation:', characterId)
      await supabase.from('characters').delete().eq('id', characterId)
    }

    // Rollback: delete orphaned modules (character CASCADE only removes the link, not the module itself)
    for (const moduleId of createdModuleIds) {
      console.error('[RBX Importer] Rolling back orphaned module:', moduleId)
      // module_assets CASCADE-deletes when module is deleted
      await supabase.from('modules').delete().eq('id', moduleId)
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// Asset Upload
// ============================================================================

async function uploadCharacterAssets(
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

  // Build file lookup: fileName → Uint8Array
  const fileMap = new Map<string, Uint8Array>()
  for (const file of assetFiles) {
    fileMap.set(file.fileName, file.data)
  }

  // Process in chunks for concurrency control
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

        // Upload to storage with retry
        await uploadToStorageWithRetry(
          supabase,
          'character-assets',
          storagePath,
          fileData,
          contentType,
        )

        // Insert character_assets record
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
        const { data: assetRecord, error: dbError } = await supabase
          .from('character_assets')
          .insert(characterAssetInsert as never)
          .select('id')
          .single<{ id: string }>()

        if (dbError || !assetRecord) {
          throw new Error(
            `DB insert failed for ${asset.file_name}: ${dbError?.message || 'Unknown error'}`,
          )
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('character-assets')
          .getPublicUrl(storagePath)

        const result: UploadedAsset = {
          fileName: asset.file_name,
          assetId: assetRecord.id,
          storagePath,
          publicUrl: urlData.publicUrl,
        }

        // Track avatar
        if (asset.asset_type === 'icon') {
          avatarUrl = urlData.publicUrl
        }

        return result
      }),
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'fulfilled') {
        uploaded.push(result.value)
      } else {
        failedAssets++
        if (failedAssetSamples.length < MAX_FAILED_ASSET_SAMPLES) {
          const reason =
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          failedAssetSamples.push({
            fileName: chunk[j].file_name,
            reason: reason.slice(0, MAX_FAILED_ASSET_REASON_LENGTH),
          })
        }
      }
    }

    // Delay between chunks to avoid rate limiting
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await delay(ASSET_UPLOAD_CHUNK_DELAY_MS)
    }
  }

  return { uploaded, avatarUrl, failedAssets, failedAssetSamples }
}

async function uploadModuleAssets(
  supabase: ImportRbxSupabaseClient,
  userId: string,
  moduleId: string,
  manifestAssets: RbxParseResult['manifest']['modules'][0]['module']['assets'],
  assetFiles: RbxAssetFile[],
): Promise<number> {
  const fileMap = new Map<string, Uint8Array>()
  for (const file of assetFiles) {
    fileMap.set(file.fileName, file.data)
  }

  let uploadCount = 0

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
        console.error(`[RBX Importer] Failed to create module_assets record: ${dbError.message}`)
      } else {
        uploadCount++
      }
    } catch (error) {
      console.error(
        `[RBX Importer] Failed to upload module asset ${asset.file_name}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return uploadCount
}

// ============================================================================
// Storage Utilities
// ============================================================================

async function uploadToStorageWithRetry(
  supabase: ImportRbxSupabaseClient,
  bucket: string,
  path: string,
  file: Uint8Array,
  contentType: string,
): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= STORAGE_UPLOAD_RETRY_ATTEMPTS; attempt++) {
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

// ============================================================================
// Helpers
// ============================================================================

function getContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

function buildCharacterMetadataForImport(
  metadata: RbxParseResult['manifest']['character']['metadata'],
  options: {
    importedFrom: string
    imageCommands?: Record<string, string>
  },
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...(metadata as Record<string, unknown>),
    background_html: null,
    image_commands: options.imageCommands ?? metadata.image_commands,
    imported_from: options.importedFrom,
  }

  delete result.emotion_images

  return result
}

function sanitizeMetadataForDb(metadata: Record<string, unknown>): Json {
  const jsonString = JSON.stringify(metadata)
  const sanitized = jsonString.replace(/\\u0000/g, '')
  return JSON.parse(sanitized) as Json
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
    const msg = (error as { message?: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return ''
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
