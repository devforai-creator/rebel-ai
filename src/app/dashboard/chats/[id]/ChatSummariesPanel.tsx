'use client'

import { useMemo, useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import EmptyState from '@/app/dashboard/components/EmptyState'
import { runConfirmedAction } from '@/app/dashboard/components/confirm-action'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { CHAT_CONTEXT_WINDOW } from '@/lib/chat-context-window'
import type { ChatMemoryConfig } from '@/lib/chat/model-config'
import { CHUNK_SIZE } from '@/lib/chat-summaries/config'
import { FactMemorySection, SummaryMemorySection } from './components'
import { useChatSummariesState } from './hooks'
import type { FactEntry, SummaryEntry } from './hooks/useChatSummariesState'

interface ChatSummariesPanelProps {
  chatId: string
  summaries: SummaryEntry[]
  facts: FactEntry[]
  totalMessages: number
  latestSequence: number
  memoryConfig: Required<ChatMemoryConfig>
}

function formatMessageCountLabel(count: number): string {
  return `${count} message${count === 1 ? '' : 's'}`
}

function getMemoryModeLabel(memoryConfig: Required<ChatMemoryConfig>): string {
  return memoryConfig.mode === 'summary_window' ? 'Summary Window' : 'Prefix'
}

function getMemoryDescription(memoryConfig: Required<ChatMemoryConfig>): string {
  if (memoryConfig.mode === 'summary_window') {
    return `Summary Window mode keeps the most recent ${CHAT_CONTEXT_WINDOW} messages raw and summarizes older conversation in ${CHUNK_SIZE}-message chunks. Updates are generated automatically and may appear with a short delay.`
  }

  return `Prefix mode keeps the live conversation raw until ${formatMessageCountLabel(memoryConfig.sealEveryMessages)}, then seals older messages into memory while keeping the latest ${formatMessageCountLabel(memoryConfig.retainTailMessages)} raw. Updates are generated automatically and may appear with a short delay.`
}

function getNextMemoryCheckpoint(
  messageCount: number,
  memoryConfig: Required<ChatMemoryConfig>,
): number {
  if (memoryConfig.mode === 'summary_window') {
    const firstCheckpoint = CHUNK_SIZE * 2
    if (messageCount < firstCheckpoint) {
      return firstCheckpoint
    }

    return Math.floor(messageCount / CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE
  }

  if (messageCount < memoryConfig.sealEveryMessages) {
    return memoryConfig.sealEveryMessages
  }

  const sealedChunkSize = memoryConfig.sealEveryMessages - memoryConfig.retainTailMessages
  if (sealedChunkSize < 1) {
    return memoryConfig.sealEveryMessages
  }

  return (
    memoryConfig.retainTailMessages +
    (Math.floor((messageCount - memoryConfig.retainTailMessages) / sealedChunkSize) + 1) *
      sealedChunkSize
  )
}

function getEmptyStateText(memoryConfig: Required<ChatMemoryConfig>): string {
  if (memoryConfig.mode === 'summary_window') {
    return `No memory summaries yet. This mode starts generating them after ${formatMessageCountLabel(CHUNK_SIZE * 2)}.`
  }

  return `No sealed memory blocks yet. This mode starts sealing them after ${formatMessageCountLabel(memoryConfig.sealEveryMessages)}.`
}

export default function ChatSummariesPanel({
  chatId,
  summaries: initialSummaries,
  facts: initialFacts,
  totalMessages,
  latestSequence,
  memoryConfig,
}: ChatSummariesPanelProps) {
  const {
    summaries,
    facts,
    messageCount,
    currentLatestSequence,
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
  const [isSuperMetaCollapsed, setIsSuperMetaCollapsed] = useState(false)
  const [isMetaCollapsed, setIsMetaCollapsed] = useState(false)
  const [isChunkCollapsed, setIsChunkCollapsed] = useState(false)
  const [isFactsCollapsed, setIsFactsCollapsed] = useState(false)
  const [pendingDeleteSummaryId, setPendingDeleteSummaryId] = useState<string | null>(null)

  const chunkSummaries = useMemo(
    () =>
      summaries.filter((summary) => summary.level === 0).sort((a, b) => a.start_seq - b.start_seq),
    [summaries],
  )

  const rawMessageWindow = useMemo(
    () =>
      memoryConfig.mode === 'summary_window'
        ? CHAT_CONTEXT_WINDOW
        : memoryConfig.retainTailMessages,
    [memoryConfig.mode, memoryConfig.retainTailMessages],
  )

  const summaryCutoff = useMemo(
    () => Math.max(currentLatestSequence - rawMessageWindow, 0),
    [currentLatestSequence, rawMessageWindow],
  )

  // Disable super meta summaries from context preview
  const superMetaSummaries = useMemo((): SummaryEntry[] => {
    return []
  }, [])

  const metaSummaries = useMemo(() => {
    if (summaryCutoff <= 0) {
      return []
    }
    const filtered = summaries
      .filter((summary) => summary.level === 1 && summary.end_seq <= summaryCutoff)
      .sort((a, b) => a.start_seq - b.start_seq)

    if (superMetaSummaries.length === 0) {
      return filtered
    }

    return filtered.filter(
      (meta) =>
        !superMetaSummaries.some(
          (superMeta) => meta.start_seq >= superMeta.start_seq && meta.end_seq <= superMeta.end_seq,
        ),
    )
  }, [summaries, summaryCutoff, superMetaSummaries])

  const higherLevelCoverage = useMemo(() => {
    if (summaryCutoff <= 0) {
      return []
    }
    return [...superMetaSummaries, ...metaSummaries].map((summary) => ({
      start: summary.start_seq,
      end: summary.end_seq,
    }))
  }, [superMetaSummaries, metaSummaries, summaryCutoff])

  const visibleChunkSummaries = useMemo(() => {
    if (summaryCutoff <= 0) {
      return []
    }
    return chunkSummaries.filter(
      (chunk) =>
        chunk.end_seq <= summaryCutoff &&
        !higherLevelCoverage.some(
          (range) => chunk.start_seq >= range.start && chunk.end_seq <= range.end,
        ),
    )
  }, [chunkSummaries, higherLevelCoverage, summaryCutoff])

  const hasSummaries =
    superMetaSummaries.length > 0 || metaSummaries.length > 0 || visibleChunkSummaries.length > 0
  const hasMemoryEntries = hasSummaries || facts.length > 0
  const modeLabel = getMemoryModeLabel(memoryConfig)
  const memoryDescription = getMemoryDescription(memoryConfig)
  const nextCheckpoint = getNextMemoryCheckpoint(messageCount, memoryConfig)
  const emptyStateText = getEmptyStateText(memoryConfig)
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
            </div>
            <Button
              onClick={() => void refreshStats()}
              disabled={isRefreshingStats}
              variant="secondary"
              size="sm"
              title="Refresh stats"
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
        />

        <SummaryMemorySection
          title="Chunk Summary"
          summaries={visibleChunkSummaries}
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
