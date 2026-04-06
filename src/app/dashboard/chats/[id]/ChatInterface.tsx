'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { toast } from 'sonner'
import type { Message } from '@/types/database.types'
import type { CharacterAsset } from '@/lib/asset-resolver'
import { editMessage, deleteMessage } from './message-actions'
import { useAutosizeTextArea } from '@/hooks/useAutosizeTextArea'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'

// Local imports
import {
  type ChatInterfaceProps,
  type ChatAssetData,
  type InlineUiCardRegistry,
  type LatestMessageTokenStats,
  type MessageChangePayload,
  type DebugInfo,
  type DisplayMessage,
  mapMessageToDisplay,
  shouldRefreshTokenStats,
} from './utils'
import { useQueuedChat } from './hooks'
import { updateChatModelConfig } from './actions'
import { MessageList, TokenStatsPanel, DebugModal } from './components'
import { normalizeChatModelConfig } from '@/lib/chat/model-config'

// Default empty asset data
const EMPTY_ASSET_DATA: ChatAssetData = {
  characterAssets: [],
  assetUrlMap: {},
  imageCommandUrlMap: {},
  moduleRegex: [],
  moduleAssetSummary: [],
  globalVariables: {},
}

function isValidInlineUiCard(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return false
  if (!('meta' in raw) || !('views' in raw)) return false
  const views = (raw as Record<string, unknown>).views
  return typeof views === 'object' && views !== null && Object.keys(views).length > 0
}

export default function ChatInterface({
  chatId,
  initialMessages,
  apiKeys,
  preselectedApiKeyId,
  initialModelConfig,
  initialUsageStats,
  character,
  initialOldestSequence,
  hasMoreHistory,
  isDeveloper = false,
}: ChatInterfaceProps) {
  // Client-side asset loading to reduce SSR payload
  const [assetData, setAssetData] = useState<ChatAssetData>(EMPTY_ASSET_DATA)

  useEffect(() => {
    let cancelled = false

    const loadAssets = async () => {
      try {
        const response = await fetch(`/api/chats/${chatId}/assets`, { cache: 'no-store' })
        if (!response.ok) {
          console.error('[ChatInterface] Failed to load assets:', response.status)
          return
        }
        const data = await response.json()
        if (cancelled) return
        const globalVariables = data.globalVariables ?? {}
        setAssetData({
          characterAssets: data.characterAssets ?? [],
          assetUrlMap: data.assetUrlMap ?? {},
          imageCommandUrlMap: data.imageCommandUrlMap ?? {},
          moduleRegex: data.moduleRegex ?? [],
          moduleAssetSummary: data.moduleAssetSummary ?? [],
          globalVariables,
        })
        setRuntimeVariables(globalVariables)
      } catch (error) {
        console.error('[ChatInterface] Error loading assets:', error)
      }
    }

    void loadAssets()
    return () => {
      cancelled = true
    }
  }, [chatId])

  // Destructure for easier access
  const { characterAssets, assetUrlMap, imageCommandUrlMap, moduleRegex, moduleAssetSummary } =
    assetData

  // Runtime variables state (merged with character's default_variables)
  const [runtimeVariables, setRuntimeVariables] = useState<Record<string, unknown>>({})
  const runtimeVariablesRef = useRef<Record<string, unknown>>({})
  const normalizedModelConfig = useMemo(
    () => normalizeChatModelConfig(initialModelConfig),
    [initialModelConfig],
  )

  useEffect(() => {
    runtimeVariablesRef.current = runtimeVariables
  }, [runtimeVariables])

  const resolveValidApiKeyId = useCallback(
    (candidate?: string | null) => {
      if (!candidate) return null
      return apiKeys.some((key) => key.id === candidate) ? candidate : null
    },
    [apiKeys],
  )

  const initialPrimaryApiKeyId = (() => {
    const fromConfig = resolveValidApiKeyId(normalizedModelConfig.alternateModels?.primaryApiKeyId)
    if (fromConfig) return fromConfig
    const fromPreselected = resolveValidApiKeyId(preselectedApiKeyId ?? null)
    if (fromPreselected) return fromPreselected
    const savedKey = localStorage.getItem('lastUsedApiKey')
    const fromSaved = resolveValidApiKeyId(savedKey)
    if (fromSaved) return fromSaved
    return apiKeys[0]?.id || ''
  })()

  const initialSecondaryApiKeyId = (() => {
    const fromConfig = resolveValidApiKeyId(
      normalizedModelConfig.alternateModels?.secondaryApiKeyId,
    )
    if (fromConfig) return fromConfig
    const fallback = apiKeys.find((key) => key.id !== initialPrimaryApiKeyId)
    return fallback?.id || ''
  })()

  const [selectedApiKeyId, setSelectedApiKeyId] = useState(initialPrimaryApiKeyId)
  const [secondaryApiKeyId, setSecondaryApiKeyId] = useState(initialSecondaryApiKeyId)
  const [alternateModelsEnabled, setAlternateModelsEnabled] = useState(() => {
    const enabled = normalizedModelConfig.alternateModels?.enabled ?? false
    const hasPair =
      !!initialPrimaryApiKeyId &&
      !!initialSecondaryApiKeyId &&
      initialPrimaryApiKeyId !== initialSecondaryApiKeyId
    return enabled && hasPair
  })

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  // State
  const [latestUsage, setLatestUsage] = useState<LatestMessageTokenStats | null>(initialUsageStats)
  const supabase = useMemo(() => createSupabaseClient(), [])

  // Message editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  // Developer mode state
  const [developerMode, setDeveloperMode] = useState(false)
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [debugModal, setDebugModal] = useState<{
    isOpen: boolean
    messageId: string | null
    debugInfo: DebugInfo | null | undefined
    mode: 'message' | 'assets'
  }>({ isOpen: false, messageId: null, debugInfo: undefined, mode: 'message' })

  // History pagination
  const [historyMessages, setHistoryMessages] = useState<Message[]>([])
  const [oldestSequence, setOldestSequence] = useState<number | null>(initialOldestSequence)
  const [historyHasMore, setHistoryHasMore] = useState(hasMoreHistory)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [reprocessingMessageId, setReprocessingMessageId] = useState<string | null>(null)
  const [retranslatingMessageId, setRetranslatingMessageId] = useState<string | null>(null)

  // Debug info and persisted IDs tracking
  const debugInfoMap = useRef<Map<string, DebugInfo>>(new Map())
  const persistedMessageIds = useRef<Set<string>>(new Set())

  // Load developer mode from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('developerMode')
    if (saved === 'true') {
      setDeveloperMode(true)
    }
  }, [])

  // Save selected API key to localStorage
  useEffect(() => {
    if (selectedApiKeyId) {
      localStorage.setItem('lastUsedApiKey', selectedApiKeyId)
    }
  }, [selectedApiKeyId])

  const persistModelConfig = useCallback(
    async (nextEnabled: boolean, nextPrimary: string, nextSecondary: string) => {
      const config = {
        alternateModels: {
          enabled: nextEnabled,
          primaryApiKeyId: nextPrimary || null,
          secondaryApiKeyId: nextSecondary || null,
        },
      }

      const result = await updateChatModelConfig(chatId, config)
      if (result?.error) {
        toast.error(result.error)
      }
    },
    [chatId],
  )

  const handleToggleAlternateModels = useCallback(() => {
    const nextEnabled = !alternateModelsEnabled
    if (nextEnabled) {
      if (!selectedApiKeyId || !secondaryApiKeyId) {
        toast.error('교대 모드를 사용하려면 두 개의 API 키를 선택하세요.')
        return
      }
      if (selectedApiKeyId === secondaryApiKeyId) {
        toast.error('교대 모드는 서로 다른 API 키가 필요합니다.')
        return
      }
    }

    setAlternateModelsEnabled(nextEnabled)
    void persistModelConfig(nextEnabled, selectedApiKeyId, secondaryApiKeyId)
  }, [alternateModelsEnabled, selectedApiKeyId, secondaryApiKeyId, persistModelConfig])

  const handleSelectPrimaryApiKey = useCallback(
    (nextId: string) => {
      setSelectedApiKeyId(nextId)
      if (alternateModelsEnabled && nextId === secondaryApiKeyId) {
        toast.error('교대 모드는 서로 다른 API 키가 필요합니다.')
      }
      void persistModelConfig(alternateModelsEnabled, nextId, secondaryApiKeyId)
    },
    [alternateModelsEnabled, secondaryApiKeyId, persistModelConfig],
  )

  const handleSelectSecondaryApiKey = useCallback(
    (nextId: string) => {
      setSecondaryApiKeyId(nextId)
      if (alternateModelsEnabled && nextId === selectedApiKeyId) {
        toast.error('교대 모드는 서로 다른 API 키가 필요합니다.')
      }
      void persistModelConfig(alternateModelsEnabled, selectedApiKeyId, nextId)
    },
    [alternateModelsEnabled, selectedApiKeyId, persistModelConfig],
  )

  // Toggle developer mode
  const toggleDeveloperMode = useCallback(() => {
    const newValue = !developerMode
    setDeveloperMode(newValue)
    localStorage.setItem('developerMode', String(newValue))
  }, [developerMode])

  // Initialize debug info map
  useEffect(() => {
    const map = new Map<string, DebugInfo>()
    const idSet = new Set<string>()

    for (const msg of initialMessages) {
      idSet.add(msg.id)
      if (msg.debug_info) {
        map.set(msg.id, msg.debug_info as DebugInfo)
      }
    }

    debugInfoMap.current = map
    persistedMessageIds.current = idSet
  }, [initialMessages])

  // Fetch latest usage stats
  const fetchLatestUsage = useCallback(async () => {
    try {
      const response = await fetch(`/api/chats/${chatId}/stats`, { cache: 'no-store' })
      if (!response.ok) return

      const data = (await response.json()) as Record<string, unknown>
      const parseNumberOrNull = (value: unknown): number | null =>
        typeof value === 'number' && Number.isFinite(value) ? value : null

      const latestRaw = data.latestMessage
      const latestMessage: LatestMessageTokenStats | null =
        latestRaw && typeof latestRaw === 'object'
          ? (() => {
              const raw = latestRaw as Record<string, unknown>
              return {
                id: typeof raw.id === 'string' ? raw.id : null,
                createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
                total: typeof raw.total === 'number' ? raw.total : null,
                prompt: typeof raw.prompt === 'number' ? raw.prompt : null,
                completion: typeof raw.completion === 'number' ? raw.completion : null,
                cachedPrompt: typeof raw.cachedPrompt === 'number' ? raw.cachedPrompt : null,
                cacheHit: typeof raw.cacheHit === 'boolean' ? raw.cacheHit : false,
                cacheKey: typeof raw.cacheKey === 'string' ? raw.cacheKey : null,
                cacheRetention: typeof raw.cacheRetention === 'string' ? raw.cacheRetention : null,
                costUsd: parseNumberOrNull(raw.costUsd),
                promptCostUsd: parseNumberOrNull(raw.promptCostUsd),
                completionCostUsd: parseNumberOrNull(raw.completionCostUsd),
                cachedPromptCostUsd: parseNumberOrNull(raw.cachedPromptCostUsd),
                reasoningCostUsd: parseNumberOrNull(raw.reasoningCostUsd),
              }
            })()
          : null

      setLatestUsage(latestMessage)
    } catch (error) {
      console.error('Failed to load chat usage stats', error)
    }
  }, [chatId])

  useEffect(() => {
    void fetchLatestUsage()
  }, [fetchLatestUsage])

  const handleUsageRealtime = useCallback(
    (payload: MessageChangePayload) => {
      if (shouldRefreshTokenStats(payload)) {
        void fetchLatestUsage()
      }
    },
    [fetchLatestUsage],
  )

  // Use the queued chat hook
  const {
    messages,
    setMessages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    reload,
    handleRealtimeMessageChange,
  } = useQueuedChat({
    chatId,
    initialMessages,
    historyMessages,
    selectedApiKeyId,
    alternateModels: {
      enabled: alternateModelsEnabled,
      primaryApiKeyId: selectedApiKeyId || null,
      secondaryApiKeyId: secondaryApiKeyId || null,
    },
    fetchLatestUsage,
    debugInfoMap,
    persistedMessageIds,
  })

  // Realtime subscription
  useEffect(() => {
    let isActive = true
    let channel: RealtimeChannel | null = null

    const setupChannel = async () => {
      await supabase.auth.getSession()
      if (!isActive) return

      channel = supabase
        .channel(`chat-${chatId}-token-stats`, {
          config: {
            broadcast: { self: true },
            presence: { key: `token-stats-${chatId}` },
          },
        })
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const messagePayload = payload as MessageChangePayload
            handleUsageRealtime(messagePayload)
            handleRealtimeMessageChange(messagePayload)
          },
        )
        .subscribe()
    }

    void setupChannel()

    return () => {
      isActive = false
      if (channel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [chatId, supabase, handleUsageRealtime, handleRealtimeMessageChange])

  useAutosizeTextArea(composerRef, input, { minHeight: 96, maxHeight: 600 })

  // Show debug info modal
  const showDebugInfo = useCallback(
    async (messageId: string) => {
      const cached = debugInfoMap.current.get(messageId)
      if (cached) {
        setDebugModal({ isOpen: true, messageId, debugInfo: cached, mode: 'message' })
        return
      }

      setDebugModal({ isOpen: true, messageId, debugInfo: undefined, mode: 'message' })

      try {
        const response = await fetch(`/api/chats/${chatId}/messages/${messageId}/debug`)
        if (response.ok) {
          const data = await response.json()
          const serverDebugInfo = data.debugInfo as DebugInfo | null
          if (serverDebugInfo) {
            debugInfoMap.current.set(messageId, serverDebugInfo)
          }
          setDebugModal((prev) =>
            prev.isOpen && prev.messageId === messageId
              ? { ...prev, debugInfo: serverDebugInfo, mode: 'message' }
              : prev,
          )
        }
      } catch (error) {
        console.error('Failed to fetch debug info:', error)
        setDebugModal((prev) =>
          prev.isOpen && prev.messageId === messageId
            ? { ...prev, debugInfo: null, mode: 'message' }
            : prev,
        )
      }
    },
    [chatId],
  )

  // Load older messages
  const loadOlderMessages = useCallback(async () => {
    if (!historyHasMore || isHistoryLoading || oldestSequence === null) return

    setIsHistoryLoading(true)
    try {
      const response = await fetch(
        `/api/chats/${chatId}/messages/history?before=${oldestSequence}`,
        { cache: 'no-store' },
      )

      if (!response.ok) {
        console.error('Failed to load older messages:', response.statusText)
        setHistoryHasMore(false)
        return
      }

      const data = (await response.json()) as {
        messages: Message[]
        hasMore: boolean
        nextCursor: number | null
      }

      if (Array.isArray(data.messages) && data.messages.length > 0) {
        setHistoryMessages((prev) => [...data.messages, ...prev])
        setOldestSequence(data.nextCursor)
        setHistoryHasMore(data.hasMore)

        for (const msg of data.messages) {
          persistedMessageIds.current.add(msg.id)
          if (msg.debug_info) {
            debugInfoMap.current.set(msg.id, msg.debug_info as DebugInfo)
          }
        }
      } else {
        setHistoryHasMore(false)
      }
    } catch (error) {
      console.error('Failed to load older messages:', error)
    } finally {
      setIsHistoryLoading(false)
    }
  }, [chatId, historyHasMore, isHistoryLoading, oldestSequence])

  // Combined messages
  const combinedMessages = useMemo<DisplayMessage[]>(() => {
    if (historyMessages.length === 0) return messages
    return [...historyMessages.map(mapMessageToDisplay), ...messages]
  }, [historyMessages, messages])

  const debugMessage = useMemo<DisplayMessage | null>(() => {
    if (!debugModal.messageId) return null
    return combinedMessages.find((msg) => msg.id === debugModal.messageId) ?? null
  }, [combinedMessages, debugModal.messageId])

  const openAssetDiagnostics = useCallback(() => {
    const latestAssistant = [...combinedMessages]
      .reverse()
      .find((message) => message.role === 'assistant')
    const fallback = combinedMessages[combinedMessages.length - 1] ?? null
    const target = latestAssistant ?? fallback
    setDebugModal({
      isOpen: true,
      messageId: target?.id ?? null,
      debugInfo: null,
      mode: 'assets',
    })
  }, [combinedMessages])

  const defaultVariables = useMemo(() => {
    return character.metadata?.default_variables as Record<string, unknown> | undefined
  }, [character.metadata])

  // Merge default variables with runtime variables (runtime takes precedence)
  const mergedVariables = useMemo(() => {
    return { ...defaultVariables, ...runtimeVariables }
  }, [defaultVariables, runtimeVariables])

  // Detect ui_card from character metadata (v1.1 SUU integration)
  // Passed down to MessageList for per-message inline rendering
  const uiCard = useMemo(() => {
    const raw = character.metadata?.ui_card as Record<string, unknown> | null | undefined
    return isValidInlineUiCard(raw) ? raw : null
  }, [character.metadata])

  const uiCardRegistry = useMemo(() => {
    const raw = character.metadata?.ui_cards
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

    const entries = Object.entries(raw).filter(
      ([key, value]) => key.trim().length > 0 && isValidInlineUiCard(value),
    )
    if (entries.length === 0) return null

    return Object.fromEntries(entries) as InlineUiCardRegistry
  }, [character.metadata])

  const imageDisplay = useMemo(() => {
    const raw = character.metadata?.image_display as Record<string, unknown> | null | undefined
    if (!raw || typeof raw !== 'object') return null
    if (!raw.meta || !raw.views || typeof raw.views !== 'object') return null
    if (Object.keys(raw.views as Record<string, unknown>).length === 0) return null
    return raw
  }, [character.metadata])

  const persistRuntimeVariables = useCallback(
    async (nextVariables: Record<string, unknown>) => {
      const sanitized = Object.fromEntries(
        Object.entries(nextVariables).filter(([, value]) => typeof value !== 'undefined'),
      )
      try {
        const response = await fetch(`/api/chats/${chatId}/variables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: sanitized }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(errorText || 'Failed to save variables')
        }
      } catch (error) {
        console.error('[TriggerClick] Failed to persist variables', error)
        toast.error('변수 저장 실패')
      }
    },
    [chatId],
  )

  // Handle ui_card Button/Toggle actions → variable mutations
  // SUU's onAction contract:
  //   Button: onAction('button', actionId)         — actionId is the card's `action` field
  //   Toggle: onAction('toggle', actionId, { value: boolean }) — actionId is the `onToggle` field
  const handleUiCardAction = useCallback(
    (type: string, actionId: string, payload?: unknown) => {
      const nextVars: Record<string, unknown> = { ...runtimeVariablesRef.current }

      if (type === 'toggle' && payload && typeof payload === 'object' && 'value' in payload) {
        // Toggle: set the variable to the new boolean value from the renderer
        nextVars[actionId] = (payload as { value: boolean }).value
      } else {
        // Button: set the actionId variable to true (activate)
        nextVars[actionId] = true
      }

      runtimeVariablesRef.current = nextVars
      setRuntimeVariables(nextVars)
      void persistRuntimeVariables(nextVars)
    },
    [persistRuntimeVariables],
  )

  // Message editing handlers
  const startEdit = useCallback((messageId: string, currentContent: string) => {
    setEditingMessageId(messageId)
    setEditContent(currentContent)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null)
    setEditContent('')
  }, [])

  const saveEdit = useCallback(
    async (messageId: string) => {
      if (!editContent.trim()) return

      const result = await editMessage(messageId, editContent)
      if (result.error) {
        toast.error('Failed to edit message: ' + result.error)
        return
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: editContent } : m)),
      )
      setEditingMessageId(null)
      setEditContent('')
    },
    [editContent, setMessages],
  )

  // Delete message
  const handleDelete = useCallback(
    async (messageId: string) => {
      if (!confirm('Are you sure you want to delete this message?')) return

      const result = await deleteMessage(messageId)
      if (result.error) {
        toast.error('Failed to delete message: ' + result.error)
        return
      }

      persistedMessageIds.current.delete(messageId)
      debugInfoMap.current.delete(messageId)
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    },
    [setMessages],
  )

  // Regenerate message
  const handleRegenerate = useCallback(
    (messageId: string) => {
      if (!persistedMessageIds.current.has(messageId)) {
        toast.error('Message not yet saved. Please try again in a moment.')
        return
      }

      void reload({
        body: {
          isRegeneration: true,
          regenerateAssistantMessageId: messageId,
        },
      })
    },
    [reload],
  )

  // Reprocess message with custom prompt
  const handleReprocess = useCallback(async (messageId: string) => {
    if (!persistedMessageIds.current.has(messageId)) {
      toast.error('Message not yet saved. Please try again in a moment.')
      return
    }

    setReprocessingMessageId(messageId)
    try {
      const response = await fetch('/api/messages/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        toast.error(errorText || 'Failed to reprocess message')
        return
      }

      toast.success('Message reprocessed successfully')
    } catch (error) {
      console.error('[Reprocess] Error:', error)
      toast.error('Failed to reprocess message')
    } finally {
      setReprocessingMessageId(null)
    }
  }, [])

  // Retranslate message (bilingual memory)
  const handleRetranslate = useCallback(async (messageId: string) => {
    if (!persistedMessageIds.current.has(messageId)) {
      toast.error('Message not yet saved. Please try again in a moment.')
      return
    }

    setRetranslatingMessageId(messageId)
    try {
      const response = await fetch('/api/messages/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        toast.error(errorText || 'Failed to translate message')
        return
      }

      toast.success('Message translated successfully')
    } catch (error) {
      console.error('[Retranslate] Error:', error)
      toast.error('Failed to translate message')
    } finally {
      setRetranslatingMessageId(null)
    }
  }, [])

  // Scroll to bottom on initial load
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight })
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Token stats panel */}
      <TokenStatsPanel
        apiKeys={apiKeys}
        selectedApiKeyId={selectedApiKeyId}
        secondaryApiKeyId={secondaryApiKeyId}
        alternateModelsEnabled={alternateModelsEnabled}
        onSelectApiKey={handleSelectPrimaryApiKey}
        onSelectSecondaryApiKey={handleSelectSecondaryApiKey}
        onToggleAlternateModels={handleToggleAlternateModels}
        latestUsage={latestUsage}
        statsExpanded={statsExpanded}
        onToggleStats={() => setStatsExpanded(!statsExpanded)}
        isDeveloper={isDeveloper}
        developerMode={developerMode}
        onToggleDeveloperMode={toggleDeveloperMode}
        onOpenAssetDiagnostics={openAssetDiagnostics}
      />

      {/* Message list */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900"
      >
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          <MessageList
            messages={combinedMessages}
            character={character}
            characterAssets={characterAssets as CharacterAsset[]}
            assetUrlMap={assetUrlMap}
            imageCommandUrlMap={imageCommandUrlMap}
            editingMessageId={editingMessageId}
            editContent={editContent}
            onChangeEditContent={setEditContent}
            onStartEdit={startEdit}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onDelete={handleDelete}
            onRegenerate={handleRegenerate}
            onReprocess={handleReprocess}
            onRetranslate={handleRetranslate}
            onShowDebugInfo={showDebugInfo}
            developerMode={developerMode}
            persistedMessageIds={persistedMessageIds.current}
            isLoading={isLoading}
            reprocessingMessageId={reprocessingMessageId}
            retranslatingMessageId={retranslatingMessageId}
            hasMoreHistory={historyHasMore}
            isHistoryLoading={isHistoryLoading}
            onLoadHistory={loadOlderMessages}
            messagesEndRef={messagesEndRef}
            moduleRegex={moduleRegex}
            defaultVariables={mergedVariables}
            uiCard={uiCard}
            uiCardRegistry={uiCardRegistry}
            onUiCardAction={handleUiCardAction}
            imageDisplay={imageDisplay}
          />
        </div>
      </div>

      {/* Input form */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="flex flex-col gap-3 sm:flex-row">
            <textarea
              ref={composerRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSubmit()
                }
              }}
              placeholder="Enter your message... (Enter to send, Shift+Enter for new line)"
              rows={1}
              className="w-full flex-1 px-4 py-3 text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none max-h-[60vh] overflow-y-auto"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:self-end"
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {/* Debug modal */}
      <DebugModal
        isOpen={debugModal.isOpen}
        debugInfo={debugModal.debugInfo}
        message={debugMessage}
        moduleRegex={moduleRegex}
        assetUrlMap={assetUrlMap}
        defaultVariables={defaultVariables}
        characterName={character.name}
        moduleAssetSummary={moduleAssetSummary}
        characterAssetCount={characterAssets.length}
        characterAssets={characterAssets as CharacterAsset[]}
        imageCommandUrlMap={imageCommandUrlMap}
        mode={debugModal.mode}
        onClose={() =>
          setDebugModal({ isOpen: false, messageId: null, debugInfo: undefined, mode: 'message' })
        }
      />
    </div>
  )
}
