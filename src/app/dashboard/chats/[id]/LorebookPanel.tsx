'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Ban,
  BookOpen,
  CircleDashed,
  Folder,
  KeyRound,
  Pin,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import type { LorebookEntry } from '@/types/risuai.types'
import {
  computeLorebookEntryFingerprint,
  getLorebookOverrideKeyV2,
} from '@/lib/lorebook/override-identity'
import { setLorebookEntryOverride, type LorebookOverrideMode } from './lorebook-actions'

interface LorebookPanelProps {
  lorebookEntries: LorebookEntry[]
  chatId: string
  overrideMap: Map<string, boolean>
}

type LorebookFilter = 'all' | 'always' | 'keyword' | 'pinned' | 'disabled'

export default function LorebookPanel({
  lorebookEntries,
  chatId,
  overrideMap,
}: LorebookPanelProps) {
  const hasEntries = lorebookEntries.length > 0
  const [isDesktopOpen, setIsDesktopOpen] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<LorebookFilter>('all')
  const [showPreview, setShowPreview] = useState(false)
  const [groupByFolder, setGroupByFolder] = useState(true)
  const [activeFolderKey, setActiveFolderKey] = useState<string | null>(null)
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null)

  const [localOverrideMap, setLocalOverrideMap] = useState(() => new Map(overrideMap))
  useEffect(() => {
    setLocalOverrideMap(new Map(overrideMap))
  }, [overrideMap])

  useEffect(() => {
    if (!groupByFolder) {
      setActiveFolderKey(null)
    }
  }, [groupByFolder])

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      setActiveFolderKey(null)
    }
  }, [searchQuery])

  useEffect(() => {
    setExpandedEntryId(null)
  }, [activeFolderKey, searchQuery, groupByFolder])

  // Single interaction model: click toggles inline expand

  const setEntryOverride = async (entry: LorebookEntry, mode: LorebookOverrideMode) => {
    const mapKey = getOverrideMapKey(entry)
    const previousMode = getOverrideMode(entry, localOverrideMap)
    const previousValue = localOverrideMap.get(mapKey)

    const moduleId = getEntryModuleId(entry)
    if (!moduleId) {
      return 'Missing module id for this entry'
    }

    setLocalOverrideMap((prev) => {
      const next = new Map(prev)
      if (mode === 'auto') next.delete(mapKey)
      else next.set(mapKey, mode === 'pinned')
      return next
    })

    try {
      const result = await setLorebookEntryOverride({
        chatId,
        moduleId,
        entryKey: entry.key,
        entryInsertorder: entry.insertorder ?? 0,
        entryContent: entry.content,
        entryComment: entry.comment,
        entrySecondkey: entry.secondkey,
        entryMode: entry.mode === 'folder' ? 'folder' : 'normal',
        entryAlwaysActive: entry.alwaysActive,
        entrySelective: entry.selective,
        entryFolder: entry.folder,
        entryUseRegex: entry.useRegex,
        mode,
      })

      if (result.error) {
        setLocalOverrideMap((prev) => {
          const next = new Map(prev)
          if (previousMode === 'auto') next.delete(mapKey)
          else next.set(mapKey, previousValue ?? false)
          return next
        })
        return result.error
      }
    } catch (error) {
      console.error('[Lorebook Override] Failed to set:', error)
      setLocalOverrideMap((prev) => {
        const next = new Map(prev)
        if (previousMode === 'auto') next.delete(mapKey)
        else next.set(mapKey, previousValue ?? false)
        return next
      })
      return 'Failed to save preference'
    }

    return null
  }

  // Statistics
  const totalEntries = lorebookEntries.filter((e) => e.mode !== 'folder').length
  const alwaysActiveCount = lorebookEntries.filter((e) => e.alwaysActive).length

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const isMatch = (entry: LorebookEntry) => {
      if (entry.mode === 'folder') return false

      const mapKey = getOverrideMapKey(entry)
      const hasOverride = localOverrideMap.has(mapKey)
      const overrideEnabled = hasOverride ? localOverrideMap.get(mapKey) : undefined

      if (filter === 'always' && !entry.alwaysActive) return false
      if (filter === 'keyword' && entry.alwaysActive) return false
      if (filter === 'pinned' && !(hasOverride && overrideEnabled === true)) return false
      if (filter === 'disabled' && !(hasOverride && overrideEnabled === false)) return false

      if (!query) return true

      const haystack =
        `${entry.comment ?? ''}\n${entry.key ?? ''}\n${entry.content ?? ''}`.toLowerCase()
      return haystack.includes(query)
    }

    // Preserve the original import/module order for familiarity.
    // (We only filter here; no sorting.)
    return lorebookEntries.filter(isMatch)
  }, [filter, localOverrideMap, lorebookEntries, searchQuery])

  const folderMeta = useMemo(() => {
    const meta = new Map<string, string>()
    for (const entry of lorebookEntries) {
      if (entry.mode !== 'folder') continue
      meta.set(entry.key, entry.comment || entry.key)
    }
    return meta
  }, [lorebookEntries])

  const groupedEntries = useMemo(() => {
    const folderMap = new Map<string, LorebookEntry[]>()
    const folderOrder: string[] = []

    const ensureFolder = (folderKey: string) => {
      if (folderMap.has(folderKey)) return
      folderMap.set(folderKey, [])
      folderOrder.push(folderKey)
    }

    ensureFolder('__root__')

    for (const entry of filteredEntries) {
      const folderKey = entry.folder && folderMeta.has(entry.folder) ? entry.folder : '__root__'
      ensureFolder(folderKey)
      folderMap.get(folderKey)!.push(entry)
    }

    return { folderMap, folderOrder }
  }, [filteredEntries, folderMeta])

  const isSearching = searchQuery.trim().length > 0

  const panelContentProps = {
    overrideMap: localOverrideMap,
    totalEntries,
    alwaysActiveCount,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    showPreview,
    setShowPreview,
    groupByFolder,
    setGroupByFolder,
    activeFolderKey,
    setActiveFolderKey,
    isSearching,
    expandedEntryId,
    setExpandedEntryId,
    folderMeta,
    groupedEntries,
    setEntryOverride,
  }

  if (!hasEntries) {
    return null
  }

  return (
    <>
      <div
        className={`hidden lg:block relative h-full flex-shrink-0 transition-[width] duration-300 ${
          isDesktopOpen ? 'w-80' : 'w-12'
        }`}
      >
        {/* Toggle Button */}
        {!isDesktopOpen && (
          <button
            onClick={() => setIsDesktopOpen(true)}
            className="absolute left-0 top-4 flex h-10 w-10 items-center justify-center rounded-r-lg border border-l-0 bg-background hover:bg-muted transition-colors"
            title="Open lorebook"
            aria-label="Open lorebook"
          >
            <BookOpen className="h-5 w-5 text-muted-foreground" />
          </button>
        )}

        {/* Sidebar Panel */}
        {isDesktopOpen && (
          <LorebookPanelContent
            {...panelContentProps}
            onClose={() => setIsDesktopOpen(false)}
            className="border-l"
          />
        )}
      </div>

      {/* Mobile toggle button */}
      {!isMobileOpen && (
        <button
          onClick={() => setIsMobileOpen(true)}
          className="lg:hidden fixed top-28 left-4 z-40 w-12 h-12 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-blue-600 shadow-lg flex items-center justify-center transition-colors"
          aria-label="Open lorebook"
          title="Open lorebook"
        >
          <BookOpen className="h-5 w-5" />
        </button>
      )}

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[90vw] bg-background shadow-xl border-r border-gray-200 dark:border-gray-700">
            <LorebookPanelContent
              {...panelContentProps}
              onClose={() => setIsMobileOpen(false)}
              className="border-l-0 h-full"
            />
          </div>
        </div>
      )}
    </>
  )
}

interface LorebookPanelContentProps {
  overrideMap: Map<string, boolean>
  totalEntries: number
  alwaysActiveCount: number
  searchQuery: string
  setSearchQuery: (value: string) => void
  filter: LorebookFilter
  setFilter: (value: LorebookFilter) => void
  showPreview: boolean
  setShowPreview: (value: boolean) => void
  groupByFolder: boolean
  setGroupByFolder: (value: boolean) => void
  activeFolderKey: string | null
  setActiveFolderKey: (value: string | null) => void
  isSearching: boolean
  expandedEntryId: string | null
  setExpandedEntryId: (value: string | null) => void
  folderMeta: Map<string, string>
  groupedEntries: { folderMap: Map<string, LorebookEntry[]>; folderOrder: string[] }
  setEntryOverride: (entry: LorebookEntry, mode: LorebookOverrideMode) => Promise<string | null>
  onClose: () => void
  className?: string
}

function LorebookPanelContent({
  overrideMap,
  totalEntries,
  alwaysActiveCount,
  onClose,
  className = '',
  searchQuery,
  setSearchQuery,
  filter,
  setFilter,
  showPreview,
  setShowPreview,
  groupByFolder,
  setGroupByFolder,
  activeFolderKey,
  setActiveFolderKey,
  isSearching,
  expandedEntryId,
  setExpandedEntryId,
  folderMeta,
  groupedEntries,
  setEntryOverride,
}: LorebookPanelContentProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)

  const activeFolderEntries = useMemo(() => {
    if (!activeFolderKey) return []
    return groupedEntries.folderMap.get(activeFolderKey) ?? []
  }, [activeFolderKey, groupedEntries.folderMap])

  const activeFolderLabel =
    activeFolderKey === '__root__'
      ? 'Root'
      : activeFolderKey
        ? (folderMeta.get(activeFolderKey) ?? activeFolderKey)
        : null

  return (
    <div className={`flex h-full flex-col bg-muted/10 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background/80 backdrop-blur px-3 py-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold">Lorebook</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsSearchOpen((prev) => !prev)}
            className="rounded-md p-1.5 hover:bg-muted"
            title="Search"
            aria-label="Toggle search"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIsOptionsOpen((prev) => !prev)}
            className="rounded-md p-1.5 hover:bg-muted"
            title="Options"
            aria-label="Toggle options"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-muted"
            title="Close"
            aria-label="Close lorebook"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {(isSearchOpen || isOptionsOpen) && (
        <div className="border-b bg-background/80 backdrop-blur px-3 py-2 space-y-2">
          {isSearchOpen && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search entries…"
                className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
                aria-label="Search lorebook entries"
              />
            </div>
          )}

          {isOptionsOpen && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as LorebookFilter)}
                  className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                  aria-label="Filter lorebook entries"
                >
                  <option value="all">All</option>
                  <option value="always">Always</option>
                  <option value="keyword">Keyword</option>
                  <option value="pinned">Pinned</option>
                  <option value="disabled">Disabled</option>
                </select>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupByFolder}
                    onChange={(e) => setGroupByFolder(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  Group
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showPreview}
                    onChange={(e) => setShowPreview(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  Preview
                </label>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span>
                  Total <span className="text-foreground font-medium">{totalEntries}</span>
                </span>
                <span className="text-muted-foreground/60">•</span>
                <span>
                  Always <span className="text-green-600 font-medium">{alwaysActiveCount}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {groupByFolder && !isSearching ? (
          <div className="p-2">
            {activeFolderKey ? (
              <div className="rounded-md border overflow-hidden">
                <button
                  onClick={() => {
                    setActiveFolderKey(null)
                  }}
                  className="w-full flex items-center gap-2 px-2 py-2 border-b hover:bg-muted/30 transition-colors text-left"
                  aria-label="Back to folders"
                >
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                  <span className="text-base font-medium truncate">{activeFolderLabel}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {activeFolderEntries.length}
                  </span>
                </button>

                {activeFolderEntries.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">Empty.</div>
                ) : (
                  activeFolderEntries.map((entry) => (
                    <LorebookEntryRow
                      key={getEntryId(entry)}
                      entry={entry}
                      overrideMap={overrideMap}
                      showPreview={showPreview}
                      setEntryOverride={setEntryOverride}
                      isExpanded={expandedEntryId === getEntryId(entry)}
                      onToggleExpand={() => {
                        const id = getEntryId(entry)
                        setExpandedEntryId(expandedEntryId === id ? null : id)
                      }}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                {groupedEntries.folderOrder
                  .filter((folderKey) => (groupedEntries.folderMap.get(folderKey) ?? []).length > 0)
                  .map((folderKey) => {
                    const entries = groupedEntries.folderMap.get(folderKey) ?? []
                    const displayName =
                      folderKey === '__root__' ? 'Root' : (folderMeta.get(folderKey) ?? folderKey)

                    return (
                      <button
                        key={folderKey}
                        onClick={() => setActiveFolderKey(folderKey)}
                        className="w-full flex items-center gap-2 px-2 py-3 border-b last:border-b-0 hover:bg-muted/30 transition-colors text-left"
                      >
                        <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-base font-medium truncate">{displayName}</span>
                        <span className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{entries.length}</span>
                        </span>
                      </button>
                    )
                  })}
              </div>
            )}
          </div>
        ) : (
          <div className="border-t">
            {filteredListFromGrouped(groupedEntries).length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No entries.</div>
            ) : (
              filteredListFromGrouped(groupedEntries).map((entry) => (
                <LorebookEntryRow
                  key={getEntryId(entry)}
                  entry={entry}
                  overrideMap={overrideMap}
                  showPreview={showPreview}
                  setEntryOverride={setEntryOverride}
                  isExpanded={expandedEntryId === getEntryId(entry)}
                  onToggleExpand={() => {
                    const id = getEntryId(entry)
                    setExpandedEntryId(expandedEntryId === id ? null : id)
                  }}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function filteredListFromGrouped(groupedEntries: {
  folderMap: Map<string, LorebookEntry[]>
  folderOrder: string[]
}) {
  const flat: LorebookEntry[] = []
  for (const folderKey of groupedEntries.folderOrder) {
    flat.push(...(groupedEntries.folderMap.get(folderKey) ?? []))
  }
  return flat
}

function getEntryId(entry: LorebookEntry) {
  const source = getEntryModuleId(entry) ?? 'unknown'
  return `${source}::${computeEntryFingerprint(entry)}`
}

function getOverrideMapKey(entry: LorebookEntry) {
  const moduleId = getEntryModuleId(entry)
  if (!moduleId) return `legacy:${entry.key}-${entry.insertorder}`
  return getLorebookOverrideKeyV2(moduleId, computeEntryFingerprint(entry))
}

function getOverrideMode(
  entry: LorebookEntry,
  overrideMap: Map<string, boolean>,
): LorebookOverrideMode {
  const key = getOverrideMapKey(entry)
  if (!overrideMap.has(key)) return 'auto'
  return overrideMap.get(key) ? 'pinned' : 'disabled'
}

function getActivationStatus(entry: LorebookEntry, overrideMap: Map<string, boolean>) {
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

function stripMarkdownForPreview(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatKeywordPreview(key: string) {
  const parts = key
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const shown = parts.slice(0, 3)
  const hiddenCount = Math.max(0, parts.length - shown.length)
  return { shown, hiddenCount }
}

function getEntryModuleId(entry: LorebookEntry) {
  return (entry as LorebookEntry & { moduleId?: string }).moduleId
}

const entryFingerprintCache = new WeakMap<object, string>()
function computeEntryFingerprint(entry: LorebookEntry) {
  const cached = entryFingerprintCache.get(entry as object)
  if (cached) return cached

  const moduleId = getEntryModuleId(entry)
  const fingerprint = moduleId
    ? computeLorebookEntryFingerprint(moduleId, entry)
    : getEntryIdFallback(entry)
  entryFingerprintCache.set(entry as object, fingerprint)
  return fingerprint
}

function getEntryIdFallback(entry: LorebookEntry) {
  // Fallback for entries that don't carry moduleId (shouldn't happen in normal flow).
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

function OverrideBadge({ mode }: { mode: LorebookOverrideMode }) {
  if (mode === 'pinned') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 px-1.5 py-0.5 text-[11px]">
        <Pin className="h-3 w-3" />
        Forced on
      </span>
    )
  }
  if (mode === 'disabled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 px-1.5 py-0.5 text-[11px]">
        <Ban className="h-3 w-3" />
        Forced off
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted text-muted-foreground px-1.5 py-0.5 text-[11px]">
      <CircleDashed className="h-3 w-3" />
      Default
    </span>
  )
}

function LorebookEntryRow({
  entry,
  overrideMap,
  showPreview,
  setEntryOverride,
  isExpanded,
  onToggleExpand,
}: {
  entry: LorebookEntry
  overrideMap: Map<string, boolean>
  showPreview: boolean
  setEntryOverride: (entry: LorebookEntry, mode: LorebookOverrideMode) => Promise<string | null>
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mode = getOverrideMode(entry, overrideMap)
  const label = entry.comment?.trim() || entry.key
  const keywordPreview = formatKeywordPreview(entry.key)
  const previewText = useMemo(() => stripMarkdownForPreview(entry.content), [entry.content])
  const activation = getActivationStatus(entry, overrideMap)

  const cycleOverride = async () => {
    const nextMode: LorebookOverrideMode =
      mode === 'auto' ? 'pinned' : mode === 'pinned' ? 'disabled' : 'auto'

    setErrorMessage(null)
    setIsSaving(true)

    try {
      const error = await setEntryOverride(entry, nextMode)
      if (error) setErrorMessage(error)
    } catch (error) {
      console.error('[Lorebook Override] Failed to cycle:', error)
      setErrorMessage('Failed to save preference')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-start gap-2 px-2 py-2 hover:bg-muted/30 transition-colors">
        <span
          className={`mt-1.5 h-2 w-2 rounded-full ${activation.color} flex-shrink-0`}
          title={activation.label}
          aria-label={activation.label}
        />
        <button
          onClick={onToggleExpand}
          className="flex flex-1 min-w-0 items-start gap-2 text-left"
          aria-label={`Open lorebook entry ${label}`}
          aria-expanded={isExpanded}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base font-medium truncate">{label}</span>
            </div>
          </div>
        </button>

        <div className="flex flex-col items-end gap-1 pt-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              void cycleOverride()
            }}
            disabled={isSaving}
            className="rounded-md hover:bg-muted px-1 py-0.5 disabled:opacity-50"
            title="Cycle override: Default → Forced on → Forced off"
            aria-label="Cycle lorebook override"
          >
            <OverrideBadge mode={mode} />
          </button>
        </div>
      </div>

      {errorMessage && <div className="px-2 pb-2 text-xs text-red-600">{errorMessage}</div>}

      {isExpanded && (
        <div className="px-2 pb-2">
          <div className="rounded-md border bg-background/60 p-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />
              <span className="font-medium">Keywords</span>
              <span>({keywordPreview.shown.length + keywordPreview.hiddenCount})</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {keywordPreview.shown.map((k) => (
                <span
                  key={k}
                  className="max-w-[12rem] truncate rounded border border-blue-200/70 bg-blue-50/80 px-2 py-1 text-[12px] text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100"
                >
                  {k}
                </span>
              ))}
              {keywordPreview.hiddenCount > 0 && (
                <span className="rounded border border-blue-200/70 bg-blue-50/80 px-2 py-1 text-[12px] text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
                  +{keywordPreview.hiddenCount}
                </span>
              )}
            </div>
            {showPreview && previewText && (
              <div className="mt-2 text-xs leading-4 text-muted-foreground">{previewText}</div>
            )}
            <div className="mt-2 text-xs leading-4 whitespace-pre-wrap break-words">
              {entry.content}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
