'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { BookOpen } from 'lucide-react'
import Button from '@/app/dashboard/components/Button'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import type { LorebookEntry } from '@/types/risuai.types'
import { LorebookPanelContent } from './components'
import { setLorebookEntryOverride } from './lorebook-actions'
import type { LorebookFilter, LorebookOverrideMode } from './utils/lorebook-panel'
import { getEntryModuleId, getOverrideMapKey, getOverrideMode } from './utils/lorebook-panel'

interface LorebookPanelProps {
  lorebookEntries: LorebookEntry[]
  chatId: string
  overrideMap: Map<string, boolean>
}

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

  const setEntryOverride = async (entry: LorebookEntry, mode: LorebookOverrideMode) => {
    const mapKey = getOverrideMapKey(entry)
    const previousMode = getOverrideMode(entry, localOverrideMap)
    const previousValue = localOverrideMap.get(mapKey)

    const moduleId = getEntryModuleId(entry)
    if (!moduleId) {
      return 'Missing module id for this entry'
    }

    setLocalOverrideMap((previousMap) => {
      const nextMap = new Map(previousMap)
      if (mode === 'auto') {
        nextMap.delete(mapKey)
      } else {
        nextMap.set(mapKey, mode === 'pinned')
      }
      return nextMap
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
        setLocalOverrideMap((previousMap) => {
          const nextMap = new Map(previousMap)
          if (previousMode === 'auto') {
            nextMap.delete(mapKey)
          } else {
            nextMap.set(mapKey, previousValue ?? false)
          }
          return nextMap
        })
        return result.error
      }
    } catch (error) {
      console.error('[Lorebook Override] Failed to set:', error)
      setLocalOverrideMap((previousMap) => {
        const nextMap = new Map(previousMap)
        if (previousMode === 'auto') {
          nextMap.delete(mapKey)
        } else {
          nextMap.set(mapKey, previousValue ?? false)
        }
        return nextMap
      })
      return 'Failed to save preference'
    }

    return null
  }

  const totalEntries = lorebookEntries.filter((entry) => entry.mode !== 'folder').length
  const alwaysActiveCount = lorebookEntries.filter((entry) => entry.alwaysActive).length

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const isMatch = (entry: LorebookEntry) => {
      if (entry.mode === 'folder') {
        return false
      }

      const mapKey = getOverrideMapKey(entry)
      const hasOverride = localOverrideMap.has(mapKey)
      const overrideEnabled = hasOverride ? localOverrideMap.get(mapKey) : undefined

      if (filter === 'always' && !entry.alwaysActive) return false
      if (filter === 'keyword' && entry.alwaysActive) return false
      if (filter === 'pinned' && !(hasOverride && overrideEnabled === true)) return false
      if (filter === 'disabled' && !(hasOverride && overrideEnabled === false)) return false

      if (!query) {
        return true
      }

      const haystack =
        `${entry.comment ?? ''}\n${entry.key ?? ''}\n${entry.content ?? ''}`.toLowerCase()
      return haystack.includes(query)
    }

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
      if (folderMap.has(folderKey)) {
        return
      }
      folderMap.set(folderKey, [])
      folderOrder.push(folderKey)
    }

    ensureFolder('__root__')

    for (const entry of filteredEntries) {
      const folderKey = entry.folder && folderMeta.has(entry.folder) ? entry.folder : '__root__'
      ensureFolder(folderKey)
      folderMap.get(folderKey)?.push(entry)
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
        className={`relative hidden h-full flex-shrink-0 transition-[width] duration-300 lg:block ${
          isDesktopOpen ? 'w-80' : 'w-12'
        }`}
      >
        {!isDesktopOpen ? (
          <Button
            onClick={() => setIsDesktopOpen(true)}
            variant="secondary"
            size="icon"
            className="absolute left-0 top-4 rounded-l-none rounded-r-lg border-l-0 bg-background shadow-none"
            title="Open lorebook"
            aria-label="Open lorebook"
          >
            <BookOpen className="h-5 w-5 text-muted-foreground" />
          </Button>
        ) : (
          <LorebookPanelContent
            {...panelContentProps}
            onClose={() => setIsDesktopOpen(false)}
            className="border-l"
          />
        )}
      </div>

      {!isMobileOpen ? (
        <Button
          onClick={() => setIsMobileOpen(true)}
          variant="primary"
          size="icon"
          className="fixed left-4 top-28 z-40 h-12 w-12 rounded-full shadow-lg lg:hidden"
          aria-label="Open lorebook"
          title="Open lorebook"
        >
          <BookOpen className="h-5 w-5" />
        </Button>
      ) : null}

      {isMobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsMobileOpen(false)} />
          <SurfaceCard
            padding="none"
            className="absolute bottom-0 left-0 top-0 w-80 max-w-[90vw] overflow-hidden rounded-none border-r border-b-0 border-l-0 border-t-0 bg-background shadow-xl dark:border-gray-700"
          >
            <LorebookPanelContent
              {...panelContentProps}
              onClose={() => setIsMobileOpen(false)}
              className="h-full border-l-0"
            />
          </SurfaceCard>
        </div>
      ) : null}
    </>
  )
}
