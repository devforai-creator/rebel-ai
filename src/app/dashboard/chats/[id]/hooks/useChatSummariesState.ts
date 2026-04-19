import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { ChatFacts, ChatSummary } from '@/types/database.types'
import { createApiError } from '@/lib/http/api-contract'
import { createClient } from '@/lib/supabase/client'
import {
  deleteSummary,
  regenerateFacts,
  regenerateSummary,
  reembedFact,
  updateFact,
  updateSummary,
} from '../summary-actions'

export type SummaryEntry = Pick<
  ChatSummary,
  'id' | 'level' | 'start_seq' | 'end_seq' | 'summary' | 'created_at'
>

export type FactEntry = Pick<ChatFacts, 'id' | 'start_seq' | 'end_seq' | 'facts' | 'created_at'>

type RealtimeCollectionPayload<T extends { id: string }> =
  | {
      eventType: 'INSERT' | 'UPDATE'
      new: T
      old: Partial<Pick<T, 'id'>>
    }
  | {
      eventType: 'DELETE'
      old: Pick<T, 'id'>
    }

type StatsResponse = {
  messageCount?: number
  summaryCount?: number
}

type UseChatSummariesStateArgs = {
  chatId: string
  initialSummaries: SummaryEntry[]
  initialFacts: FactEntry[]
  totalMessages: number
  latestSequence: number
}

type UseChatSummariesStateReturn = {
  summaries: SummaryEntry[]
  facts: FactEntry[]
  messageCount: number
  currentLatestSequence: number
  editingSummaryId: string | null
  summaryEditContent: string
  setSummaryEditContent: Dispatch<SetStateAction<string>>
  editingFactId: string | null
  factEditContent: string
  setFactEditContent: Dispatch<SetStateAction<string>>
  reembeddingFactId: string | null
  regeneratingSummaryId: string | null
  regeneratingFactId: string | null
  isRefreshingStats: boolean
  refreshStats: () => Promise<void>
  startSummaryEdit: (summaryId: string, currentSummary: string) => void
  cancelSummaryEdit: () => void
  saveSummaryEdit: (summaryId: string) => Promise<void>
  startFactEdit: (factId: string, currentFacts: string) => void
  cancelFactEdit: () => void
  saveFactEdit: (factId: string) => Promise<void>
  handleReembedFact: (factId: string) => Promise<void>
  handleRegenerateSummary: (summaryId: string) => Promise<void>
  handleRegenerateFacts: (factId: string) => Promise<void>
  handleDeleteSummary: (summaryId: string) => Promise<void>
}

export function applyRealtimeCollectionChange<T extends { id: string }>(
  previousItems: T[],
  payload: RealtimeCollectionPayload<T>,
): T[] {
  if (payload.eventType === 'DELETE') {
    return previousItems.filter((item) => item.id !== payload.old.id)
  }

  if (payload.eventType === 'INSERT') {
    if (previousItems.some((item) => item.id === payload.new.id)) {
      return previousItems
    }

    return [...previousItems, payload.new]
  }

  if (payload.eventType === 'UPDATE') {
    return previousItems.map((item) => (item.id === payload.new.id ? payload.new : item))
  }

  return previousItems
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasStringId(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string'
}

function isSummaryEntry(value: unknown): value is SummaryEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.level === 'number' &&
    typeof value.start_seq === 'number' &&
    typeof value.end_seq === 'number' &&
    typeof value.summary === 'string' &&
    typeof value.created_at === 'string'
  )
}

function isFactEntry(value: unknown): value is FactEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.start_seq === 'number' &&
    typeof value.end_seq === 'number' &&
    typeof value.facts === 'string' &&
    typeof value.created_at === 'string'
  )
}

export function parseStatsResponse(value: unknown): StatsResponse | null {
  if (!isRecord(value)) {
    return null
  }

  const result: StatsResponse = {}

  if (typeof value.messageCount === 'number') {
    result.messageCount = value.messageCount
  }

  if (typeof value.summaryCount === 'number') {
    result.summaryCount = value.summaryCount
  }

  return result
}

export function parseRealtimeCollectionPayload<T extends { id: string }>(
  payload: unknown,
  isEntry: (value: unknown) => value is T,
): RealtimeCollectionPayload<T> | null {
  if (
    !isRecord(payload) ||
    !isRecord(payload.old) ||
    !('eventType' in payload) ||
    (payload.eventType !== 'INSERT' &&
      payload.eventType !== 'UPDATE' &&
      payload.eventType !== 'DELETE')
  ) {
    return null
  }

  if (payload.eventType === 'DELETE') {
    return hasStringId(payload.old)
      ? {
          eventType: 'DELETE',
          old: { id: payload.old.id },
        }
      : null
  }

  return isEntry(payload.new)
    ? {
        eventType: payload.eventType,
        new: payload.new,
        old: hasStringId(payload.old) ? { id: payload.old.id } : {},
      }
    : null
}

export function useChatSummariesState({
  chatId,
  initialSummaries,
  initialFacts,
  totalMessages,
  latestSequence,
}: UseChatSummariesStateArgs): UseChatSummariesStateReturn {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [summaries, setSummaries] = useState<SummaryEntry[]>(initialSummaries)
  const [facts, setFacts] = useState<FactEntry[]>(initialFacts)
  const [messageCount, setMessageCount] = useState(totalMessages)
  const [currentLatestSequence, setCurrentLatestSequence] = useState(latestSequence)
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null)
  const [summaryEditContent, setSummaryEditContent] = useState('')
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [factEditContent, setFactEditContent] = useState('')
  const [reembeddingFactId, setReembeddingFactId] = useState<string | null>(null)
  const [regeneratingSummaryId, setRegeneratingSummaryId] = useState<string | null>(null)
  const [regeneratingFactId, setRegeneratingFactId] = useState<string | null>(null)
  const [isRefreshingStats, setIsRefreshingStats] = useState(false)

  const refreshPanel = useCallback(() => {
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  const refreshStats = useCallback(async () => {
    setIsRefreshingStats(true)
    try {
      const response = await fetch(`/api/chats/${chatId}/stats`, { cache: 'no-store' })
      if (!response.ok) {
        throw await createApiError(response, 'Failed to fetch stats')
      }

      const data = parseStatsResponse(await response.json())
      if (typeof data?.messageCount === 'number') {
        setMessageCount(data.messageCount)
      }
      if (typeof data?.summaryCount === 'number' && data.summaryCount !== summaries.length) {
        refreshPanel()
      }
    } catch (error) {
      console.error('[Chat summaries] Failed to refresh stats', error)
      toast.error('통계를 불러오지 못했습니다')
    } finally {
      setIsRefreshingStats(false)
    }
  }, [chatId, refreshPanel, summaries.length])

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

  useEffect(() => {
    let isActive = true
    let channelInstance: ReturnType<typeof supabase.channel> | null = null

    const setupChannel = async () => {
      await supabase.auth.getSession()
      if (!isActive) {
        return
      }

      channelInstance = supabase
        .channel(`chat-${chatId}-summaries`, {
          config: {
            broadcast: { self: true },
            presence: { key: '' },
          },
        })
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_summaries',
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const nextPayload = parseRealtimeCollectionPayload(payload, isSummaryEntry)
            if (!nextPayload) {
              return
            }

            setSummaries((previousItems) =>
              applyRealtimeCollectionChange(previousItems, nextPayload),
            )
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_facts',
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const nextPayload = parseRealtimeCollectionPayload(payload, isFactEntry)
            if (!nextPayload) {
              return
            }

            setFacts((previousItems) => applyRealtimeCollectionChange(previousItems, nextPayload))
          },
        )
        .subscribe()
    }

    void setupChannel()

    return () => {
      isActive = false
      if (channelInstance) {
        void supabase.removeChannel(channelInstance)
      }
    }
  }, [chatId, supabase])

  const startSummaryEdit = useCallback((summaryId: string, currentSummary: string) => {
    setEditingFactId(null)
    setFactEditContent('')
    setEditingSummaryId(summaryId)
    setSummaryEditContent(currentSummary)
  }, [])

  const cancelSummaryEdit = useCallback(() => {
    setEditingSummaryId(null)
    setSummaryEditContent('')
  }, [])

  const saveSummaryEdit = useCallback(
    async (summaryId: string) => {
      if (!summaryEditContent.trim()) {
        toast.error('Please enter summary content.')
        return
      }

      const result = await updateSummary(summaryId, chatId, summaryEditContent)
      if ('error' in result) {
        toast.error('Failed to update summary: ' + result.error)
        return
      }

      setEditingSummaryId(null)
      setSummaryEditContent('')
      refreshPanel()
    },
    [chatId, refreshPanel, summaryEditContent],
  )

  const startFactEdit = useCallback((factId: string, currentFacts: string) => {
    setEditingSummaryId(null)
    setSummaryEditContent('')
    setEditingFactId(factId)
    setFactEditContent(currentFacts)
  }, [])

  const cancelFactEdit = useCallback(() => {
    setEditingFactId(null)
    setFactEditContent('')
  }, [])

  const saveFactEdit = useCallback(
    async (factId: string) => {
      if (!factEditContent.trim()) {
        toast.error('Please enter content.')
        return
      }

      const result = await updateFact(factId, chatId, factEditContent)
      if ('error' in result) {
        toast.error(result.error)
        return
      }

      setEditingFactId(null)
      setFactEditContent('')
      refreshPanel()
    },
    [chatId, factEditContent, refreshPanel],
  )

  const handleReembedFact = useCallback(
    async (factId: string) => {
      setReembeddingFactId(factId)
      const result = await reembedFact(factId, chatId)
      setReembeddingFactId(null)

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      refreshPanel()
    },
    [chatId, refreshPanel],
  )

  const handleRegenerateSummary = useCallback(
    async (summaryId: string) => {
      setRegeneratingSummaryId(summaryId)
      const result = await regenerateSummary(summaryId, chatId)
      setRegeneratingSummaryId(null)

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      refreshPanel()
    },
    [chatId, refreshPanel],
  )

  const handleRegenerateFacts = useCallback(
    async (factId: string) => {
      setRegeneratingFactId(factId)
      const result = await regenerateFacts(factId, chatId)
      setRegeneratingFactId(null)

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      refreshPanel()
    },
    [chatId, refreshPanel],
  )

  const handleDeleteSummary = useCallback(
    async (summaryId: string) => {
      const result = await deleteSummary(summaryId, chatId)
      if ('error' in result) {
        toast.error('Failed to delete summary: ' + result.error)
        return
      }

      refreshPanel()
    },
    [chatId, refreshPanel],
  )

  return {
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
  }
}
