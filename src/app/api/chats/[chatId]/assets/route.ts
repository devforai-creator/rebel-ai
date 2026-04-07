import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildAssetUrlMap, normalizeAssetKey } from '@/lib/asset-resolver'
import type { PostgrestError } from '@supabase/supabase-js'

type ModuleAssetRecord = {
  id: string
  module_id: string
  file_name: string
  storage_path: string
  display_name: string | null
  display_order: number | null
  metadata: { aliases?: string[] } | null
}

type GlobalVariableRecord = {
  key: string
  value: unknown
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

export async function GET(_req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: chat } = await supabase
    .from('chats')
    .select(
      `
      id,
      user_id,
      character_id,
      characters (
        id,
        metadata
      )
    `,
    )
    .eq('id', chatId)
    .single()

  if (!chat || chat.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fetch character assets, module data, and global variables in parallel
  const [characterAssets, moduleData, { data: globalVars, error: globalVarsError }] =
    await Promise.all([
      fetchCharacterAssetsWithRetry(supabase, chat.character_id),
      fetchModuleData(supabase, user.id, chat.character_id),
      supabase
        .from('global_variables')
        .select('key, value')
        .eq('chat_id', chatId)
        .eq('user_id', user.id),
    ])

  if (globalVarsError) {
    console.error('[Chat Assets] Failed to load global variables', globalVarsError)
  }

  const { allRegex: moduleRegex, moduleAssetUrls, moduleAssetSummary } = moduleData

  const globalVariables = (globalVars as GlobalVariableRecord[] | null)?.reduce(
    (acc, entry) => {
      if (entry?.key) {
        acc[entry.key] = entry.value
      }
      return acc
    },
    {} as Record<string, unknown>,
  )

  // Build file_name → public URL mapping
  const assetUrlMap = buildAssetUrlMap(characterAssets || [], {
    getPublicUrl: (storagePath: string) => {
      const { data } = supabase.storage.from('character-assets').getPublicUrl(storagePath)
      return data.publicUrl
    },
  })

  // Merge module asset URLs into assetUrlMap
  for (const [name, url] of Object.entries(moduleAssetUrls)) {
    if (!assetUrlMap[name]) {
      assetUrlMap[name] = url
    }
  }

  // Build canonical asset list and short aliases
  const canonicalNames = new Map<string, string>()
  const shortAliasToUrl = new Map<string, string>()
  const assetIdToUrl = new Map<string, string>()

  for (const asset of characterAssets || []) {
    const { data } = supabase.storage.from('character-assets').getPublicUrl(asset.storage_path)
    const assetUrl = data.publicUrl
    assetIdToUrl.set(asset.id, assetUrl)

    const name = (asset as { canonical_name?: string | null }).canonical_name
    if (!name) continue

    const lowerKey = name.toLowerCase().replace(/[\s_-]+/g, '_')
    const existing = canonicalNames.get(lowerKey)
    if (!existing) {
      canonicalNames.set(lowerKey, name)
    } else if (/[A-Z]/.test(name) && !/[A-Z]/.test(existing)) {
      canonicalNames.set(lowerKey, name)
    }

    // Generate short aliases
    const extMatch = name.match(/\.(png|webp|jpg|jpeg|gif|avif)$/i)
    const ext = extMatch ? extMatch[0] : ''
    const baseName = ext ? name.slice(0, -ext.length) : name
    const prefixMatch = baseName.match(/^([a-zA-Z가-힣]+)[_\s](.+)$/)

    if (prefixMatch) {
      const prefix = prefixMatch[1]
      const descriptor = prefixMatch[2]
      const words = descriptor.split(/[\s_]+/).filter((w) => w.length >= 2)

      for (const word of words) {
        const shortAlias = `${prefix}_${word}${ext}`
        const shortAliasLower = shortAlias.toLowerCase()

        if (!canonicalNames.has(shortAliasLower.replace(/[\s_-]+/g, '_'))) {
          canonicalNames.set(shortAliasLower.replace(/[\s_-]+/g, '_'), shortAlias)
          shortAliasToUrl.set(shortAlias, assetUrl)
          shortAliasToUrl.set(shortAliasLower, assetUrl)
        }

        const stems = generateWordStems(word)
        for (const stem of stems) {
          const stemAlias = `${prefix}_${stem}${ext}`
          const stemAliasLower = stemAlias.toLowerCase()
          if (!canonicalNames.has(stemAliasLower.replace(/[\s_-]+/g, '_'))) {
            canonicalNames.set(stemAliasLower.replace(/[\s_-]+/g, '_'), stemAlias)
            shortAliasToUrl.set(stemAlias, assetUrl)
            shortAliasToUrl.set(stemAliasLower, assetUrl)
          }
        }
      }
    }
  }

  // Extend assetUrlMap with short aliases
  for (const [alias, url] of shortAliasToUrl) {
    if (!assetUrlMap[alias]) {
      assetUrlMap[alias] = url
    }
  }

  // Build imageCommandUrlMap
  const imageCommandUrlMap: Record<string, string> = {}
  const characterData = Array.isArray(chat.characters) ? chat.characters[0] : chat.characters
  const imageCommands = (
    characterData?.metadata as { image_commands?: Record<string, string> } | null | undefined
  )?.image_commands

  if (imageCommands && typeof imageCommands === 'object') {
    for (const [command, assetId] of Object.entries(imageCommands)) {
      if (!command || !assetId) continue
      const assetUrl = assetIdToUrl.get(assetId)
      if (!assetUrl) continue
      imageCommandUrlMap[command] = assetUrl
      const normalized = normalizeAssetKey(command)
      if (normalized) {
        imageCommandUrlMap[normalized] = assetUrl
      }
    }
  }

  const characterList = (
    characterData?.metadata as { character_list?: string[] | string } | null | undefined
  )?.character_list

  if (characterList) {
    const commandNames = Array.isArray(characterList)
      ? characterList
      : String(characterList)
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)

    if (commandNames.length > 0) {
      const orderedAssets = (characterAssets || []).filter(
        (asset) => !asset.file_name.startsWith('1.'),
      )

      for (let i = 0; i < commandNames.length && i < orderedAssets.length; i += 1) {
        const command = commandNames[i]
        const normalized = normalizeAssetKey(command)
        if (imageCommandUrlMap[command] || (normalized && imageCommandUrlMap[normalized])) {
          continue
        }

        const assetUrl = assetIdToUrl.get(orderedAssets[i].id)
        if (!assetUrl) continue
        imageCommandUrlMap[command] = assetUrl
        if (normalized) {
          imageCommandUrlMap[normalized] = assetUrl
        }
      }
    }
  }

  return NextResponse.json({
    characterAssets: characterAssets || [],
    assetUrlMap,
    imageCommandUrlMap,
    moduleRegex,
    moduleAssetSummary,
    globalVariables: globalVariables || {},
  })
}

async function fetchCharacterAssetsWithRetry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  characterId: string,
) {
  let lastError: PostgrestError | null = null

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      const allAssets: Array<{
        id: string
        file_name: string
        storage_path: string
        display_name: string | null
        canonical_name: string | null
        metadata: { aliases?: string[] } | null
      }> = []

      const PAGE_SIZE = 1000
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
          .range(offset, offset + PAGE_SIZE - 1)

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
          offset += PAGE_SIZE
          hasMore = data.length === PAGE_SIZE
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

async function fetchModuleData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  characterId: string,
) {
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
    .order('priority', { ascending: true })

  if (!characterModules || characterModules.length === 0) {
    return { allRegex: [], moduleAssetUrls: {}, moduleAssetSummary: [] }
  }

  const moduleIds = Array.from(
    new Set(
      characterModules
        .map((cm) => {
          const modules = cm.modules as { id?: string } | null
          return modules?.id ?? cm.module_id
        })
        .filter((id): id is string => Boolean(id)),
    ),
  )

  const moduleAssets =
    moduleIds.length > 0 ? await fetchModuleAssetsWithRetry(supabase, userId, moduleIds) : []

  const moduleAssetsByModuleId: Record<string, string[]> = {}
  for (const asset of moduleAssets) {
    if (!moduleAssetsByModuleId[asset.module_id]) {
      moduleAssetsByModuleId[asset.module_id] = []
    }
    moduleAssetsByModuleId[asset.module_id].push(asset.file_name)
  }

  const moduleAssetUrls: Record<string, string> =
    moduleAssets.length > 0
      ? buildAssetUrlMap(moduleAssets, {
          getPublicUrl: (storagePath: string) => {
            const { data } = supabase.storage.from('module-assets').getPublicUrl(storagePath)
            return data.publicUrl
          },
        })
      : {}

  type ModuleAssetSummary = {
    moduleId: string
    moduleName: string | null
    assetCount: number
    expectedAssetCount: number
  }

  const allRegex: Array<{
    type: string
    comment: string
    in: string
    out: string
    ableFlag: boolean
    bindings?: Record<string, string>
    card_ref?: string
  }> = []

  const moduleAssetSummary: ModuleAssetSummary[] = []

  for (const cm of characterModules) {
    const modules = cm.modules as {
      id?: string
      name?: string
      regex?: unknown[]
      assets?: unknown[]
    } | null

    if (!modules) continue

    const moduleId = modules.id ?? cm.module_id
    const moduleAssetNames = moduleId ? (moduleAssetsByModuleId[moduleId] ?? []) : []

    // Extract asset names from module (legacy fallback)
    const fallbackAssetNames: string[] = []
    if (modules.assets && Array.isArray(modules.assets)) {
      for (const asset of modules.assets) {
        if (Array.isArray(asset) && asset.length > 0) {
          const assetName = String(asset[0])
          fallbackAssetNames.push(assetName)

          if (asset.length > 1 && asset[1]) {
            const dataUrl = String(asset[1])
            if (dataUrl.startsWith('data:') || dataUrl.startsWith('http')) {
              if (!moduleAssetUrls[assetName]) {
                moduleAssetUrls[assetName] = dataUrl
              }
              const withoutExt = assetName.replace(/\.(webp|png|jpg|jpeg|gif|avif)$/i, '')
              if (withoutExt !== assetName && !moduleAssetUrls[withoutExt]) {
                moduleAssetUrls[withoutExt] = dataUrl
              }
              const normalized = assetName.toLowerCase().replace(/[\s-]+/g, '_')
              if (normalized !== assetName && !moduleAssetUrls[normalized]) {
                moduleAssetUrls[normalized] = dataUrl
              }
            }
          }
        } else if (typeof asset === 'string') {
          fallbackAssetNames.push(asset)
        }
      }
    }

    const expectedAssetCount = fallbackAssetNames.length
    const storedAssetCount = moduleAssetNames.length

    if (moduleId) {
      moduleAssetSummary.push({
        moduleId,
        moduleName: modules.name ?? null,
        assetCount: storedAssetCount,
        expectedAssetCount,
      })
    }

    // Process regex entries
    if (modules.regex && Array.isArray(modules.regex)) {
      for (const entry of modules.regex) {
        if (entry && typeof entry === 'object' && 'in' in entry && 'out' in entry) {
          const e = entry as Record<string, unknown>
          const outStr = String(e.out)
          allRegex.push({
            type: typeof e.type === 'string' ? e.type : '',
            comment: typeof e.comment === 'string' ? e.comment : '',
            in: String(e.in),
            out: outStr,
            ableFlag: typeof e.ableFlag === 'boolean' ? e.ableFlag : true,
            // Pass through bindings for extract regex type (v1.1)
            ...(e.type === 'extract' && e.bindings && typeof e.bindings === 'object'
              ? { bindings: e.bindings as Record<string, string> }
              : {}),
            ...(e.type === 'extract' && typeof e.card_ref === 'string' && e.card_ref.trim()
              ? { card_ref: e.card_ref.trim() }
              : {}),
          })
        }
      }
    }
  }

  return { allRegex, moduleAssetUrls, moduleAssetSummary }
}

async function fetchModuleAssetsWithRetry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  moduleIds: string[],
): Promise<ModuleAssetRecord[]> {
  let lastError: PostgrestError | null = null

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      const allAssets: ModuleAssetRecord[] = []
      const PAGE_SIZE = 1000
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('module_assets')
          .select('id, module_id, file_name, storage_path, display_name, metadata, display_order')
          .eq('user_id', userId)
          .in('module_id', moduleIds)
          .order('module_id', { ascending: true })
          .order('display_order', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) {
          lastError = error
          throw error
        }

        if (data && data.length > 0) {
          allAssets.push(...(data as ModuleAssetRecord[]))
          offset += PAGE_SIZE
          hasMore = data.length === PAGE_SIZE
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
  if (!error) return true

  const retriableCodes = new Set(['PGRST100', 'PGRST116'])
  if (error.code && retriableCodes.has(error.code)) return true

  const message = (error.message || '').toLowerCase()
  return /timeout|server error|fetch failed|unavailable|connection/i.test(message)
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateWordStems(word: string): string[] {
  const stems: string[] = []
  const lowerWord = word.toLowerCase()

  const suffixRules: Array<[RegExp, string | null]> = [
    [/ingly$/i, null],
    [/edly$/i, null],
    [/ly$/i, ''],
    [/ing$/i, ''],
    [/ed$/i, ''],
    [/ness$/i, 'y'],
    [/ment$/i, ''],
    [/tion$/i, 't'],
    [/ful$/i, ''],
    [/less$/i, ''],
  ]

  for (const [pattern, replacement] of suffixRules) {
    if (pattern.test(lowerWord)) {
      const stem = lowerWord.replace(pattern, replacement ?? '')
      if (stem.length >= 3 && stem !== lowerWord) {
        stems.push(stem)
      }
      break
    }
  }

  return stems
}
