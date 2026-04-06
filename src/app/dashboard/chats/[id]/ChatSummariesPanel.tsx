'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { CHAT_CONTEXT_WINDOW } from '@/lib/chat-context-window'
import type { ChatSummary, ChatFacts } from '@/types/database.types'
import {
  deleteSummary,
  updateSummary,
  updateFact,
  reembedFact,
  regenerateSummary,
  regenerateFacts,
} from './summary-actions'

interface ChatSummariesPanelProps {
  chatId: string
  summaries: Array<
    Pick<ChatSummary, 'id' | 'level' | 'start_seq' | 'end_seq' | 'summary' | 'created_at'>
  >
  facts: Array<Pick<ChatFacts, 'id' | 'start_seq' | 'end_seq' | 'facts' | 'created_at'>>
  totalMessages: number
  latestSequence: number
}

type SummaryType = ChatSummariesPanelProps['summaries'][number]
type FactType = ChatSummariesPanelProps['facts'][number]

const LEVEL_LABEL: Record<number, string> = {
  2: 'Super Meta Summary',
  1: 'Meta Summary',
  0: 'Chunk Summary',
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
}: ChatSummariesPanelProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  // Local state for summaries, facts, and message count (updated in real-time)
  const [summaries, setSummaries] = useState<SummaryType[]>(initialSummaries)
  const [facts, setFacts] = useState<FactType[]>(initialFacts)
  const [messageCount, setMessageCount] = useState(totalMessages)
  const [currentLatestSequence, setCurrentLatestSequence] = useState(latestSequence)
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null)
  const [summaryEditContent, setSummaryEditContent] = useState('')
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [factEditContent, setFactEditContent] = useState('')
  const [reembeddingFactId, setReembeddingFactId] = useState<string | null>(null)
  const [regeneratingSummaryId, setRegeneratingSummaryId] = useState<string | null>(null)
  const [regeneratingFactId, setRegeneratingFactId] = useState<string | null>(null)

  // Collapse states for each section
  const [isSuperMetaCollapsed, setIsSuperMetaCollapsed] = useState(false)
  const [isMetaCollapsed, setIsMetaCollapsed] = useState(false)
  const [isChunkCollapsed, setIsChunkCollapsed] = useState(false)
  const [isFactsCollapsed, setIsFactsCollapsed] = useState(false)

  // Stats refresh state
  const [isRefreshingStats, setIsRefreshingStats] = useState(false)

  // Fetch message/summary counts on demand
  const refreshStats = useCallback(async () => {
    setIsRefreshingStats(true)
    try {
      const response = await fetch(`/api/chats/${chatId}/stats`, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error('Failed to fetch stats')
      }
      const data = await response.json()
      if (typeof data.messageCount === 'number') {
        setMessageCount(data.messageCount)
      }
      if (typeof data.summaryCount === 'number') {
        // Check if count changed and schedule router refresh outside render cycle
        setSummaries((prev) => {
          if (Math.abs(prev.length - data.summaryCount) > 0) {
            // Defer router.refresh() to avoid setState-during-render warning
            setTimeout(() => router.refresh(), 0)
          }
          return prev
        })
      }
    } catch {
      toast.error('통계를 불러오지 못했습니다')
    } finally {
      setIsRefreshingStats(false)
    }
  }, [chatId, router])

  // Keep local state in sync when server data refreshes (router.refresh or navigation)
  useEffect(() => {
    setSummaries(initialSummaries)
  }, [initialSummaries])

  useEffect(() => {
    setFacts(initialFacts)
  }, [initialFacts])

  useEffect(() => {
    setMessageCount(totalMessages)
  }, [totalMessages])

  useEffect(() => {
    setCurrentLatestSequence(latestSequence)
  }, [latestSequence])

  // Subscribe to real-time updates
  useEffect(() => {
    // Get current session for auth token (required for RLS to work with Realtime)
    const setupChannel = async () => {
      await supabase.auth.getSession()

      const channel = supabase
        .channel(`chat-${chatId}-summaries`, {
          config: {
            broadcast: { self: true },
            presence: { key: '' },
          },
        })
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'chat_summaries',
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              // Add new summary
              setSummaries((prev) => {
                // Avoid duplicates
                if (prev.some((s) => s.id === payload.new.id)) {
                  return prev
                }
                return [...prev, payload.new as SummaryType]
              })
            } else if (payload.eventType === 'UPDATE') {
              // Update existing summary
              setSummaries((prev) =>
                prev.map((s) => (s.id === payload.new.id ? (payload.new as SummaryType) : s)),
              )
            } else if (payload.eventType === 'DELETE') {
              // Remove deleted summary
              setSummaries((prev) => prev.filter((s) => s.id !== payload.old.id))
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'chat_facts',
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              // Add new facts
              setFacts((prev) => {
                // Avoid duplicates
                if (prev.some((f) => f.id === payload.new.id)) {
                  return prev
                }
                return [...prev, payload.new as FactType]
              })
            } else if (payload.eventType === 'UPDATE') {
              // Update existing facts
              setFacts((prev) =>
                prev.map((f) => (f.id === payload.new.id ? (payload.new as FactType) : f)),
              )
            } else if (payload.eventType === 'DELETE') {
              // Remove deleted facts
              setFacts((prev) => prev.filter((f) => f.id !== payload.old.id))
            }
          },
        )
        .subscribe()

      return channel
    }

    let channelInstance: ReturnType<typeof supabase.channel> | null = null

    setupChannel().then((channel) => {
      channelInstance = channel
    })

    return () => {
      if (channelInstance) {
        supabase.removeChannel(channelInstance)
      }
    }
  }, [chatId, supabase])

  const chunkSummaries = useMemo(
    () =>
      summaries.filter((summary) => summary.level === 0).sort((a, b) => a.start_seq - b.start_seq),
    [summaries],
  )

  const summaryCutoff = useMemo(
    () => Math.max(currentLatestSequence - CHAT_CONTEXT_WINDOW, 0),
    [currentLatestSequence],
  )

  // Disable super meta summaries from context preview
  const superMetaSummaries = useMemo((): SummaryType[] => {
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
  const nextThreshold = messageCount < 20 ? 20 : Math.floor(messageCount / 10) * 10 + 10

  const startSummaryEdit = (summaryId: string, currentSummary: string) => {
    setEditingFactId(null)
    setFactEditContent('')
    setEditingSummaryId(summaryId)
    setSummaryEditContent(currentSummary)
  }

  const cancelSummaryEdit = () => {
    setEditingSummaryId(null)
    setSummaryEditContent('')
  }

  const saveSummaryEdit = async (summaryId: string) => {
    if (!summaryEditContent.trim()) {
      alert('Please enter summary content.')
      return
    }

    const result = await updateSummary(summaryId, chatId, summaryEditContent)

    if (result.error) {
      alert('Failed to update summary: ' + result.error)
      return
    }

    setEditingSummaryId(null)
    setSummaryEditContent('')
    router.refresh() // Refresh server component data
  }

  const startFactEdit = (factId: string, currentFacts: string) => {
    setEditingSummaryId(null)
    setSummaryEditContent('')
    setEditingFactId(factId)
    setFactEditContent(currentFacts)
  }

  const cancelFactEdit = () => {
    setEditingFactId(null)
    setFactEditContent('')
  }

  const saveFactEdit = async (factId: string) => {
    if (!factEditContent.trim()) {
      alert('Please enter content.')
      return
    }

    const result = await updateFact(factId, chatId, factEditContent)

    if (result.error) {
      alert(result.error)
      return
    }

    setEditingFactId(null)
    setFactEditContent('')
    router.refresh()
  }

  const handleReembedFact = async (factId: string) => {
    setReembeddingFactId(factId)
    const result = await reembedFact(factId, chatId)
    setReembeddingFactId(null)

    if (result?.error) {
      alert(result.error)
      return
    }

    router.refresh()
  }

  const handleRegenerateSummary = async (summaryId: string) => {
    setRegeneratingSummaryId(summaryId)
    const result = await regenerateSummary(summaryId, chatId)
    setRegeneratingSummaryId(null)

    if (result?.error) {
      alert(result.error)
      return
    }

    router.refresh()
  }

  const handleRegenerateFacts = async (factId: string) => {
    setRegeneratingFactId(factId)
    const result = await regenerateFacts(factId, chatId)
    setRegeneratingFactId(null)

    if (result?.error) {
      alert(result.error)
      return
    }

    router.refresh()
  }

  // Delete summary
  const handleDelete = async (summaryId: string) => {
    if (!confirm('Delete this summary?')) {
      return
    }

    const result = await deleteSummary(summaryId, chatId)
    if (result.error) {
      alert('Failed to delete summary: ' + result.error)
      return
    }

    router.refresh() // Refresh server component data
  }

  return (
    <aside className="h-full w-full border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 flex-shrink-0">
      <div className="h-full overflow-y-auto p-4 lg:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Long-term Memory Summary
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Recent 20 messages are kept as-is, while earlier conversations are summarized in groups
            of 10. Summaries are generated automatically, with a slight delay possible.
          </p>
        </div>

        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          <div className="flex items-center justify-between">
            <div>
              <p>
                Total messages: <span className="font-medium">{messageCount}</span>
              </p>
              <p className="mt-1">
                Next summary at: <span className="font-medium">{nextThreshold}</span> messages
              </p>
            </div>
            <button
              onClick={refreshStats}
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

        {!hasSummaries && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
            No summaries generated yet. Summaries will be created automatically after 20+ messages.
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
                              onClick={() => void handleDelete(summary.id)}
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
                              onClick={() => void handleDelete(summary.id)}
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
                              onClick={() => void handleDelete(summary.id)}
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
