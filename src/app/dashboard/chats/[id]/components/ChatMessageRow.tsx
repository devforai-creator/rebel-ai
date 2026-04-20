'use client'

import { memo } from 'react'
import type { CharacterAsset } from '@/lib/asset-resolver'
import type {
  ChatCharacter,
  DisplayMessage,
  InlineUiCardRegistry,
  ModuleRegexEntry,
} from '../utils'
import { AssistantAvatar } from './AssistantAvatar'
import { MessageActionBar } from './MessageActionBar'
import { MessageBubble } from './MessageBubble'
import { MessageEditForm } from './MessageEditForm'

export interface ChatMessageRowProps {
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
  uiCard?: Record<string, unknown> | null
  uiCardRegistry?: InlineUiCardRegistry | null
  onUiCardAction?: (type: string, actionId: string, payload?: unknown) => void
  imageDisplay?: Record<string, unknown> | null
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
  const isAssistant = message.role === 'assistant'
  const isEditing = editingMessageId === message.id
  const isReprocessing = reprocessingMessageId === message.id
  const isRetranslating = retranslatingMessageId === message.id
  const isPersisted = persistedMessageIds.has(message.id)

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {isAssistant ? <AssistantAvatar character={character} /> : null}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        {isEditing ? (
          <MessageEditForm
            messageId={message.id}
            editContent={editContent}
            onChangeEditContent={onChangeEditContent}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
          />
        ) : (
          <>
            <MessageBubble
              message={message}
              character={character}
              characterAssets={characterAssets}
              assetUrlMap={assetUrlMap}
              imageCommandUrlMap={imageCommandUrlMap}
              moduleRegex={moduleRegex}
              defaultVariables={defaultVariables}
              uiCard={uiCard}
              uiCardRegistry={uiCardRegistry}
              onUiCardAction={onUiCardAction}
              imageDisplay={imageDisplay}
              isLatestAssistant={isLatestAssistant}
              isReprocessing={isReprocessing}
              isRetranslating={isRetranslating}
            />
            <MessageActionBar
              messageId={message.id}
              messageContent={message.content}
              role={message.role}
              isPersisted={isPersisted}
              isLastMessage={isLastMessage}
              isLatestAssistant={isLatestAssistant}
              developerMode={developerMode}
              isLoading={isLoading}
              isReprocessing={isReprocessing}
              reprocessingMessageId={reprocessingMessageId}
              isRetranslating={isRetranslating}
              retranslatingMessageId={retranslatingMessageId}
              onStartEdit={onStartEdit}
              onDelete={onDelete}
              onRegenerate={onRegenerate}
              onReprocess={onReprocess}
              onShowDebugInfo={onShowDebugInfo}
              onRetranslate={onRetranslate}
            />
          </>
        )}
      </div>
    </div>
  )
})
