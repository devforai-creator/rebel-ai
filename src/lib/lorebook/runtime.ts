import { renderLorebook } from '@/lib/lorebook-renderer'
import type { SanitizedMessage, ServerSupabaseClient } from '@/lib/chat-summaries/types'
import type { LorebookEntry } from '@/types/risuai.types'
import {
  computeLorebookEntryFingerprint,
  getLorebookOverrideKeyV2,
} from '@/lib/lorebook/override-identity'

type LorebookRuntimeEntry = LorebookEntry & { moduleId: string; modulePriority?: number }

type CharacterModuleRow = {
  module_id: string
  priority?: number | null
  modules:
    | { id?: string | null; lorebook?: LorebookEntry[] | null }
    | Array<{
        id?: string | null
        lorebook?: LorebookEntry[] | null
      }>
    | null
}

type LorebookOverrideV2Row = {
  module_id: string | null
  entry_fingerprint: string | null
  enabled: boolean
}

type LorebookOverrideV1Row = {
  entry_key: string | null
  entry_insertorder: number | null
  enabled: boolean
}

type LoadChatLorebookStateResult = {
  entries: LorebookRuntimeEntry[]
  overrideMap: Map<string, boolean>
}

type BuildLorebookDynamicContextOptions = {
  supabase: ServerSupabaseClient
  chatId: string
  characterId: string
  chatHistory: SanitizedMessage[]
  onMetrics?: (metrics: LorebookDynamicContextMetrics) => void
}

export type LorebookDynamicContextMetrics = {
  moduleCount: number
  entryCount: number
  overrideCount: number
  hasContext: boolean
  contextCharCount: number
}

export async function loadChatLorebookState({
  supabase,
  chatId,
  characterId,
}: {
  supabase: ServerSupabaseClient
  chatId: string
  characterId: string
}): Promise<LoadChatLorebookStateResult> {
  const [
    { data: characterModules, error: characterModulesError },
    { data: lorebookOverridesV2, error: lorebookOverridesV2Error },
    { data: lorebookOverridesV1, error: lorebookOverridesV1Error },
  ] = await Promise.all([
    supabase
      .from('character_modules')
      .select(
        `
          module_id,
          enabled,
          modules (
            id,
            lorebook
          )
        `,
      )
      .eq('character_id', characterId)
      .eq('enabled', true)
      .order('priority', { ascending: false }),
    supabase
      .from('lorebook_overrides_v2')
      .select('module_id, entry_key, entry_insertorder, entry_fingerprint, enabled')
      .eq('chat_id', chatId),
    supabase
      .from('lorebook_overrides')
      .select('entry_key, entry_insertorder, enabled')
      .eq('chat_id', chatId),
  ])

  if (characterModulesError) {
    console.error(
      '[lorebook-runtime] Failed to load character modules:',
      characterModulesError.message,
    )
    return { entries: [], overrideMap: new Map() }
  }

  if (lorebookOverridesV2Error) {
    console.error(
      '[lorebook-runtime] Failed to load v2 lorebook overrides:',
      lorebookOverridesV2Error.message,
    )
  }

  if (lorebookOverridesV1Error) {
    console.error(
      '[lorebook-runtime] Failed to load v1 lorebook overrides:',
      lorebookOverridesV1Error.message,
    )
  }

  const entries = extractLorebookEntries((characterModules ?? []) as CharacterModuleRow[])
  if (entries.length === 0) {
    return { entries: [], overrideMap: new Map() }
  }

  const overrideMap = buildOverrideMap({
    entries,
    lorebookOverridesV2: (lorebookOverridesV2 ?? []) as LorebookOverrideV2Row[],
    lorebookOverridesV1: (lorebookOverridesV1 ?? []) as LorebookOverrideV1Row[],
  })

  return { entries, overrideMap }
}

export function renderActiveLorebookBlock({
  entries,
  overrideMap,
  chatHistory,
}: {
  entries: LorebookRuntimeEntry[]
  overrideMap: Map<string, boolean>
  chatHistory: SanitizedMessage[]
}): string | null {
  if (entries.length === 0) {
    return null
  }

  const effectiveEntries = entries
    .filter((entry) => getLorebookOverrideMode(entry, overrideMap) !== 'disabled')
    .map((entry) =>
      getLorebookOverrideMode(entry, overrideMap) === 'pinned'
        ? { ...entry, alwaysActive: true }
        : entry,
    )

  if (effectiveEntries.length === 0) {
    return null
  }

  const { activeEntries } = renderLorebook({
    lorebookEntries: effectiveEntries,
    chatHistory,
  })

  if (activeEntries.length === 0) {
    return null
  }

  const sections = activeEntries
    .slice()
    .sort(compareLorebookEntries)
    .map((entry) => entry.content.trim())
    .filter(Boolean)

  if (sections.length === 0) {
    return null
  }

  return `=== Active Lorebook Entries ===\n${sections.join('\n\n')}`
}

export function lorebookNeedsChatHistory({
  entries,
  overrideMap,
}: {
  entries: LorebookRuntimeEntry[]
  overrideMap: Map<string, boolean>
}): boolean {
  return entries
    .filter((entry) => getLorebookOverrideMode(entry, overrideMap) !== 'disabled')
    .map((entry) =>
      getLorebookOverrideMode(entry, overrideMap) === 'pinned'
        ? { ...entry, alwaysActive: true }
        : entry,
    )
    .some(
      (entry) => !entry.alwaysActive && typeof entry.key === 'string' && entry.key.trim() !== '',
    )
}

export async function buildLorebookDynamicContext({
  supabase,
  chatId,
  characterId,
  chatHistory,
  onMetrics,
}: BuildLorebookDynamicContextOptions): Promise<string | null> {
  const { entries, overrideMap } = await loadChatLorebookState({
    supabase,
    chatId,
    characterId,
  })

  const context = renderActiveLorebookBlock({
    entries,
    overrideMap,
    chatHistory,
  })

  onMetrics?.({
    moduleCount: new Set(entries.map((entry) => entry.moduleId)).size,
    entryCount: entries.length,
    overrideCount: overrideMap.size,
    hasContext: context !== null,
    contextCharCount: context?.length ?? 0,
  })

  return context
}

function extractLorebookEntries(characterModules: CharacterModuleRow[]): LorebookRuntimeEntry[] {
  const entries: LorebookRuntimeEntry[] = []

  for (const characterModule of characterModules) {
    const moduleData = Array.isArray(characterModule.modules)
      ? characterModule.modules[0]
      : characterModule.modules
    const moduleLorebook = moduleData?.lorebook

    if (!Array.isArray(moduleLorebook)) {
      continue
    }

    entries.push(
      ...moduleLorebook.map((entry) => ({
        ...entry,
        moduleId: characterModule.module_id,
        modulePriority: characterModule.priority ?? 0,
      })),
    )
  }

  return entries
}

function buildOverrideMap({
  entries,
  lorebookOverridesV2,
  lorebookOverridesV1,
}: {
  entries: LorebookRuntimeEntry[]
  lorebookOverridesV2: LorebookOverrideV2Row[]
  lorebookOverridesV1: LorebookOverrideV1Row[]
}): Map<string, boolean> {
  const overrideMap = new Map<string, boolean>()

  for (const override of lorebookOverridesV2) {
    if (!override.module_id || !override.entry_fingerprint) {
      continue
    }

    overrideMap.set(
      getLorebookOverrideKeyV2(override.module_id, override.entry_fingerprint),
      override.enabled,
    )
  }

  if (lorebookOverridesV1.length === 0) {
    return overrideMap
  }

  const legacyCounts = new Map<string, number>()
  for (const entry of entries) {
    const legacyKey = `${entry.key}-${entry.insertorder ?? 0}`
    legacyCounts.set(legacyKey, (legacyCounts.get(legacyKey) ?? 0) + 1)
  }

  for (const override of lorebookOverridesV1) {
    if (override.entry_key === null || override.entry_insertorder === null) {
      continue
    }

    const legacyKey = `${override.entry_key}-${override.entry_insertorder}`
    if ((legacyCounts.get(legacyKey) ?? 0) !== 1) {
      continue
    }

    const matched = entries.find(
      (entry) =>
        entry.key === override.entry_key && (entry.insertorder ?? 0) === override.entry_insertorder,
    )
    if (!matched) {
      continue
    }

    const v2Key = getLorebookOverrideKeyV2(
      matched.moduleId,
      computeLorebookEntryFingerprint(matched.moduleId, matched),
    )
    if (!overrideMap.has(v2Key)) {
      overrideMap.set(v2Key, override.enabled)
    }
  }

  return overrideMap
}

function getLorebookOverrideMode(
  entry: LorebookRuntimeEntry,
  overrideMap: Map<string, boolean>,
): 'auto' | 'pinned' | 'disabled' {
  const overrideKey = getLorebookOverrideKeyV2(
    entry.moduleId,
    computeLorebookEntryFingerprint(entry.moduleId, entry),
  )

  if (!overrideMap.has(overrideKey)) {
    return 'auto'
  }

  return overrideMap.get(overrideKey) ? 'pinned' : 'disabled'
}

function compareLorebookEntries(
  a: LorebookEntry & { moduleId?: string; modulePriority?: number },
  b: LorebookEntry & { moduleId?: string; modulePriority?: number },
): number {
  const insertorderDiff = (b.insertorder ?? 0) - (a.insertorder ?? 0)
  if (insertorderDiff !== 0) {
    return insertorderDiff
  }

  const keyDiff = a.key.localeCompare(b.key)
  if (keyDiff !== 0) {
    return keyDiff
  }

  const commentDiff = (a.comment ?? '').localeCompare(b.comment ?? '')
  if (commentDiff !== 0) {
    return commentDiff
  }

  const modulePriorityDiff = (b.modulePriority ?? 0) - (a.modulePriority ?? 0)
  if (modulePriorityDiff !== 0) {
    return modulePriorityDiff
  }

  return (a.moduleId ?? '').localeCompare(b.moduleId ?? '')
}

export type { LorebookRuntimeEntry }
