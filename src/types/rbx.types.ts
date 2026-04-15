/**
 * RBX Format Type Definitions
 *
 * Zod schemas and TypeScript types for the .rbx (Rebel eXchange) character format.
 * See docs/rbx-spec.md for the repository entrypoint and implementation references.
 */

import { z } from 'zod'

function hasPopulatedLegacyField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0
  }

  return value !== null && typeof value !== 'undefined' && value !== ''
}

// ============================================================================
// Asset Schemas
// ============================================================================

export const RbxAssetMetadataSchema = z
  .object({
    aliases: z.array(z.string()).default([]),
  })
  .passthrough()

export const RbxAssetSchema = z.object({
  file_name: z.string().min(1),
  asset_type: z.enum(['icon', 'character_image', 'background', 'other']),
  content_type: z.string().nullable().default(null),
  display_name: z.string().nullable().default(null),
  canonical_name: z.string().nullable().default(null),
  display_order: z.number().default(0),
  metadata: RbxAssetMetadataSchema.default({ aliases: [] }),
})

// ============================================================================
// Module Schemas
// ============================================================================

export const RbxLorebookEntrySchema = z
  .object({
    key: z.string(),
    content: z.string(),
    secondkey: z.string().default(''),
    insertorder: z.number().default(0),
    alwaysActive: z.boolean().default(false),
    selective: z.boolean().default(false),
    useRegex: z.boolean().default(false),
    comment: z.string().nullable().default(null),
  })
  .passthrough() // Allow extra lorebook fields (e.g., mode, scanDepth, probability)

export const RbxRegexSchema = z.object({
  in: z.string(),
  out: z.string(),
  /** editinput, editoutput, extract (v1.1). */
  type: z.enum(['editinput', 'editoutput', 'extract']),
  /** Capture group → variable name mapping. Only used with type: "extract". */
  bindings: z.record(z.string(), z.string()).optional(),
  /** Named card reference for inline rendering. Resolves against character.metadata.ui_cards. */
  card_ref: z.string().min(1).optional(),
})

export const RbxModuleAssetSchema = z.object({
  file_name: z.string().min(1),
  content_type: z.string().nullable().default(null),
  display_name: z.string().nullable().default(null),
  display_order: z.number().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const RbxModuleSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().default(null),
    lorebook: z.array(RbxLorebookEntrySchema).default([]),
    regex: z.array(RbxRegexSchema).default([]),
    hide_icon: z.boolean().default(false),
    assets: z.array(RbxModuleAssetSchema).default([]),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const moduleRecord = value as Record<string, unknown>

    if (hasPopulatedLegacyField(moduleRecord.triggers)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['triggers'],
        message: 'triggers are not supported. Use ui_card Button/Toggle components instead.',
      })
    }

    if (hasPopulatedLegacyField(moduleRecord.toggle_definitions)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toggle_definitions'],
        message: 'toggle_definitions are not supported. Use ui_card Toggle state instead.',
      })
    }
  })

export const RbxModuleAttachmentSchema = z.object({
  enabled: z.boolean().default(true),
  priority: z.number().default(0),
  module: RbxModuleSchema,
})

// ============================================================================
// Character Schemas
// ============================================================================

export const RbxCharacterMetadataSchema = z
  .object({
    type: z.enum(['character', 'simulation']).default('character'),
    post_history_instructions: z.string().nullable().default(null),
    alternate_greetings: z.array(z.string()).default([]),
    /** Safe UGC UI card JSON. Defines status panels, interactive UI, styling declaratively. */
    ui_card: z.unknown().nullable().default(null),
    /** Named inline card registry for extract.card_ref lookups. */
    ui_cards: z.record(z.string(), z.unknown()).default({}),
    /** Legacy fallback field. New imports reject populated values. */
    background_html: z.string().nullable().default(null),
    default_variables: z.record(z.string(), z.unknown()).default({}),
    character_list: z.array(z.string()).default([]),
    image_commands: z.record(z.string(), z.string()).default({}),
    /** UCC card template for emotion image rendering. Uses @assets/emotion as dynamic placeholder. */
    image_display: z.unknown().nullable().default(null),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const metadataRecord = value as Record<string, unknown>

    if (typeof value.background_html === 'string' && value.background_html.trim().length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['background_html'],
        message: 'background_html is not supported. Use ui_card instead.',
      })
    }

    if (hasPopulatedLegacyField(metadataRecord.emotion_images)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['emotion_images'],
        message:
          'emotion_images is not supported. Use image_commands plus canonical asset names instead.',
      })
    }
  })

export const RbxCharacterSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  system_prompt: z.string().min(1),
  greeting_message: z.string().nullable().default(null),
  visibility: z.enum(['private', 'draft', 'public']).default('private'),
  metadata: RbxCharacterMetadataSchema.default({
    type: 'character' as const,
    post_history_instructions: null,
    alternate_greetings: [],
    ui_card: null,
    ui_cards: {},
    background_html: null,
    default_variables: {},
    character_list: [],
    image_commands: {},
    image_display: null,
  }),
})

// ============================================================================
// Top-Level Manifest Schema
// ============================================================================

export const RbxManifestSchema = z.object({
  format: z.literal('rbx'),
  version: z.string(),
  character: RbxCharacterSchema,
  assets: z.array(RbxAssetSchema).default([]),
  modules: z.array(RbxModuleAttachmentSchema).default([]),
})

// ============================================================================
// Inferred Types
// ============================================================================

export type RbxManifest = z.infer<typeof RbxManifestSchema>
export type RbxCharacter = z.infer<typeof RbxCharacterSchema>
export type RbxCharacterMetadata = z.infer<typeof RbxCharacterMetadataSchema>
export type RbxAsset = z.infer<typeof RbxAssetSchema>
export type RbxAssetMetadata = z.infer<typeof RbxAssetMetadataSchema>
export type RbxModule = z.infer<typeof RbxModuleSchema>
export type RbxModuleAttachment = z.infer<typeof RbxModuleAttachmentSchema>
export type RbxModuleAsset = z.infer<typeof RbxModuleAssetSchema>
export type RbxLorebookEntry = z.infer<typeof RbxLorebookEntrySchema>
export type RbxRegex = z.infer<typeof RbxRegexSchema>

// ============================================================================
// Parser Result Types
// ============================================================================

export interface RbxAssetFile {
  fileName: string
  data: Uint8Array
}

export interface RbxParseResult {
  manifest: RbxManifest
  characterAssets: RbxAssetFile[]
  /** Module index (0-based) → array of asset files */
  moduleAssets: Map<number, RbxAssetFile[]>
  /** Asset files referenced in manifest but missing from ZIP */
  missingAssets: string[]
}

export interface RbxImportResult {
  success: boolean
  characterId?: string
  error?: string
  stats?: {
    assetsUploaded: number
    failedAssets: number
    failedAssetSamples: Array<{ fileName: string; reason: string }>
    modulesCreated: number
    lorebookEntries: number
    moduleAssetsUploaded: number
    validationWarnings?: string[]
  }
}
