'use client'

import { memo, useMemo, useRef, type RefObject } from 'react'
import Image from 'next/image'
import type { CharacterAsset } from '@/lib/asset-resolver'
import { useAutosizeTextArea } from '@/hooks/useAutosizeTextArea'
import {
  DisplayMessage,
  StreamingAssistantDraft,
  ModuleRegexEntry,
  InlineUiCardRegistry,
  ChatCharacter,
  renderMessageContent,
} from '../utils'

// ============================================================================
// AssistantAvatar
// ============================================================================

interface AssistantAvatarProps {
  character: ChatCharacter
}

export const AssistantAvatar = memo(function AssistantAvatar({ character }: AssistantAvatarProps) {
  return (
    <div className="flex-shrink-0">
      {character.avatar_url ? (
        <Image
          src={character.avatar_url}
          alt={character.name}
          width={32}
          height={32}
          unoptimized
          className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-600"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center border border-gray-200 dark:border-gray-600">
          <span className="text-white text-sm font-bold">
            {character.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  )
})

// ============================================================================
// TypingIndicator
// ============================================================================

interface TypingIndicatorProps {
  character: ChatCharacter
}

export const TypingIndicator = memo(function TypingIndicator({ character }: TypingIndicatorProps) {
  return (
    <div className="flex justify-start gap-2">
      <AssistantAvatar character={character} />
      <div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
          <div
            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
            style={{ animationDelay: '0.2s' }}
          />
          <div
            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
            style={{ animationDelay: '0.4s' }}
          />
        </div>
      </div>
    </div>
  )
})

// ============================================================================
// ChatMessageRow
// ============================================================================

interface ChatMessageRowProps {
  message: DisplayMessage
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
  isLastMessage: boolean
  isLoading: boolean
  reprocessingMessageId: string | null
  retranslatingMessageId: string | null
  moduleRegex?: ModuleRegexEntry[]
  defaultVariables?: Record<string, unknown>
  /** SUU ui_card for per-message inline rendering (v1.1) */
  uiCard?: Record<string, unknown> | null
  /** Named inline card registry for extract.card_ref lookups */
  uiCardRegistry?: InlineUiCardRegistry | null
  /** Callback for ui_card Button/Toggle actions */
  onUiCardAction?: (type: string, actionId: string, payload?: unknown) => void
  /** UCC card template for emotion image rendering */
  imageDisplay?: Record<string, unknown> | null
  /** Whether this is the latest assistant message (for runtime state targeting) */
  isLatestAssistant: boolean
}

export const ChatMessageRow = memo(function ChatMessageRow({
  message,
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
  isLastMessage,
  isLoading,
  reprocessingMessageId,
  retranslatingMessageId,
  moduleRegex,
  defaultVariables,
  uiCard,
  uiCardRegistry,
  onUiCardAction,
  imageDisplay,
  isLatestAssistant,
}: ChatMessageRowProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isAssistant = message.role === 'assistant'
  const isStreaming = message.streaming === true
  const isEditing = editingMessageId === message.id
  const isReprocessing = reprocessingMessageId === message.id
  const isRetranslating = retranslatingMessageId === message.id

  const bubbleClasses = isUser
    ? 'bg-blue-600 text-white'
    : isSystem
      ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-200 dark:border-red-700'
      : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700'

  const renderedContent = useMemo(() => {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
    return renderMessageContent(
      message.content,
      characterAssets,
      assetUrlMap,
      imageCommandUrlMap,
      moduleRegex,
      screenWidth,
      defaultVariables,
      character.name,
      message.id, // randomSeed for SSR/hydration consistency
      undefined,
      undefined,
      isAssistant ? uiCard : null, // Only render ui_card inline for assistant messages
      isAssistant ? uiCardRegistry : null,
      isAssistant ? onUiCardAction : undefined,
      // Historical snapshot: past messages use only extract results + ui_card.state.
      // Only the latest assistant message also includes runtime variables (Toggle/Button state).
      isLatestAssistant,
      imageDisplay,
    )
  }, [
    message.content,
    message.id,
    characterAssets,
    assetUrlMap,
    imageCommandUrlMap,
    moduleRegex,
    defaultVariables,
    character.name,
    uiCard,
    uiCardRegistry,
    onUiCardAction,
    isLatestAssistant,
    isAssistant,
    imageDisplay,
  ])

  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  useAutosizeTextArea(editTextareaRef, isEditing ? editContent : '', {
    minHeight: 120,
    maxHeight: 800,
  })

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} gap-2`}>
      {isAssistant && <AssistantAvatar character={character} />}
      <div className="flex flex-col items-start gap-1 flex-1 min-w-0">
        {isEditing ? (
          <div className="w-full">
            <textarea
              ref={editTextareaRef}
              value={editContent}
              onChange={(e) => onChangeEditContent(e.target.value)}
              className="w-full px-3 py-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none max-h-[70vh] overflow-y-auto"
              rows={1}
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => void onSaveEdit(message.id)}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
              >
                Save
              </button>
              <button
                onClick={onCancelEdit}
                className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`msg-${message.id} max-w-full rounded-lg px-4 py-2 ${bubbleClasses} relative`}
            >
              {isReprocessing && (
                <div className="absolute inset-0 bg-white/70 dark:bg-gray-800/70 rounded-lg flex items-center justify-center z-10">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                    Reprocessing...
                  </div>
                </div>
              )}
              {isRetranslating && (
                <div className="absolute inset-0 bg-white/70 dark:bg-gray-800/70 rounded-lg flex items-center justify-center z-10">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                    Translating...
                  </div>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words max-w-full overflow-x-auto [&_img]:max-w-full [&_img]:h-auto [&_img]:block">
                {isStreaming && !message.content ? (
                  <div className="flex items-center gap-2 py-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    />
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: '0.4s' }}
                    />
                  </div>
                ) : (
                  <>
                    {renderedContent}
                    {isStreaming && (
                      <span className="inline-block w-2 h-4 ml-1 align-middle bg-current/60 animate-pulse" />
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <button
                onClick={() => onStartEdit(message.id, message.content)}
                className="text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
                title="Edit message"
              >
                Edit
              </button>
              <button
                onClick={() => void onDelete(message.id)}
                className="text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
                title="Delete message"
              >
                Delete
              </button>
              {isAssistant && isLastMessage && persistedMessageIds.has(message.id) && (
                <button
                  onClick={() => onRegenerate(message.id)}
                  className="text-xs text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400 transition-colors"
                  title="Regenerate"
                  disabled={isLoading}
                >
                  Regenerate
                </button>
              )}
              {isAssistant && persistedMessageIds.has(message.id) && (
                <button
                  onClick={() => onReprocess(message.id)}
                  className="text-xs text-gray-500 hover:text-orange-600 dark:text-gray-400 dark:hover:text-orange-400 transition-colors"
                  title="Reprocess with custom prompt"
                  disabled={isLoading || reprocessingMessageId !== null}
                >
                  {isReprocessing ? 'Reprocessing...' : 'Reprocess'}
                </button>
              )}
              {developerMode && isAssistant && persistedMessageIds.has(message.id) && (
                <button
                  onClick={() => onShowDebugInfo(message.id)}
                  className="text-xs text-gray-500 hover:text-purple-600 dark:text-gray-400 dark:hover:text-purple-400 transition-colors"
                  title="View debug info"
                >
                  Debug
                </button>
              )}
              {persistedMessageIds.has(message.id) && (
                <button
                  onClick={() => onRetranslate(message.id)}
                  className="text-xs text-gray-500 hover:text-cyan-600 dark:text-gray-400 dark:hover:text-cyan-400 transition-colors"
                  title="Translate to English (Bilingual Memory)"
                  disabled={isLoading || retranslatingMessageId !== null}
                >
                  {isRetranslating ? 'Translating...' : 'Translate'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
})

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
  const visibleMessages = useMemo(() => {
    if (!streamingDraft) {
      return messages
    }

    if (streamingDraft.replaceMessageId) {
      const targetIndex = messages.findIndex(
        (message) => message.id === streamingDraft.replaceMessageId,
      )
      if (targetIndex !== -1) {
        const nextMessages = [...messages]
        nextMessages[targetIndex] = streamingDraft
        return nextMessages
      }
    }

    return [...messages, streamingDraft]
  }, [messages, streamingDraft])

  // Find the index of the last assistant message for runtime state targeting
  const lastAssistantIndex = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === 'assistant') return i
    }
    return -1
  }, [visibleMessages])

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
