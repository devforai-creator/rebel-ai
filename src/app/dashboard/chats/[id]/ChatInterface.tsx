'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ConfirmDialog from '@/app/dashboard/components/ConfirmDialog'
import { useAutosizeTextArea } from '@/hooks/useAutosizeTextArea'

// Local imports
import { type ChatInterfaceProps } from './utils'
import {
  useChatInterfaceSettings,
  useChatMessageLifecycle,
  useChatRuntimeVariables,
  useChatUsageStats,
  useChatMetadataViews,
} from './hooks'
import { ChatComposer, MessageList, TokenStatsPanel, DebugModal } from './components'
import { useUserDraft } from './hooks/useUserDraft'

export default function ChatInterface({
  chatId,
  initialMessages,
  initialActiveJob,
  apiKeys,
  preselectedApiKeyId,
  preselectedModelName,
  initialModelConfig,
  userDraftModelConfig,
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
    selectedModelName,
    resolveModelReasoning,
    handleSelectReasoning,
    resolveModelServiceTier,
    handleSelectServiceTier,
    secondaryApiKeyId,
    secondaryModelName,
    alternateModelsEnabled,
    memoryMode,
    anthropicBatchModeEnabled,
    anthropicBatchModeAvailable,
    deliveryMode,
    developerMode,
    handleToggleAlternateModels,
    handleSelectPrimaryModel,
    handleSelectSecondaryModel,
    handleSelectMemoryMode,
    handleToggleAnthropicBatchMode,
    toggleDeveloperMode,
  } = useChatInterfaceSettings({
    chatId,
    apiKeys,
    preselectedApiKeyId,
    preselectedModelName,
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
  })

  const { composer, history, messageState, actions, debug } = useChatMessageLifecycle({
    chatId,
    initialMessages,
    initialActiveJob,
    initialHistoryCursor,
    hasMoreHistory,
    selectedApiKeyId,
    selectedModelName,
    resolveModelReasoning,
    resolveModelServiceTier,
    deliveryMode,
    alternateModels: {
      enabled: alternateModelsEnabled,
      primaryApiKeyId: selectedApiKeyId || null,
      primaryModelName: selectedModelName || null,
      secondaryApiKeyId: secondaryApiKeyId || null,
      secondaryModelName: secondaryModelName || null,
    },
    fetchLatestUsage,
    onMessageChangeSideEffect: handleUsageRealtime,
  })

  const draftSelection = userDraftModelConfig ?? {
    apiKeyId: selectedApiKeyId,
    modelName: selectedModelName,
  }
  const draftCredential = apiKeys.find((key) => key.id === draftSelection.apiKeyId)
  const draftContextKey = useMemo(
    () =>
      JSON.stringify(messageState.combinedMessages.map((message) => [message.id, message.content])),
    [messageState.combinedMessages],
  )
  const draft = useUserDraft({
    chatId,
    // Send the chat selection as fallback; the server applies the current account preference.
    apiKeyId: selectedApiKeyId,
    modelName: selectedModelName,
    provider: draftCredential?.provider,
    configurationError:
      userDraftModelConfig && !draftCredential
        ? '대필 API 키를 사용할 수 없습니다. 대시보드 설정에서 다시 선택해주세요.'
        : null,
    reasoningEffort: resolveModelReasoning({
      apiKeyId: selectedApiKeyId,
      modelName: selectedModelName,
    }),
    serviceTier: resolveModelServiceTier({
      apiKeyId: selectedApiKeyId,
      modelName: selectedModelName,
    }),
    contextKey: JSON.stringify([draftContextKey, userDraftModelConfig ?? null]),
    input: composer.input,
    isChatLoading:
      messageState.isLoading ||
      actions.editingMessageId !== null ||
      actions.reprocessingMessageId !== null ||
      actions.retranslatingMessageId !== null,
    replaceInput: composer.replaceInput,
  })

  useAutosizeTextArea(composerRef, composer.input, { minHeight: 96, maxHeight: 600 })
  const { defaultVariables, mergedVariables, uiCard, uiCardRegistry, imageDisplay } =
    useChatMetadataViews(character, runtimeVariables)

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
        selectedModelName={selectedModelName}
        resolveModelReasoning={resolveModelReasoning}
        onSelectReasoning={handleSelectReasoning}
        resolveModelServiceTier={resolveModelServiceTier}
        onSelectServiceTier={handleSelectServiceTier}
        secondaryApiKeyId={secondaryApiKeyId}
        secondaryModelName={secondaryModelName}
        alternateModelsEnabled={alternateModelsEnabled}
        memoryMode={memoryMode}
        anthropicBatchModeEnabled={anthropicBatchModeEnabled && anthropicBatchModeAvailable}
        anthropicBatchModeAvailable={anthropicBatchModeAvailable}
        onSelectPrimaryModel={handleSelectPrimaryModel}
        onSelectSecondaryModel={handleSelectSecondaryModel}
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
        onOpenAssetDiagnostics={debug.openAssetDiagnostics}
      />

      {/* Message list */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900"
      >
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          <MessageList
            messages={messageState.combinedMessages}
            streamingDraft={messageState.streamingDraft}
            character={character}
            characterAssets={characterAssets}
            assetUrlMap={assetUrlMap}
            imageCommandUrlMap={imageCommandUrlMap}
            editingMessageId={actions.editingMessageId}
            editContent={actions.editContent}
            onChangeEditContent={actions.setEditContent}
            onStartEdit={actions.startEdit}
            onSaveEdit={actions.saveEdit}
            onCancelEdit={actions.cancelEdit}
            onDelete={actions.requestDelete}
            onRegenerate={actions.handleRegenerate}
            onReprocess={actions.handleReprocess}
            onRetranslate={actions.handleRetranslate}
            onShowDebugInfo={debug.openMessageDebug}
            developerMode={developerMode}
            persistedMessageIds={messageState.persistedMessageIds}
            isLoading={messageState.isLoading}
            reprocessingMessageId={actions.reprocessingMessageId}
            retranslatingMessageId={actions.retranslatingMessageId}
            hasMoreHistory={history.hasMore}
            isHistoryLoading={history.isLoading}
            onLoadHistory={history.loadOlderMessages}
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

      <ChatComposer
        composerRef={composerRef}
        input={composer.input}
        isLoading={messageState.isLoading}
        onInputChange={composer.handleInputChange}
        onQuickInsert={composer.insertInputText}
        onSubmit={composer.handleSubmit}
        isDrafting={draft.isDrafting}
        draftDisabledReason={draft.disabledReason}
        draftError={draft.error}
        draftUsage={draft.usage}
        onGenerateDraft={draft.generateDraft}
        onCancelDraft={draft.cancelDraft}
        onRestoreDraftInput={draft.canRestore ? draft.restoreInput : undefined}
      />

      {/* Debug modal */}
      <DebugModal
        isOpen={debug.debugModal.isOpen}
        debugInfo={debug.debugModal.debugInfo}
        errorMessage={debug.debugModal.errorMessage}
        message={debug.debugMessage}
        moduleRegex={moduleRegex}
        assetUrlMap={assetUrlMap}
        defaultVariables={defaultVariables}
        characterName={character.name}
        moduleAssetSummary={moduleAssetSummary}
        characterAssetCount={characterAssets.length}
        characterAssets={characterAssets}
        imageCommandUrlMap={imageCommandUrlMap}
        mode={debug.debugModal.mode}
        onClose={debug.closeDebugModal}
      />

      <ConfirmDialog
        isOpen={actions.pendingDeleteMessage !== null}
        title="Delete message?"
        description={actions.deleteDialogDescription}
        confirmLabel="Delete message"
        onConfirm={() => void actions.confirmDelete()}
        onClose={actions.closeDeleteDialog}
      />
    </div>
  )
}
