import type { LorebookEntry } from '@/types/lorebook.types'
import {
  computeLorebookEntryFingerprint,
  getLorebookOverrideKeyV2,
} from '@/lib/lorebook/override-identity'

export type LorebookFilter = 'all' | 'always' | 'keyword' | 'pinned' | 'disabled'
export type LorebookOverrideMode = 'auto' | 'pinned' | 'disabled'

export type GroupedLorebookEntries = {
  folderMap: Map<string, LorebookEntry[]>
  folderOrder: string[]
}

export function filteredListFromGrouped(groupedEntries: GroupedLorebookEntries) {
  const flat: LorebookEntry[] = []
  for (const folderKey of groupedEntries.folderOrder) {
    flat.push(...(groupedEntries.folderMap.get(folderKey) ?? []))
  }
  return flat
}

export function getEntryModuleId(entry: LorebookEntry) {
  return (entry as LorebookEntry & { moduleId?: string }).moduleId
}

const entryFingerprintCache = new WeakMap<object, string>()

export function computeEntryFingerprint(entry: LorebookEntry) {
  const cached = entryFingerprintCache.get(entry as object)
  if (cached) return cached

  const moduleId = getEntryModuleId(entry)
  const fingerprint = moduleId
    ? computeLorebookEntryFingerprint(moduleId, entry)
    : getEntryIdFallback(entry)
  entryFingerprintCache.set(entry as object, fingerprint)
  return fingerprint
}

export function getEntryId(entry: LorebookEntry) {
  const source = getEntryModuleId(entry) ?? 'unknown'
  return `${source}::${computeEntryFingerprint(entry)}`
}

export function getOverrideMapKey(entry: LorebookEntry) {
  const moduleId = getEntryModuleId(entry)
  if (!moduleId) return `legacy:${entry.key}-${entry.insertorder}`
  return getLorebookOverrideKeyV2(moduleId, computeEntryFingerprint(entry))
}

export function getOverrideMode(
  entry: LorebookEntry,
  overrideMap: Map<string, boolean>,
): LorebookOverrideMode {
  const key = getOverrideMapKey(entry)
  if (!overrideMap.has(key)) return 'auto'
  return overrideMap.get(key) ? 'pinned' : 'disabled'
}

export function getActivationStatus(entry: LorebookEntry, overrideMap: Map<string, boolean>) {
  const overrideMode = getOverrideMode(entry, overrideMap)

  if (overrideMode === 'disabled') {
    return { color: 'bg-red-500', label: 'Forced off (this chat)' }
  }
  if (overrideMode === 'pinned') {
    return { color: 'bg-blue-500', label: 'Forced on (this chat)' }
  }
  if (entry.alwaysActive) {
    return { color: 'bg-green-500', label: 'Always (constant)' }
  }
  return { color: 'bg-zinc-400 dark:bg-zinc-600', label: 'Conditional (keyword)' }
}

export function stripMarkdownForPreview(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatKeywordPreview(key: string) {
  const parts = key
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const shown = parts.slice(0, 3)
  const hiddenCount = Math.max(0, parts.length - shown.length)
  return { shown, hiddenCount }
}

function getEntryIdFallback(entry: LorebookEntry) {
  const identity = [
    entry.mode,
    entry.key ?? '',
    entry.secondkey ?? '',
    entry.comment ?? '',
    entry.folder ?? '',
    String(entry.insertorder ?? 0),
    entry.alwaysActive ? '1' : '0',
    entry.selective ? '1' : '0',
    entry.useRegex ? '1' : '0',
    entry.content ?? '',
  ].join('\n')

  let hash = 5381
  for (let i = 0; i < identity.length; i++) {
    hash = (hash * 33) ^ identity.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}
