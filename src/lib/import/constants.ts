/**
 * Legacy bucket/table names are kept for compatibility with existing Supabase
 * schema, but the public product surface only supports RBX imports.
 */
export const IMPORT_UPLOAD_BUCKET = 'charx-uploads'

// ---------------------------------------------------------------------------
// Import safety limits
//
// Defaults are conservative for shared/hosted environments. Self-hosters can
// raise them via environment variables. See docs/local-import-guide.md.
// ---------------------------------------------------------------------------

/** Maximum uploaded ZIP size (MB). Override: NEXT_PUBLIC_IMPORT_MAX_UPLOAD_MB */
const DEFAULT_IMPORT_UPLOAD_MB = 100
export const MAX_IMPORT_UPLOAD_MB = clampEnvInt(
  process.env.NEXT_PUBLIC_IMPORT_MAX_UPLOAD_MB,
  DEFAULT_IMPORT_UPLOAD_MB,
  { min: 10, max: 500 },
)
export const MAX_IMPORT_UPLOAD_BYTES = MAX_IMPORT_UPLOAD_MB * 1024 * 1024

/** Maximum total decompressed bytes from the ZIP. Override: NEXT_PUBLIC_IMPORT_MAX_DECOMPRESSED_MB */
const DEFAULT_MAX_DECOMPRESSED_MB = 300
export const MAX_DECOMPRESSED_MB = clampEnvInt(
  process.env.NEXT_PUBLIC_IMPORT_MAX_DECOMPRESSED_MB,
  DEFAULT_MAX_DECOMPRESSED_MB,
  { min: 50, max: 1500 },
)
export const MAX_DECOMPRESSED_BYTES = MAX_DECOMPRESSED_MB * 1024 * 1024

/** Maximum number of asset files in an archive. Override: NEXT_PUBLIC_IMPORT_MAX_ASSET_COUNT */
const DEFAULT_MAX_ASSET_COUNT = 300
export const MAX_ASSET_COUNT = clampEnvInt(
  process.env.NEXT_PUBLIC_IMPORT_MAX_ASSET_COUNT,
  DEFAULT_MAX_ASSET_COUNT,
  { min: 50, max: 2000 },
)

/** Maximum manifest.json size in bytes (1 MB — not configurable) */
export const MAX_MANIFEST_BYTES = 1 * 1024 * 1024

/** Maximum single asset file size in bytes (20 MB — matches storage bucket policy) */
export const MAX_SINGLE_ASSET_BYTES = 20 * 1024 * 1024

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampEnvInt(
  raw: string | undefined,
  fallback: number,
  opts: { min: number; max: number },
): number {
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.max(opts.min, Math.min(opts.max, parsed))
}
