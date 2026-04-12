'use client'

import React, { useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Folder, Search, SlidersHorizontal, X } from 'lucide-react'
import Button from '@/app/dashboard/components/Button'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import type { LorebookEntry } from '@/types/risuai.types'
import type {
  GroupedLorebookEntries,
  LorebookFilter,
  LorebookOverrideMode,
} from '../utils/lorebook-panel'
import { filteredListFromGrouped, getEntryId } from '../utils/lorebook-panel'
import { LorebookEntryRow } from './LorebookEntryRow'

type LorebookPanelContentProps = {
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
  groupedEntries: GroupedLorebookEntries
  setEntryOverride: (entry: LorebookEntry, mode: LorebookOverrideMode) => Promise<string | null>
  onClose: () => void
  className?: string
}

export function LorebookPanelContent({
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

  const flatEntries = useMemo(() => filteredListFromGrouped(groupedEntries), [groupedEntries])

  return (
    <div className={`flex h-full flex-col bg-muted/10 ${className}`}>
      <div className="flex items-center justify-between border-b bg-background/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold">Lorebook</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button
            onClick={() => setIsSearchOpen((previousValue) => !previousValue)}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Search"
            aria-label="Toggle search"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => setIsOptionsOpen((previousValue) => !previousValue)}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Options"
            aria-label="Toggle options"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <Button
            onClick={onClose}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Close"
            aria-label="Close lorebook"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isSearchOpen || isOptionsOpen ? (
        <div className="space-y-2 border-b bg-background/80 px-3 py-2 backdrop-blur">
          {isSearchOpen ? (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search entries…"
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
                aria-label="Search lorebook entries"
              />
            </div>
          ) : null}

          {isOptionsOpen ? (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as LorebookFilter)}
                  className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                  aria-label="Filter lorebook entries"
                >
                  <option value="all">All</option>
                  <option value="always">Always</option>
                  <option value="keyword">Keyword</option>
                  <option value="pinned">Pinned</option>
                  <option value="disabled">Disabled</option>
                </select>
                <label className="flex cursor-pointer select-none items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={groupByFolder}
                    onChange={(event) => setGroupByFolder(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  Group
                </label>
                <label className="flex cursor-pointer select-none items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={showPreview}
                    onChange={(event) => setShowPreview(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  Preview
                </label>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span>
                  Total <span className="font-medium text-foreground">{totalEntries}</span>
                </span>
                <span className="text-muted-foreground/60">•</span>
                <span>
                  Always <span className="font-medium text-green-600">{alwaysActiveCount}</span>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {groupByFolder && !isSearching ? (
          <div className="p-2">
            {activeFolderKey ? (
              <SurfaceCard padding="none" className="overflow-hidden rounded-md shadow-none">
                <button
                  onClick={() => setActiveFolderKey(null)}
                  className="flex w-full items-center gap-2 border-b px-2 py-2 text-left transition-colors hover:bg-muted/30"
                  aria-label="Back to folders"
                >
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate text-base font-medium">{activeFolderLabel}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {activeFolderEntries.length}
                  </span>
                </button>

                {activeFolderEntries.length === 0 ? (
                  <SurfaceCard
                    tone="dashed"
                    className="m-2 text-sm text-muted-foreground shadow-none"
                  >
                    No entries in this folder yet.
                  </SurfaceCard>
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
              </SurfaceCard>
            ) : (
              <SurfaceCard padding="none" className="overflow-hidden rounded-md shadow-none">
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
                        className="flex w-full items-center gap-2 border-b px-2 py-3 text-left transition-colors hover:bg-muted/30 last:border-b-0"
                      >
                        <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate text-base font-medium">{displayName}</span>
                        <span className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{entries.length}</span>
                        </span>
                      </button>
                    )
                  })}
              </SurfaceCard>
            )}
          </div>
        ) : (
          <div className="border-t">
            {flatEntries.length === 0 ? (
              <SurfaceCard tone="dashed" className="m-2 text-sm text-muted-foreground shadow-none">
                No lorebook entries match the current view.
              </SurfaceCard>
            ) : (
              flatEntries.map((entry) => (
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
