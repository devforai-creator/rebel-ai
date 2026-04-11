'use client'

import React, { useMemo, useState } from 'react'
import { Ban, CircleDashed, KeyRound, Pin } from 'lucide-react'
import type { LorebookEntry } from '@/types/risuai.types'
import type { LorebookOverrideMode } from '../utils/lorebook-panel'
import {
  formatKeywordPreview,
  getActivationStatus,
  getOverrideMode,
  stripMarkdownForPreview,
} from '../utils/lorebook-panel'

function OverrideBadge({ mode }: { mode: LorebookOverrideMode }) {
  if (mode === 'pinned') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
        <Pin className="h-3 w-3" />
        Forced on
      </span>
    )
  }
  if (mode === 'disabled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] text-red-800 dark:bg-red-900/40 dark:text-red-200">
        <Ban className="h-3 w-3" />
        Forced off
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <CircleDashed className="h-3 w-3" />
      Default
    </span>
  )
}

type LorebookEntryRowProps = {
  entry: LorebookEntry
  overrideMap: Map<string, boolean>
  showPreview: boolean
  setEntryOverride: (entry: LorebookEntry, mode: LorebookOverrideMode) => Promise<string | null>
  isExpanded: boolean
  onToggleExpand: () => void
}

export function LorebookEntryRow({
  entry,
  overrideMap,
  showPreview,
  setEntryOverride,
  isExpanded,
  onToggleExpand,
}: LorebookEntryRowProps) {
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
      if (error) {
        setErrorMessage(error)
      }
    } catch (error) {
      console.error('[Lorebook Override] Failed to cycle:', error)
      setErrorMessage('Failed to save preference')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-start gap-2 px-2 py-2 transition-colors hover:bg-muted/30">
        <span
          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${activation.color}`}
          title={activation.label}
          aria-label={activation.label}
        />
        <button
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-label={`Open lorebook entry ${label}`}
          aria-expanded={isExpanded}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-base font-medium">{label}</span>
            </div>
          </div>
        </button>

        <div className="flex flex-col items-end gap-1 pt-0.5">
          <button
            onClick={(event) => {
              event.stopPropagation()
              void cycleOverride()
            }}
            disabled={isSaving}
            className="rounded-md px-1 py-0.5 hover:bg-muted disabled:opacity-50"
            title="Cycle override: Default → Forced on → Forced off"
            aria-label="Cycle lorebook override"
          >
            <OverrideBadge mode={mode} />
          </button>
        </div>
      </div>

      {errorMessage ? <div className="px-2 pb-2 text-xs text-red-600">{errorMessage}</div> : null}

      {isExpanded ? (
        <div className="px-2 pb-2">
          <div className="rounded-md border bg-background/60 p-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />
              <span className="font-medium">Keywords</span>
              <span>({keywordPreview.shown.length + keywordPreview.hiddenCount})</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {keywordPreview.shown.map((keyword) => (
                <span
                  key={keyword}
                  className="max-w-[12rem] truncate rounded border border-blue-200/70 bg-blue-50/80 px-2 py-1 text-[12px] text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100"
                >
                  {keyword}
                </span>
              ))}
              {keywordPreview.hiddenCount > 0 ? (
                <span className="rounded border border-blue-200/70 bg-blue-50/80 px-2 py-1 text-[12px] text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
                  +{keywordPreview.hiddenCount}
                </span>
              ) : null}
            </div>
            {showPreview && previewText ? (
              <div className="mt-2 text-xs leading-4 text-muted-foreground">{previewText}</div>
            ) : null}
            <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-4">
              {entry.content}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
