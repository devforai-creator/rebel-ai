'use client'

import { useMemo, useState } from 'react'
import { CHAT_CONTEXT_WINDOW } from '@/lib/chat-context-window'
import type { ChatMemoryConfig } from '@/lib/chat/model-config'
import { CHUNK_SIZE } from '@/lib/chat-summaries/config'
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

const LEVEL_LABEL: Record<number, string> = {
  2: 'Super Meta Summary',
  1: 'Meta Summary',
  0: 'Chunk Summary',
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

function formatTimestamp(value: string | null): string | null {
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

  return (
    <aside className="h-full w-full border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 flex-shrink-0">
      <div className="h-full overflow-y-auto p-4 lg:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Long-term Memory</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{memoryDescription}</p>
        </div>

        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
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
            <button
              onClick={() => void refreshStats()}
              disabled={isRefreshingStats}
              className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            </button>
          </div>
        </div>

        {!hasMemoryEntries && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {emptyStateText}
          </div>
        )}

        {superMetaSummaries.length > 0 && (
          <section className="space-y-4">
            <button
              onClick={() => setIsSuperMetaCollapsed(!isSuperMetaCollapsed)}
              className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
            >
              <span>Super Meta Summary ({superMetaSummaries.length})</span>
              <span className="text-lg">{isSuperMetaCollapsed ? '▶' : '▼'}</span>
            </button>
            {!isSuperMetaCollapsed && (
              <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400 mb-3">
                <p>
                  Top-level record compressing 4 meta summaries. Quickly grasp key points even from
                  thousands of messages.
                </p>
              </div>
            )}
            {!isSuperMetaCollapsed && (
              <ul className="space-y-3">
                {superMetaSummaries.map((summary) => {
                  const formattedTimestamp = formatTimestamp(summary.created_at)
                  const isEditing = editingSummaryId === summary.id

                  return (
                    <li
                      key={summary.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <div>
                          {LEVEL_LABEL[summary.level] ?? 'Summary'} · {summary.start_seq}-
                          {summary.end_seq}
                          {formattedTimestamp ? ` · ${formattedTimestamp}` : null}
                        </div>
                        {!isEditing && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => startSummaryEdit(summary.id, summary.summary)}
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => void handleRegenerateSummary(summary.id)}
                              disabled={regeneratingSummaryId === summary.id}
                              className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
                              title="Regenerate summary"
                            >
                              {regeneratingSummaryId === summary.id ? '⟳' : '♻️'}
                            </button>
                            <button
                              onClick={() => void handleDeleteSummary(summary.id)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400"
                              title="Delete"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={summaryEditContent}
                            onChange={(e) => setSummaryEditContent(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white resize-none"
                            rows={5}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void saveSummaryEdit(summary.id)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelSummaryEdit}
                              className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-line text-sm leading-5 text-gray-800 dark:text-gray-200">
                          {summary.summary}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {metaSummaries.length > 0 && (
          <section className="mt-6 space-y-4">
            <button
              onClick={() => setIsMetaCollapsed(!isMetaCollapsed)}
              className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
            >
              <span>Meta Summary ({metaSummaries.length})</span>
              <span className="text-lg">{isMetaCollapsed ? '▶' : '▼'}</span>
            </button>
            {!isMetaCollapsed && (
              <ul className="space-y-4">
                {metaSummaries.map((summary) => {
                  const formattedTimestamp = formatTimestamp(summary.created_at)
                  const isEditing = editingSummaryId === summary.id

                  return (
                    <li
                      key={summary.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <div>
                          {LEVEL_LABEL[summary.level] ?? 'Summary'} · {summary.start_seq}-
                          {summary.end_seq}
                          {formattedTimestamp ? ` · ${formattedTimestamp}` : null}
                        </div>
                        {!isEditing && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => startSummaryEdit(summary.id, summary.summary)}
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => void handleRegenerateSummary(summary.id)}
                              disabled={regeneratingSummaryId === summary.id}
                              className="text-purple-600 hover:text-purple-700 dark:text-purple-300 disabled:opacity-50"
                              title="Regenerate summary"
                            >
                              {regeneratingSummaryId === summary.id ? '⟳' : '♻️'}
                            </button>
                            <button
                              onClick={() => void handleDeleteSummary(summary.id)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400"
                              title="Delete"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={summaryEditContent}
                            onChange={(e) => setSummaryEditContent(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white resize-none"
                            rows={5}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void saveSummaryEdit(summary.id)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelSummaryEdit}
                              className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-line text-sm leading-5 text-gray-800 dark:text-gray-200">
                          {summary.summary}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {visibleChunkSummaries.length > 0 && (
          <section className="mt-8 space-y-4">
            <button
              onClick={() => setIsChunkCollapsed(!isChunkCollapsed)}
              className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
            >
              <span>Chunk Summary ({visibleChunkSummaries.length})</span>
              <span className="text-lg">{isChunkCollapsed ? '▶' : '▼'}</span>
            </button>
            {!isChunkCollapsed && (
              <ul className="space-y-3">
                {visibleChunkSummaries.map((summary) => {
                  const formattedTimestamp = formatTimestamp(summary.created_at)
                  const isEditing = editingSummaryId === summary.id

                  return (
                    <li
                      key={summary.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <div>
                          {LEVEL_LABEL[summary.level] ?? 'Summary'} · {summary.start_seq}-
                          {summary.end_seq}
                          {formattedTimestamp ? ` · ${formattedTimestamp}` : null}
                        </div>
                        {!isEditing && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => startSummaryEdit(summary.id, summary.summary)}
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => void handleRegenerateSummary(summary.id)}
                              disabled={regeneratingSummaryId === summary.id}
                              className="text-purple-600 hover:text-purple-700 dark:text-purple-300 disabled:opacity-50"
                              title="Regenerate summary"
                            >
                              {regeneratingSummaryId === summary.id ? '⟳' : '♻️'}
                            </button>
                            <button
                              onClick={() => void handleDeleteSummary(summary.id)}
                              className="text-red-600 hover:text-red-700 dark:text-red-400"
                              title="Delete"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={summaryEditContent}
                            onChange={(e) => setSummaryEditContent(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white resize-none"
                            rows={4}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void saveSummaryEdit(summary.id)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelSummaryEdit}
                              className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-line text-sm leading-5 text-gray-800 dark:text-gray-200">
                          {summary.summary}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {facts.length > 0 && (
          <section className="mt-8 space-y-4">
            <button
              onClick={() => setIsFactsCollapsed(!isFactsCollapsed)}
              className="flex w-full items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
            >
              <span>Episodic Memory ({facts.length})</span>
              <span className="text-lg">{isFactsCollapsed ? '▶' : '▼'}</span>
            </button>
            {!isFactsCollapsed && (
              <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400 mb-3">
                <p>
                  Specific facts extracted from conversations. Details like dates, places, food,
                  appointments are preserved.
                </p>
              </div>
            )}
            {!isFactsCollapsed && (
              <ul className="space-y-3">
                {facts.map((fact) => {
                  const formattedTimestamp = formatTimestamp(fact.created_at)
                  const isEditing = editingFactId === fact.id

                  return (
                    <li
                      key={fact.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <div>
                          Messages {fact.start_seq}-{fact.end_seq}
                          {formattedTimestamp ? ` · ${formattedTimestamp}` : null}
                        </div>
                        {!isEditing && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => startFactEdit(fact.id, fact.facts)}
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                              title="Edit"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => void handleRegenerateFacts(fact.id)}
                              disabled={regeneratingFactId === fact.id}
                              className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
                              title="Regenerate episodic memory"
                            >
                              {regeneratingFactId === fact.id ? '⟳' : '♻️'}
                            </button>
                            <button
                              onClick={() => void handleReembedFact(fact.id)}
                              disabled={reembeddingFactId === fact.id}
                              className="text-purple-600 hover:text-purple-700 dark:text-purple-300 disabled:opacity-50"
                              title="Regenerate embedding"
                            >
                              {reembeddingFactId === fact.id ? '⟳' : '🔄'}
                            </button>
                          </div>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={factEditContent}
                            onChange={(e) => setFactEditContent(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white resize-none"
                            rows={4}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void saveFactEdit(fact.id)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelFactEdit}
                              className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-line text-sm leading-5 text-gray-800 dark:text-gray-200">
                          {fact.facts}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
