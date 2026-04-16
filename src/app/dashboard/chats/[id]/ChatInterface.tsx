'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { useAutosizeTextArea } from '@/hooks/useAutosizeTextArea'

// Local imports
import { type ChatInterfaceProps, type DebugInfo } from './utils'
import {
  useChatInterfaceSettings,
  useQueuedChat,
  useChatMessageActions,
  useChatDebugModal,
  useChatHistory,
  combineHistoryWithLiveMessages,
  useChatRealtimeSubscription,
  useChatRuntimeVariables,
  useChatUsageStats,
  useChatMetadataViews,
} from './hooks'
import { MessageList, TokenStatsPanel, DebugModal } from './components'

export default function ChatInterface({
  chatId,
  initialMessages,
  apiKeys,
  preselectedApiKeyId,
  initialModelConfig,
  initialUsageStats,
  usageStatsEnabled,
  character,
  initialHistoryCursor,
  hasMoreHistory,
  isDeveloper = false,
}: ChatInterfaceProps) {
  const { assetData, runtimeVariables, handleUiCardAction } = useChatRuntimeVariables(chatId)

  // Destructure for easier access
  const { characterAssets, assetUrlMap, imageCommandUrlMap, moduleRegex, moduleAssetSummary } =
    assetData

  const {
    selectedApiKeyId,
    secondaryApiKeyId,
    alternateModelsEnabled,
    memoryMode,
    anthropicBatchModeEnabled,
    anthropicBatchModeAvailable,
    deliveryMode,
    developerMode,
    handleToggleAlternateModels,
    handleSelectPrimaryApiKey,
    handleSelectSecondaryApiKey,
    handleSelectMemoryMode,
    handleToggleAnthropicBatchMode,
    toggleDeveloperMode,
  } = useChatInterfaceSettings({
    chatId,
    apiKeys,
    preselectedApiKeyId,
    initialModelConfig,
    isDeveloper,
  })

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  // State
  // Developer mode state
  const [statsExpanded, setStatsExpanded] = useState(false)

  const {
    latestUsage,
    isLoading: usageStatsLoading,
    fetchLatestUsage,
    handleUsageRealtime,
  } = useChatUsageStats({
    chatId,
    initialUsageStats,
    enabled: usageStatsEnabled,
    active: statsExpanded,
  })

  // Debug info and persisted IDs tracking
  const debugInfoMap = useRef<Map<string, DebugInfo>>(new Map())
  const persistedMessageIds = useRef<Set<string>>(new Set())

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

  const { historyMessages, historyHasMore, isHistoryLoading, loadOlderMessages } = useChatHistory({
    chatId,
    initialHistoryCursor,
    hasMoreHistory,
    persistedMessageIds,
    debugInfoMap,
  })

  // Use the queued chat hook
  const {
    messages,
    setMessages,
    streamingDraft,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    reload,
    handleRealtimeMessageChange,
    handleAssistantStreamEvent,
  } = useQueuedChat({
    chatId,
    initialMessages,
    historyMessages,
    selectedApiKeyId,
    deliveryMode,
    alternateModels: {
      enabled: alternateModelsEnabled,
      primaryApiKeyId: selectedApiKeyId || null,
      secondaryApiKeyId: secondaryApiKeyId || null,
    },
    fetchLatestUsage,
    debugInfoMap,
    persistedMessageIds,
  })

  const handleMessageRealtime = useCallback(
    (payload: Parameters<typeof handleRealtimeMessageChange>[0]) => {
      handleUsageRealtime(payload)
      handleRealtimeMessageChange(payload)
    },
    [handleRealtimeMessageChange, handleUsageRealtime],
  )

  useChatRealtimeSubscription({
    chatId,
    onMessageChange: handleMessageRealtime,
    onAssistantStreamEvent: handleAssistantStreamEvent,
  })

  useAutosizeTextArea(composerRef, input, { minHeight: 96, maxHeight: 600 })

  const combinedMessages = useMemo(
    () => combineHistoryWithLiveMessages(historyMessages, messages),
    [historyMessages, messages],
  )
  const { defaultVariables, mergedVariables, uiCard, uiCardRegistry, imageDisplay } =
    useChatMetadataViews(character, runtimeVariables)

  const {
    editingMessageId,
    editContent,
    setEditContent,
    reprocessingMessageId,
    retranslatingMessageId,
    pendingDeleteMessage,
    deleteDialogDescription,
    startEdit,
    cancelEdit,
    saveEdit,
    requestDelete,
    closeDeleteDialog,
    confirmDelete,
    handleRegenerate,
    handleReprocess,
    handleRetranslate,
  } = useChatMessageActions({
    combinedMessages,
    persistedMessageIds,
    debugInfoMap,
    setMessages,
    reload,
  })

  const { debugModal, debugMessage, openMessageDebug, openAssetDiagnostics, closeDebugModal } =
    useChatDebugModal({
      chatId,
      combinedMessages,
      debugInfoMap,
    })

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
        memoryMode={memoryMode}
        anthropicBatchModeEnabled={anthropicBatchModeEnabled && anthropicBatchModeAvailable}
        anthropicBatchModeAvailable={anthropicBatchModeAvailable}
        onSelectApiKey={handleSelectPrimaryApiKey}
        onSelectSecondaryApiKey={handleSelectSecondaryApiKey}
        onToggleAlternateModels={handleToggleAlternateModels}
        onSelectMemoryMode={handleSelectMemoryMode}
        onToggleAnthropicBatchMode={handleToggleAnthropicBatchMode}
        latestUsage={latestUsage}
        usageStatsEnabled={usageStatsEnabled}
        usageStatsLoading={usageStatsLoading}
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
            streamingDraft={streamingDraft}
            character={character}
            characterAssets={characterAssets}
            assetUrlMap={assetUrlMap}
            imageCommandUrlMap={imageCommandUrlMap}
            editingMessageId={editingMessageId}
            editContent={editContent}
            onChangeEditContent={setEditContent}
            onStartEdit={startEdit}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onDelete={requestDelete}
            onRegenerate={handleRegenerate}
            onReprocess={handleReprocess}
            onRetranslate={handleRetranslate}
            onShowDebugInfo={openMessageDebug}
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
        characterAssets={characterAssets}
        imageCommandUrlMap={imageCommandUrlMap}
        mode={debugModal.mode}
        onClose={closeDebugModal}
      />

      <ConfirmDialog
        isOpen={pendingDeleteMessage !== null}
        title="Delete message?"
        description={deleteDialogDescription}
        confirmLabel="Delete message"
        onConfirm={() => void confirmDelete()}
        onClose={closeDeleteDialog}
      />
    </div>
  )
}
