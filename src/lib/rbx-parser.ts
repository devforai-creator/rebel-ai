/**
 * RBX (.rbx) Archive Parser
 *
 * Parses .rbx (Rebel eXchange) ZIP archives into structured data.
 * .rbx uses direct Zod validation on manifest.json with no legacy decode
 * layer, URI resolution step, or version-branching import logic.
 *
 * See docs/rbx-spec.md for the repository entrypoint and implementation references.
 */

import JSZip from 'jszip'
import { RbxManifestSchema } from '@/types/rbx.types'
import type { RbxParseResult, RbxAssetFile } from '@/types/rbx.types'
import {
  MAX_ASSET_COUNT,
  MAX_MANIFEST_BYTES,
  MAX_SINGLE_ASSET_BYTES,
  MAX_DECOMPRESSED_MB,
} from '@/lib/import/constants'

// ============================================================================
// Constants
// ============================================================================

const MANIFEST_FILE = 'manifest.json'
const ASSETS_DIR = 'assets/'
const MODULE_ASSETS_DIR = 'module_assets/'

/** Image extensions accepted for asset files (must match storage bucket MIME policies) */
const SUPPORTED_ASSET_EXTENSIONS = new Set(['png', 'webp', 'jpg', 'jpeg', 'gif', 'avif'])

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse an .rbx ZIP archive into structured data.
 *
 * @param data - ZIP file as ArrayBuffer, Uint8Array, or File
 * @returns Parsed result with manifest, character assets, and module assets
 * @throws Error with descriptive message on parse failure
 */
export async function parseRbxArchive(
  data: ArrayBuffer | Uint8Array | File,
  options?: {
    maxAssetCount?: number
    maxDecompressedMb?: number
    maxManifestBytes?: number
  },
): Promise<RbxParseResult> {
  // Convert File to ArrayBuffer if needed
  const buffer = data instanceof File ? await data.arrayBuffer() : data
  const limits = resolveExtractionLimits(options)

  // 1. Open ZIP
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new Error('Invalid .rbx file: not a valid ZIP archive')
  }

  // 2. Read manifest.json (with size cap)
  const manifestFile = zip.file(MANIFEST_FILE)
  if (!manifestFile) {
    throw new Error(`Invalid .rbx file: ${MANIFEST_FILE} not found in archive`)
  }
  assertZipEntrySize(
    manifestFile,
    limits.maxManifestBytes,
    MANIFEST_FILE,
    limits.maxManifestBytes / 1024 / 1024,
  )

  let manifestJson: unknown
  try {
    const manifestBytes = await readZipEntryBytes(manifestFile, MANIFEST_FILE, {
      maxEntryBytes: limits.maxManifestBytes,
      createEntryLimitError: () => createManifestSizeError(limits.maxManifestBytes),
    })
    const manifestText = new TextDecoder().decode(manifestBytes)
    manifestJson = JSON.parse(manifestText)
  } catch (err) {
    if (err instanceof Error && err.message.includes('exceeds')) throw err
    throw new Error(`Invalid .rbx file: ${MANIFEST_FILE} contains invalid JSON`)
  }

  // 3. Validate with Zod schema
  const parseResult = RbxManifestSchema.safeParse(manifestJson)
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .slice(0, 5) // Limit to first 5 issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid .rbx manifest:\n${issues}`)
  }

  const manifest = parseResult.data

  // Shared budget tracker across all extract calls
  const budget: ExtractionBudget = { totalBytes: 0, totalFiles: 0 }

  // 4. Extract character assets from assets/ directory
  const characterAssets = await extractDirectoryAssets(zip, ASSETS_DIR, budget, limits)

  // 5. Extract module assets from module_assets/{i}/ directories
  const moduleAssets = new Map<number, RbxAssetFile[]>()
  for (let i = 0; i < manifest.modules.length; i++) {
    const moduleDir = `${MODULE_ASSETS_DIR}${i}/`
    const assets = await extractDirectoryAssets(zip, moduleDir, budget, limits)
    if (assets.length > 0) {
      moduleAssets.set(i, assets)
    }
  }

  // 6. Cross-validate manifest assets vs actual files — collect missing
  const missingAssets = collectMissingAssets(manifest, characterAssets, moduleAssets)
  if (missingAssets.length > 0) {
    console.warn(
      `[RBX Parser] ${missingAssets.length} asset(s) referenced in manifest but missing from ZIP:`,
      missingAssets.slice(0, 10),
    )
  }

  return {
    manifest,
    characterAssets,
    moduleAssets,
    missingAssets,
  }
}

/**
 * Quick check if a ZIP file is an .rbx archive by looking for manifest.json with format: "rbx".
 * Does not perform full validation — use parseRbxArchive() for that.
 *
 * @param data - ZIP file as ArrayBuffer or Uint8Array
 * @returns true if this looks like an .rbx file
 */
export async function isRbxArchive(data: ArrayBuffer | Uint8Array): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(data)
    const manifestFile = zip.file(MANIFEST_FILE)
    if (!manifestFile) return false

    const manifestBytes = await readZipEntryBytes(manifestFile, MANIFEST_FILE, {
      maxEntryBytes: MAX_MANIFEST_BYTES,
      createEntryLimitError: () => createManifestSizeError(MAX_MANIFEST_BYTES),
    })
    const text = new TextDecoder().decode(manifestBytes)
    const json = JSON.parse(text)
    return json?.format === 'rbx'
  } catch {
    return false
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

// ---------------------------------------------------------------------------
// Extraction budget — shared across all extractDirectoryAssets calls within
// a single parseRbxArchive invocation to enforce archive-wide limits.
// ---------------------------------------------------------------------------

type ExtractionBudget = {
  totalBytes: number
  totalFiles: number
}

type ExtractionLimits = {
  maxAssetCount: number
  maxDecompressedBytes: number
  maxDecompressedMb: number
  maxManifestBytes: number
}

type ZipEntrySizeMetadata = JSZip.JSZipObject & {
  _data?: {
    uncompressedSize?: number
  }
}

/**
 * Extract all asset files from a directory within the ZIP archive.
 * Enforces per-asset, total decompressed size, and file count limits.
 *
 * Assets are decompressed sequentially so that budget checks act as real
 * backpressure — exceeding a limit stops extraction before the remaining
 * files consume memory.
 */
async function extractDirectoryAssets(
  zip: JSZip,
  dirPath: string,
  budget: ExtractionBudget,
  limits: ExtractionLimits,
): Promise<RbxAssetFile[]> {
  // 1. Collect eligible entries (cheap — no decompression yet)
  const entries: Array<{ fileName: string; file: JSZip.JSZipObject }> = []

  zip.forEach((relativePath, file) => {
    if (file.dir) return
    if (!relativePath.startsWith(dirPath)) return

    const fileName = relativePath.slice(dirPath.length)
    if (!fileName || fileName.includes('/')) return

    const ext = fileName.split('.').pop()?.toLowerCase()
    if (!ext || !SUPPORTED_ASSET_EXTENSIONS.has(ext)) return

    entries.push({ fileName, file })
  })

  // Sort before extraction for deterministic ordering
  entries.sort((a, b) => a.fileName.localeCompare(b.fileName))

  // 2. Early file-count check before decompressing anything
  if (budget.totalFiles + entries.length > limits.maxAssetCount) {
    throw new Error(
      `Archive contains more than ${limits.maxAssetCount} assets. ` +
        'Self-hosters can raise NEXT_PUBLIC_IMPORT_MAX_ASSET_COUNT.',
    )
  }

  // 3. Best-effort preflight using ZIP header sizes. These values are attacker
  // controlled, so actual streamed byte counts are still enforced below.
  const declaredEntries = entries.map((entry) => ({
    ...entry,
    declaredSize: getDeclaredUncompressedSize(entry.file),
  }))
  let declaredBytes = 0

  for (const { fileName, declaredSize } of declaredEntries) {
    if (declaredSize === null) continue

    assertAssetSize(fileName, declaredSize)

    declaredBytes += declaredSize
    if (budget.totalBytes + declaredBytes > limits.maxDecompressedBytes) {
      throw createTotalDecompressedSizeError(limits.maxDecompressedMb)
    }
  }

  // 4. Decompress sequentially with actual byte-count enforcement
  const assets: RbxAssetFile[] = []

  for (const { fileName, file } of declaredEntries) {
    const data = await readZipEntryBytes(file, fileName, {
      maxEntryBytes: MAX_SINGLE_ASSET_BYTES,
      createEntryLimitError: (byteLength) => createAssetSizeError(fileName, byteLength),
      budget,
      totalMaxBytes: limits.maxDecompressedBytes,
      totalMaxMb: limits.maxDecompressedMb,
    })

    budget.totalFiles += 1
    assets.push({ fileName, data })
  }

  return assets
}

async function readZipEntryBytes(
  file: JSZip.JSZipObject,
  fileName: string,
  options: {
    maxEntryBytes: number
    createEntryLimitError: (byteLength: number) => Error
    budget?: ExtractionBudget
    totalMaxBytes?: number
    totalMaxMb?: number
  },
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let entryBytes = 0
    let settled = false
    const stream = file.nodeStream('nodebuffer')

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      stream.pause()
      reject(error)
    }

    stream
      .on('data', (chunk) => {
        if (settled) return

        let bytes: Uint8Array
        try {
          bytes = normalizeZipStreamChunk(chunk, fileName)
        } catch (err) {
          fail(err instanceof Error ? err : new Error(`Invalid .rbx file: ${fileName}`))
          return
        }

        const nextEntryBytes = entryBytes + bytes.byteLength
        if (nextEntryBytes > options.maxEntryBytes) {
          fail(options.createEntryLimitError(nextEntryBytes))
          return
        }

        if (
          options.budget &&
          options.totalMaxBytes !== undefined &&
          options.totalMaxMb !== undefined &&
          options.budget.totalBytes + bytes.byteLength > options.totalMaxBytes
        ) {
          fail(createTotalDecompressedSizeError(options.totalMaxMb))
          return
        }

        entryBytes = nextEntryBytes
        if (options.budget) {
          options.budget.totalBytes += bytes.byteLength
        }
        chunks.push(bytes)
      })
      .on('error', (error) => {
        fail(error)
      })
      .on('end', () => {
        if (settled) return

        settled = true
        const data = new Uint8Array(entryBytes)
        let offset = 0
        for (const chunk of chunks) {
          data.set(chunk, offset)
          offset += chunk.byteLength
        }
        resolve(data)
      })
      .resume()
  })
}

function normalizeZipStreamChunk(chunk: unknown, fileName: string): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  if (Array.isArray(chunk)) return Uint8Array.from(chunk)

  throw new Error(`Invalid .rbx file: ${fileName} could not be decompressed`)
}

function getDeclaredUncompressedSize(file: JSZip.JSZipObject): number | null {
  const size = (file as ZipEntrySizeMetadata)._data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null
}

function assertZipEntrySize(
  file: JSZip.JSZipObject,
  maxBytes: number,
  fileName: string,
  maxMb: number,
) {
  const declaredSize = getDeclaredUncompressedSize(file)
  if (declaredSize === null || declaredSize <= maxBytes) return

  throw new Error(`Invalid .rbx file: ${fileName} exceeds ${formatMbLimit(maxMb)}MB limit`)
}

function assertAssetSize(fileName: string, byteLength: number) {
  if (byteLength <= MAX_SINGLE_ASSET_BYTES) return

  throw createAssetSizeError(fileName, byteLength)
}

function createAssetSizeError(fileName: string, byteLength: number) {
  return new Error(
    `Asset "${fileName}" is ${(byteLength / 1024 / 1024).toFixed(1)}MB — ` +
      `exceeds ${(MAX_SINGLE_ASSET_BYTES / 1024 / 1024).toFixed(0)}MB per-asset limit`,
  )
}

function createManifestSizeError(maxManifestBytes: number) {
  return new Error(
    `Invalid .rbx file: ${MANIFEST_FILE} exceeds ${formatMbLimit(
      maxManifestBytes / 1024 / 1024,
    )}MB limit`,
  )
}

function createTotalDecompressedSizeError(maxDecompressedMb: number) {
  return new Error(
    `Total decompressed size exceeds ${formatMbLimit(maxDecompressedMb)}MB limit. ` +
      'This archive is too large for web import. ' +
      'Self-hosters can raise NEXT_PUBLIC_IMPORT_MAX_DECOMPRESSED_MB.',
  )
}

function resolveExtractionLimits(overrides?: {
  maxAssetCount?: number
  maxDecompressedMb?: number
  maxManifestBytes?: number
}): ExtractionLimits {
  const rawMaxAssetCount = overrides?.maxAssetCount
  const rawMaxDecompressedMb = overrides?.maxDecompressedMb
  const rawMaxManifestBytes = overrides?.maxManifestBytes
  const maxAssetCount =
    typeof rawMaxAssetCount === 'number' &&
    Number.isFinite(rawMaxAssetCount) &&
    rawMaxAssetCount > 0
      ? Math.floor(rawMaxAssetCount)
      : MAX_ASSET_COUNT
  const maxDecompressedMb =
    typeof rawMaxDecompressedMb === 'number' &&
    Number.isFinite(rawMaxDecompressedMb) &&
    rawMaxDecompressedMb > 0
      ? rawMaxDecompressedMb
      : MAX_DECOMPRESSED_MB
  const maxManifestBytes =
    typeof rawMaxManifestBytes === 'number' &&
    Number.isFinite(rawMaxManifestBytes) &&
    rawMaxManifestBytes > 0
      ? Math.floor(rawMaxManifestBytes)
      : MAX_MANIFEST_BYTES

  return {
    maxAssetCount,
    maxDecompressedMb,
    maxDecompressedBytes: maxDecompressedMb * 1024 * 1024,
    maxManifestBytes,
  }
}

function formatMbLimit(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '')
}

/**
 * Collect asset files referenced in the manifest but missing from the ZIP.
 * Returns a list of descriptive strings for each missing asset.
 */
function collectMissingAssets(
  manifest: RbxParseResult['manifest'],
  characterAssets: RbxAssetFile[],
  moduleAssets: Map<number, RbxAssetFile[]>,
): string[] {
  const missing: string[] = []
  const characterFileSet = new Set(characterAssets.map((a) => a.fileName))

  // Check character assets
  for (const asset of manifest.assets) {
    if (!characterFileSet.has(asset.file_name)) {
      missing.push(`assets/${asset.file_name}`)
    }
  }

  // Check module assets
  for (let i = 0; i < manifest.modules.length; i++) {
    const moduleAttachment = manifest.modules[i]
    const moduleFiles = moduleAssets.get(i)
    const moduleFileSet = new Set(moduleFiles?.map((a) => a.fileName) ?? [])

    for (const asset of moduleAttachment.module.assets) {
      if (!moduleFileSet.has(asset.file_name)) {
        missing.push(`module_assets/${i}/${asset.file_name}`)
      }
    }
  }

  return missing
}
