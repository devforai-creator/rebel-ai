import { buildAssetUrlMap } from '@/lib/asset-resolver'
import { createSignedAssetUrlMap } from '@/lib/assets/signed-asset-url'
import type { Database } from '@/types/database.types'
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

type RouteAssetSupabaseClient = SupabaseClient<Database>

export type CharacterAssetRecord = {
  id: string
  file_name: string
  storage_path: string
  display_name: string | null
  canonical_name: string | null
  display_order: number | null
  metadata: { aliases?: string[] } | null
}

export type ModuleAssetRecord = {
  id: string
  module_id: string
  file_name: string
  storage_path: string
  display_name: string | null
  display_order: number | null
  metadata: { aliases?: string[] } | null
}

export type ModuleRegexEntry = {
  type: string
  comment: string
  in: string
  out: string
  ableFlag: boolean
  bindings?: Record<string, string>
  card_ref?: string
}

export type ModuleAssetSummary = {
  moduleId: string
  moduleName: string | null
  assetCount: number
  expectedAssetCount: number
}

export type ModuleRuntimeData = {
  allRegex: ModuleRegexEntry[]
  moduleAssetUrls: Record<string, string>
  moduleAssetSummary: ModuleAssetSummary[]
}

const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 250

function normalizeAssetMetadata(metadata: unknown): { aliases?: string[] } | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  const rawAliases = (metadata as { aliases?: unknown }).aliases
  if (!Array.isArray(rawAliases)) {
    return null
  }

  const aliases = rawAliases.filter((alias): alias is string => typeof alias === 'string')
  return aliases.length > 0 ? { aliases } : null
}

export async function fetchCharacterAssetsWithRetry(
  supabase: RouteAssetSupabaseClient,
  characterId: string,
): Promise<CharacterAssetRecord[]> {
  let lastError: PostgrestError | null = null

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      const allAssets: CharacterAssetRecord[] = []
      const pageSize = 1000
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('character_assets')
          .select(
            'id, file_name, storage_path, display_name, canonical_name, metadata, display_order',
          )
          .eq('character_id', characterId)
          .order('display_order', { ascending: true })
          .range(offset, offset + pageSize - 1)

        if (error) {
          lastError = error
          throw error
        }

        if (data && data.length > 0) {
          allAssets.push(
            ...data.map((asset) => ({
              ...asset,
              metadata: normalizeAssetMetadata(asset.metadata),
            })),
          )
          offset += pageSize
          hasMore = data.length === pageSize
        } else {
          hasMore = false
        }
      }

      return allAssets
    } catch {
      if (attempt >= RETRY_ATTEMPTS || !shouldRetryPostgrestError(lastError)) {
        break
      }

      const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      await delay(backoff)
    }
  }

  console.error('[Assets API] Failed to load character_assets after retries', {
    characterId,
    error: lastError?.message,
  })
  return []
}

export async function fetchModuleData(
  supabase: RouteAssetSupabaseClient,
  characterId: string,
): Promise<ModuleRuntimeData> {
  const { data: characterModules } = await supabase
    .from('character_modules')
    .select(
      `
      module_id,
      modules (
        id,
        name,
        regex,
        assets
      )
    `,
    )
    .eq('character_id', characterId)
    .eq('enabled', true)
    .order('priority', { ascending: false })

  if (!characterModules || characterModules.length === 0) {
    return { allRegex: [], moduleAssetUrls: {}, moduleAssetSummary: [] }
  }

  const moduleIds = Array.from(
    new Set(
      characterModules
        .map((characterModule) => {
          const moduleRecord = characterModule.modules as { id?: string } | null
          return moduleRecord?.id ?? characterModule.module_id
        })
        .filter((moduleId): moduleId is string => Boolean(moduleId)),
    ),
  )

  const moduleAssets =
    moduleIds.length > 0 ? await fetchModuleAssetsWithRetry(supabase, moduleIds) : []

  const moduleAssetsByModuleId = new Map<string, string[]>()
  for (const asset of moduleAssets) {
    const existing = moduleAssetsByModuleId.get(asset.module_id) ?? []
    existing.push(asset.file_name)
    moduleAssetsByModuleId.set(asset.module_id, existing)
  }

  const allRegex: ModuleRegexEntry[] = []
  const moduleAssetSummary: ModuleAssetSummary[] = []
  const moduleAssetUrlMapByPath = await createSignedAssetUrlMap(
    supabase,
    'module-assets',
    moduleAssets.map((asset) => asset.storage_path),
    {
      logContext: '[Chat Assets] Failed to sign module assets',
    },
  )
  const moduleAssetUrls =
    moduleAssets.length > 0
      ? buildAssetUrlMap(moduleAssets, {
          getAssetUrl: (storagePath: string) => moduleAssetUrlMapByPath[storagePath],
        })
      : {}

  for (const characterModule of characterModules) {
    const moduleRecord = characterModule.modules as {
      id?: string
      name?: string
      regex?: unknown[]
      assets?: unknown[]
    } | null

    if (!moduleRecord) {
      continue
    }

    const moduleId = moduleRecord.id ?? characterModule.module_id
    const moduleAssetNames = moduleId ? (moduleAssetsByModuleId.get(moduleId) ?? []) : []

    const fallbackAssetNames: string[] = []
    if (Array.isArray(moduleRecord.assets)) {
      for (const asset of moduleRecord.assets) {
        if (Array.isArray(asset) && asset.length > 0) {
          fallbackAssetNames.push(String(asset[0]))
        } else if (typeof asset === 'string') {
          fallbackAssetNames.push(asset)
        }
      }
    }

    if (moduleId) {
      moduleAssetSummary.push({
        moduleId,
        moduleName: moduleRecord.name ?? null,
        assetCount: moduleAssetNames.length,
        expectedAssetCount: fallbackAssetNames.length,
      })
    }

    if (!Array.isArray(moduleRecord.regex)) {
      continue
    }

    for (const entry of moduleRecord.regex) {
      if (!entry || typeof entry !== 'object' || !('in' in entry) || !('out' in entry)) {
        continue
      }

      const regexEntry = entry as Record<string, unknown>
      allRegex.push({
        type: typeof regexEntry.type === 'string' ? regexEntry.type : '',
        comment: typeof regexEntry.comment === 'string' ? regexEntry.comment : '',
        in: String(regexEntry.in),
        out: String(regexEntry.out),
        ableFlag: typeof regexEntry.ableFlag === 'boolean' ? regexEntry.ableFlag : true,
        ...(regexEntry.type === 'extract' &&
        regexEntry.bindings &&
        typeof regexEntry.bindings === 'object'
          ? { bindings: regexEntry.bindings as Record<string, string> }
          : {}),
        ...(regexEntry.type === 'extract' &&
        typeof regexEntry.card_ref === 'string' &&
        regexEntry.card_ref.trim()
          ? { card_ref: regexEntry.card_ref.trim() }
          : {}),
      })
    }
  }

  return { allRegex, moduleAssetUrls, moduleAssetSummary }
}

async function fetchModuleAssetsWithRetry(
  supabase: RouteAssetSupabaseClient,
  moduleIds: string[],
): Promise<ModuleAssetRecord[]> {
  let lastError: PostgrestError | null = null

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      const allAssets: ModuleAssetRecord[] = []
      const pageSize = 1000
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('module_assets')
          .select('id, module_id, file_name, storage_path, display_name, metadata, display_order')
          .in('module_id', moduleIds)
          .order('module_id', { ascending: true })
          .order('display_order', { ascending: true })
          .range(offset, offset + pageSize - 1)

        if (error) {
          lastError = error
          throw error
        }

        if (data && data.length > 0) {
          allAssets.push(...(data as ModuleAssetRecord[]))
          offset += pageSize
          hasMore = data.length === pageSize
        } else {
          hasMore = false
        }
      }

      return allAssets
    } catch {
      if (attempt >= RETRY_ATTEMPTS || !shouldRetryPostgrestError(lastError)) {
        break
      }

      const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      await delay(backoff)
    }
  }

  console.error('[Assets API] Failed to load module_assets after retries', {
    moduleCount: moduleIds.length,
    error: lastError?.message,
  })
  return []
}

function shouldRetryPostgrestError(error: PostgrestError | null): boolean {
  if (!error) {
    return true
  }

  const retriableCodes = new Set(['PGRST100', 'PGRST116'])
  if (error.code && retriableCodes.has(error.code)) {
    return true
  }

  const message = (error.message || '').toLowerCase()
  return /timeout|server error|fetch failed|unavailable|connection/i.test(message)
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
