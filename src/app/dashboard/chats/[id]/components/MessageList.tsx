'use client'

import { memo, useMemo, type RefObject } from 'react'
import type { CharacterAsset } from '@/lib/asset-resolver'
import { ChatMessageRow } from './ChatMessageRow'
import { TypingIndicator } from './TypingIndicator'
import { buildVisibleMessages, findLastAssistantIndex } from './message-list-state'
import {
  DisplayMessage,
  StreamingAssistantDraft,
  ModuleRegexEntry,
  InlineUiCardRegistry,
  ChatCharacter,
} from '../utils'

// ============================================================================
// MessageList
// ============================================================================

export interface MessageListProps {
  messages: DisplayMessage[]
  streamingDraft?: StreamingAssistantDraft | null
  character: ChatCharacter
  characterAssets: CharacterAsset[]
  assetUrlMap?: Record<string, string>
  imageCommandUrlMap?: Record<string, string>
  editingMessageId: string | null
  editContent: string
  onChangeEditContent: (value: string) => void
  onStartEdit: (id: string, content: string) => void
  onSaveEdit: (id: string) => void
  onCancelEdit: () => void
  onDelete: (id: string) => void
  onRegenerate: (id: string) => void
  onReprocess: (id: string) => void
  onRetranslate: (id: string) => void
  onShowDebugInfo: (id: string) => void
  developerMode: boolean
  persistedMessageIds: Set<string>
  isLoading: boolean
  reprocessingMessageId: string | null
  retranslatingMessageId: string | null
  hasMoreHistory: boolean
  isHistoryLoading: boolean
  onLoadHistory: () => void
  messagesEndRef: RefObject<HTMLDivElement | null>
  moduleRegex?: ModuleRegexEntry[]
  /** Pre-merged variables from ChatInterface (default_variables + runtimeVariables) */
  defaultVariables?: Record<string, unknown>
  /** SUU ui_card for per-message inline rendering (v1.1) */
  uiCard?: Record<string, unknown> | null
  /** Named inline card registry for extract.card_ref lookups */
  uiCardRegistry?: InlineUiCardRegistry | null
  /** Callback for ui_card Button/Toggle actions */
  onUiCardAction?: (type: string, actionId: string, payload?: unknown) => void
  /** UCC card template for emotion image rendering */
  imageDisplay?: Record<string, unknown> | null
}

export const MessageList = memo(function MessageList({
  messages,
  streamingDraft,
  character,
  characterAssets,
  assetUrlMap,
  imageCommandUrlMap,
  editingMessageId,
  editContent,
  onChangeEditContent,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onRegenerate,
  onReprocess,
  onRetranslate,
  onShowDebugInfo,
  developerMode,
  persistedMessageIds,
  isLoading,
  reprocessingMessageId,
  retranslatingMessageId,
  hasMoreHistory,
  isHistoryLoading,
  onLoadHistory,
  messagesEndRef,
  moduleRegex,
  defaultVariables,
  uiCard,
  uiCardRegistry,
  onUiCardAction,
  imageDisplay,
}: MessageListProps) {
  const visibleMessages = useMemo(
    () => buildVisibleMessages(messages, streamingDraft),
    [messages, streamingDraft],
  )

  const lastAssistantIndex = useMemo(
    () => findLastAssistantIndex(visibleMessages),
    [visibleMessages],
  )

  return (
    <>
      {hasMoreHistory && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadHistory}
            disabled={isHistoryLoading}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            {isHistoryLoading ? 'Loading older messages...' : 'Load Older Messages'}
          </button>
        </div>
      )}

      {visibleMessages.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
          <p>Start a conversation!</p>
        </div>
      ) : (
        visibleMessages.map((message, index) => (
          <ChatMessageRow
            key={message.id}
            message={message}
            character={character}
            characterAssets={characterAssets}
            assetUrlMap={assetUrlMap}
            imageCommandUrlMap={imageCommandUrlMap}
            editingMessageId={editingMessageId}
            editContent={editContent}
            onChangeEditContent={onChangeEditContent}
            onStartEdit={onStartEdit}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
            onDelete={onDelete}
            onRegenerate={onRegenerate}
            onReprocess={onReprocess}
            onRetranslate={onRetranslate}
            onShowDebugInfo={onShowDebugInfo}
            developerMode={developerMode}
            persistedMessageIds={persistedMessageIds}
            isLastMessage={index === visibleMessages.length - 1}
            isLoading={isLoading}
            reprocessingMessageId={reprocessingMessageId}
            retranslatingMessageId={retranslatingMessageId}
            moduleRegex={moduleRegex}
            defaultVariables={defaultVariables}
            uiCard={uiCard}
            uiCardRegistry={uiCardRegistry}
            onUiCardAction={onUiCardAction}
            imageDisplay={imageDisplay}
            isLatestAssistant={index === lastAssistantIndex}
          />
        ))
      )}

      {isLoading && !streamingDraft && <TypingIndicator character={character} />}
      <div ref={messagesEndRef} />
    </>
  )
})
