'use client'

import React from 'react'
import { useMemo, useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import EmptyState from '@/app/dashboard/components/EmptyState'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { CHAT_CONTEXT_WINDOW } from '@/lib/chat-context-window'
import type { ChatMemoryConfig } from '@/lib/chat/model-config'
import { CHUNK_SIZE, SUMMARY_LEVEL_META } from '@/lib/chat-summaries/config'
import { selectPrefixPromptSummaries } from '@/lib/chat-memory/prefix-summary-selection'
import { FactMemorySection, SummaryMemorySection } from './components'
import { useChatSummariesState } from './hooks'
import type { FactEntry, SummaryEntry } from './hooks/useChatSummariesState'
import { resolveVisibleSummaryWarning, type SummaryWarningInfo } from './summary-warning'
import { buildSummaryPromptStatuses } from './summary-structure'

interface ChatSummariesPanelProps {
  chatId: string
  summaries: SummaryEntry[]
  facts: FactEntry[]
  totalMessages: number
  latestSequence: number
  memoryConfig: Required<ChatMemoryConfig>
  summaryWarning?: SummaryWarningInfo | null
}

function formatMessageCountLabel(count: number): string {
  return `${count} message${count === 1 ? '' : 's'}`
}

export function getMemoryModeLabel(memoryConfig: Required<ChatMemoryConfig>): string {
  return memoryConfig.mode === 'summary_window' ? 'Summary Window' : 'Prefix'
}

export function getMemoryDescription(memoryConfig: Required<ChatMemoryConfig>): string {
  if (memoryConfig.mode === 'summary_window') {
    return `Summary Window mode keeps the most recent ${CHAT_CONTEXT_WINDOW} messages raw and summarizes older conversation in ${CHUNK_SIZE}-message chunks. Updates are generated automatically and may appear with a short delay.`
  }

  return `Prefix mode keeps the latest ${formatMessageCountLabel(memoryConfig.retainTailMessages)} raw while generating canonical ${CHUNK_SIZE}-message memory chunks from the sealed prefix. Higher-level ${CHUNK_SIZE * 10}-message recaps appear after enough canonical chunks accumulate. Updates are generated automatically and may appear with a short delay.`
}

function getArtifactRawTail(memoryConfig: Required<ChatMemoryConfig>): number {
  return memoryConfig.mode === 'summary_window' ? CHUNK_SIZE : memoryConfig.retainTailMessages
}

export function getNextMemoryCheckpoint(
  messageCount: number,
  memoryConfig: Required<ChatMemoryConfig>,
): number {
  const rawTail = getArtifactRawTail(memoryConfig)
  const effectiveSealedThrough = Math.max(0, messageCount - rawTail)
  const nextChunkEnd = (Math.floor(effectiveSealedThrough / CHUNK_SIZE) + 1) * CHUNK_SIZE
  return rawTail + nextChunkEnd
}

export function getEmptyStateText(memoryConfig: Required<ChatMemoryConfig>): string {
  if (memoryConfig.mode === 'summary_window') {
    return `No memory summaries yet. This mode starts generating them after ${formatMessageCountLabel(CHUNK_SIZE * 2)}.`
  }

  return `No sealed memory blocks yet. This mode starts generating canonical chunks after ${formatMessageCountLabel(memoryConfig.retainTailMessages + CHUNK_SIZE)} while keeping the latest ${formatMessageCountLabel(memoryConfig.retainTailMessages)} raw.`
}

function formatSummaryWarningTimestamp(value: string | null): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatFallbackSummaryNotice(summaries: SummaryEntry[]): string | null {
  const fallbackSummaries = summaries
    .filter((summary) => summary.summary_status === 'fallback')
    .sort((a, b) => a.level - b.level || a.start_seq - b.start_seq)

  if (fallbackSummaries.length === 0) {
    return null
  }

  const displayedRanges = fallbackSummaries
    .slice(0, 3)
    .map((summary) => `${summary.start_seq}-${summary.end_seq}`)
  const remainingCount = fallbackSummaries.length - displayedRanges.length
  const remainingLabel = remainingCount > 0 ? `, +${remainingCount} more` : ''

  return `${fallbackSummaries.length} (${displayedRanges.join(', ')}${remainingLabel})`
}

export default function ChatSummariesPanel({
  chatId,
  summaries: initialSummaries,
  facts: initialFacts,
  totalMessages,
  latestSequence,
  memoryConfig,
  summaryWarning = null,
}: ChatSummariesPanelProps) {
  const {
    summaries,
    facts,
    messageCount,
    editingSummaryId,
    summaryEditContent,
    setSummaryEditContent,
    editingFactId,
    factEditContent,
    setFactEditContent,
    reembeddingFactId,
    regeneratingSummaryId,
    regeneratingFactId,
    isRefreshingStats,
    refreshStats,
    startSummaryEdit,
    cancelSummaryEdit,
    saveSummaryEdit,
    startFactEdit,
    cancelFactEdit,
    saveFactEdit,
    handleReembedFact,
    handleRegenerateSummary,
    handleRegenerateFacts,
    handleDeleteSummary,
  } = useChatSummariesState({
    chatId,
    initialSummaries,
    initialFacts,
    totalMessages,
    latestSequence,
  })

  // Collapse states for each section
  const [isSuperMetaCollapsed, setIsSuperMetaCollapsed] = useState(true)
  const [isMetaCollapsed, setIsMetaCollapsed] = useState(true)
  const [isChunkCollapsed, setIsChunkCollapsed] = useState(true)
  const [isFactsCollapsed, setIsFactsCollapsed] = useState(true)
  const [pendingDeleteSummaryId, setPendingDeleteSummaryId] = useState<string | null>(null)

  const chunkSummaries = useMemo(
    () =>
      summaries.filter((summary) => summary.level === 0).sort((a, b) => a.start_seq - b.start_seq),
    [summaries],
  )

  const promptStatuses = useMemo(() => {
    if (memoryConfig.mode !== 'prefix_live_blocks') {
      return undefined
    }

    const visibleSummaryEnd = summaries.reduce(
      (latestEnd, summary) =>
        summary.level === SUMMARY_LEVEL_META ? Math.max(latestEnd, summary.end_seq) : latestEnd,
      0,
    )

    const promptSummaryIds = new Set(
      selectPrefixPromptSummaries(summaries, visibleSummaryEnd).map((summary) => summary.id),
    )

    return buildSummaryPromptStatuses(summaries, promptSummaryIds)
  }, [memoryConfig.mode, summaries])

  // Disable super meta summaries from context preview
  const superMetaSummaries = useMemo((): SummaryEntry[] => {
    return []
  }, [])

  const metaSummaries = useMemo(
    () =>
      summaries.filter((summary) => summary.level === 1).sort((a, b) => a.start_seq - b.start_seq),
    [summaries],
  )

  const hasSummaries =
    superMetaSummaries.length > 0 || metaSummaries.length > 0 || chunkSummaries.length > 0
  const hasMemoryEntries = hasSummaries || facts.length > 0
  const modeLabel = getMemoryModeLabel(memoryConfig)
  const memoryDescription = getMemoryDescription(memoryConfig)
  const nextCheckpoint = getNextMemoryCheckpoint(messageCount, memoryConfig)
  const emptyStateText = getEmptyStateText(memoryConfig)
  const visibleSummaryWarning = useMemo(
    () => resolveVisibleSummaryWarning(summaryWarning, [...summaries, ...facts]),
    [facts, summaries, summaryWarning],
  )
  const fallbackSummaryNotice = useMemo(() => formatFallbackSummaryNotice(summaries), [summaries])
  const summaryWarningTimestamp = formatSummaryWarningTimestamp(
    visibleSummaryWarning?.timestamp ?? null,
  )
  const pendingDeleteSummary =
    summaries.find((summary) => summary.id === pendingDeleteSummaryId) ?? null

  async function confirmDeleteSummary() {
    const targetId = pendingDeleteSummaryId
    setPendingDeleteSummaryId(null)
    await runConfirmedAction(targetId, handleDeleteSummary)
  }

  return (
    <aside className="h-full w-full border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 flex-shrink-0">
      <div className="h-full overflow-y-auto p-4 lg:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Long-term Memory</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{memoryDescription}</p>
        </div>

        {visibleSummaryWarning ? (
          <SurfaceCard
            tone="subtle"
            className="mb-4 border-amber-200 text-sm dark:border-amber-700"
          >
            <div className="space-y-2">
              <div className="font-medium text-amber-900 dark:text-amber-100">
                Background memory update failed for the latest assistant response.
              </div>
              <div className="text-amber-800 dark:text-amber-200">
                Send another chat message to let the next background memory update retry, then
                refresh this panel. No automatic retry was started.
              </div>
              {visibleSummaryWarning.error ? (
                <div className="text-xs text-amber-800/90 dark:text-amber-200/90">
                  Last error: <span className="font-medium">{visibleSummaryWarning.error}</span>
                </div>
              ) : null}
              {visibleSummaryWarning.attempts !== null || summaryWarningTimestamp ? (
                <div className="text-xs text-amber-800/90 dark:text-amber-200/90">
                  {visibleSummaryWarning.attempts !== null
                    ? `Attempts: ${visibleSummaryWarning.attempts}`
                    : null}
                  {visibleSummaryWarning.attempts !== null && summaryWarningTimestamp
                    ? ' · '
                    : null}
                  {summaryWarningTimestamp ? `Recorded: ${summaryWarningTimestamp}` : null}
                </div>
              ) : null}
            </div>
          </SurfaceCard>
        ) : null}

        <SurfaceCard tone="subtle" className="mb-6 text-sm text-gray-600 dark:text-gray-300">
          <div className="flex items-center justify-between">
            <div>
              <p>
                Total messages: <span className="font-medium">{messageCount}</span>
              </p>
              <p className="mt-1">
                Current mode: <span className="font-medium">{modeLabel}</span>
              </p>
              <p className="mt-1">
                Next memory checkpoint: <span className="font-medium">{nextCheckpoint}</span>{' '}
                messages
              </p>
              {fallbackSummaryNotice ? (
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  <span className="font-medium">Fallback summaries:</span> {fallbackSummaryNotice}
                </p>
              ) : null}
            </div>
            <Button
              onClick={() => void refreshStats()}
              disabled={isRefreshingStats}
              variant="secondary"
              size="sm"
              title="Refresh memory panel"
            >
              {isRefreshingStats ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              )}
            </Button>
          </div>
        </SurfaceCard>

        {!hasMemoryEntries && (
          <EmptyState compact title="No long-term memory yet" description={emptyStateText} />
        )}

        <SummaryMemorySection
          title="Super Meta Summary"
          summaries={superMetaSummaries}
          collapsed={isSuperMetaCollapsed}
          onToggle={() => setIsSuperMetaCollapsed((current) => !current)}
          description={
            <p>
              Top-level record compressing 4 meta summaries. Quickly grasp key points even from
              thousands of messages.
            </p>
          }
          className="space-y-4"
          regenerateButtonClassName="text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
          editorRows={5}
          editingSummaryId={editingSummaryId}
          summaryEditContent={summaryEditContent}
          onChangeSummaryEditContent={setSummaryEditContent}
          regeneratingSummaryId={regeneratingSummaryId}
          onStartEdit={startSummaryEdit}
          onSaveEdit={(summaryId) => void saveSummaryEdit(summaryId)}
          onCancelEdit={cancelSummaryEdit}
          onRegenerate={(summaryId) => void handleRegenerateSummary(summaryId)}
          onDelete={setPendingDeleteSummaryId}
          promptStatuses={promptStatuses}
        />

        <SummaryMemorySection
          title="Meta Summary"
          summaries={metaSummaries}
          collapsed={isMetaCollapsed}
          onToggle={() => setIsMetaCollapsed((current) => !current)}
          className="mt-6 space-y-4"
          listClassName="space-y-4"
          cardClassName="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          regenerateButtonClassName="text-purple-600 hover:text-purple-700 dark:text-purple-300 disabled:opacity-50"
          editorRows={5}
          editingSummaryId={editingSummaryId}
          summaryEditContent={summaryEditContent}
          onChangeSummaryEditContent={setSummaryEditContent}
          regeneratingSummaryId={regeneratingSummaryId}
          onStartEdit={startSummaryEdit}
          onSaveEdit={(summaryId) => void saveSummaryEdit(summaryId)}
          onCancelEdit={cancelSummaryEdit}
          onRegenerate={(summaryId) => void handleRegenerateSummary(summaryId)}
          onDelete={setPendingDeleteSummaryId}
          promptStatuses={promptStatuses}
        />

        <SummaryMemorySection
          title="Chunk Summary"
          summaries={chunkSummaries}
          collapsed={isChunkCollapsed}
          onToggle={() => setIsChunkCollapsed((current) => !current)}
          className="mt-8 space-y-4"
          regenerateButtonClassName="text-purple-600 hover:text-purple-700 dark:text-purple-300 disabled:opacity-50"
          editorRows={4}
          editingSummaryId={editingSummaryId}
          summaryEditContent={summaryEditContent}
          onChangeSummaryEditContent={setSummaryEditContent}
          regeneratingSummaryId={regeneratingSummaryId}
          onStartEdit={startSummaryEdit}
          onSaveEdit={(summaryId) => void saveSummaryEdit(summaryId)}
          onCancelEdit={cancelSummaryEdit}
          onRegenerate={(summaryId) => void handleRegenerateSummary(summaryId)}
          onDelete={setPendingDeleteSummaryId}
          promptStatuses={promptStatuses}
        />

        <FactMemorySection
          facts={facts}
          collapsed={isFactsCollapsed}
          onToggle={() => setIsFactsCollapsed((current) => !current)}
          editingFactId={editingFactId}
          factEditContent={factEditContent}
          onChangeFactEditContent={setFactEditContent}
          regeneratingFactId={regeneratingFactId}
          reembeddingFactId={reembeddingFactId}
          onStartEdit={startFactEdit}
          onSaveEdit={(factId) => void saveFactEdit(factId)}
          onCancelEdit={cancelFactEdit}
          onRegenerate={(factId) => void handleRegenerateFacts(factId)}
          onReembed={(factId) => void handleReembedFact(factId)}
        />

        <ConfirmDialog
          isOpen={pendingDeleteSummary !== null}
          title="Delete summary?"
          description={
            pendingDeleteSummary
              ? `This removes the summary for messages ${pendingDeleteSummary.start_seq}-${pendingDeleteSummary.end_seq}.`
              : undefined
          }
          confirmLabel="Delete summary"
          onConfirm={() => void confirmDeleteSummary()}
          onClose={() => setPendingDeleteSummaryId(null)}
        />
      </div>
    </aside>
  )
}
