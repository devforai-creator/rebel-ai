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
import type {
  CharacterInsert,
  CharacterModuleInsert,
  CharacterUpdate,
  Json,
  ModuleInsert,
} from '@/types/database.types'
import { formatSuuImportValidationIssue, validateSuuImportMetadata } from './suu-import-validation'
import {
  uploadCharacterAssets,
  uploadModuleAssets,
  type ImportRbxSupabaseClient,
  type ImportRbxSupabaseLike,
} from './rbx-import-assets'
import { sanitizeJsonArrayForDb, sanitizeMetadataForDb } from './rbx-import-helpers'
import { rollbackImportFailure, type CreatedModule } from './rbx-import-rollback'

// ============================================================================
// Types
// ============================================================================

interface ImportRbxOptions {
  userId: string
  parseResult: RbxParseResult
  visibility?: 'private' | 'draft' | 'public'
  supabaseClient: ImportRbxSupabaseLike
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Import an .rbx archive into the database.
 *
 * Flow:
 * 1. Create character record (1:1 from manifest, no transformation)
 * 2. Upload character assets → build file_name → asset_id map
 * 3. Resolve image_commands (file_name → asset_id)
 * 4. Update character metadata with resolved references
 * 5. Create modules with lorebook and regex
 * 6. Upload module assets
 *
 * On error: DELETE character (CASCADE deletes assets/modules).
 */
export async function importRbx(options: ImportRbxOptions): Promise<RbxImportResult> {
  const { userId, parseResult } = options
  const supabase = options.supabaseClient as ImportRbxSupabaseClient
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
  const createdModules: CreatedModule[] = [] // Track for rollback
  let uploadedCharacterAssetPaths: string[] = []

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
    characterId = charRecord.id

    // ── Step 2: Upload character assets ──
    const { uploaded, failedAssets, failedAssetSamples } = await uploadCharacterAssets(
      supabase,
      userId,
      characterId!,
      manifest.assets,
      characterAssets,
    )
    uploadedCharacterAssetPaths = uploaded.map((asset) => asset.storagePath)

    // ── Step 3: Build file_name → asset_id map ──
    const fileNameToAssetId = new Map<string, string>()
    for (const asset of uploaded) {
      fileNameToAssetId.set(asset.fileName, asset.assetId)
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
        lorebook: sanitizeJsonArrayForDb(mod.lorebook),
        regex: sanitizeJsonArrayForDb(mod.regex),
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

      const moduleId = moduleRecord.id
      const createdModule: CreatedModule = {
        id: moduleId,
        uploadedAssetPaths: [],
      }
      createdModules.push(createdModule)

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
        const { uploadCount, uploadedStoragePaths } = await uploadModuleAssets(
          supabase,
          userId,
          moduleId,
          mod.assets,
          moduleAssetFiles,
        )
        createdModule.uploadedAssetPaths = uploadedStoragePaths
        totalModuleAssetsUploaded += uploadCount
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
    await rollbackImportFailure({
      supabase,
      characterId,
      createdModules,
      uploadedCharacterAssetPaths,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

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
