'use client'

import { memo } from 'react'
import type { DisplayMessage } from '../utils'

type MessageActionId = 'edit' | 'delete' | 'regenerate' | 'reprocess' | 'debug' | 'translate'

type MessageActionItem = {
  id: MessageActionId
  label: string
  title: string
  disabled?: boolean
}

type ResolveMessageActionItemsArgs = {
  role: DisplayMessage['role']
  isPersisted: boolean
  isLastMessage: boolean
  isLatestAssistant: boolean
  developerMode: boolean
  isLoading: boolean
  isReprocessing: boolean
  reprocessingMessageId: string | null
  isRetranslating: boolean
  retranslatingMessageId: string | null
}

interface MessageActionBarProps extends ResolveMessageActionItemsArgs {
  messageId: string
  messageContent: string
  onStartEdit: (id: string, content: string) => void
  onDelete: (id: string) => void
  onRegenerate: (id: string) => void
  onReprocess: (id: string) => void
  onShowDebugInfo: (id: string) => void
  onRetranslate: (id: string) => void
}

const ACTION_CLASS_NAMES: Record<MessageActionId, string> = {
  edit: 'text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400',
  delete: 'text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400',
  regenerate: 'text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400',
  reprocess: 'text-gray-500 hover:text-orange-600 dark:text-gray-400 dark:hover:text-orange-400',
  debug: 'text-gray-500 hover:text-purple-600 dark:text-gray-400 dark:hover:text-purple-400',
  translate: 'text-gray-500 hover:text-cyan-600 dark:text-gray-400 dark:hover:text-cyan-400',
}

export function resolveMessageActionItems({
  role,
  isPersisted,
  isLastMessage,
  isLatestAssistant,
  developerMode,
  isLoading,
  isReprocessing,
  reprocessingMessageId,
  isRetranslating,
  retranslatingMessageId,
}: ResolveMessageActionItemsArgs): MessageActionItem[] {
  const items: MessageActionItem[] = [
    {
      id: 'edit',
      label: 'Edit',
      title: 'Edit message',
    },
    {
      id: 'delete',
      label: 'Delete',
      title: 'Delete message',
    },
  ]

  if (role === 'assistant' && isLastMessage && isPersisted) {
    items.push({
      id: 'regenerate',
      label: 'Regenerate',
      title: 'Regenerate',
      disabled: isLoading,
    })
  }

  if (role === 'assistant' && isPersisted) {
    items.push({
      id: 'reprocess',
      label: isReprocessing ? 'Reprocessing...' : 'Reprocess',
      title: 'Experimental reprocess with custom prompt',
      disabled: isLoading || reprocessingMessageId !== null,
    })
  }

  if (developerMode && role === 'assistant' && isPersisted && isLatestAssistant) {
    items.push({
      id: 'debug',
      label: 'Debug',
      title: 'View debug info',
    })
  }

  if (isPersisted) {
    items.push({
      id: 'translate',
      label: isRetranslating ? 'Translating...' : 'Translate',
      title: 'Translate to English (Bilingual Memory)',
      disabled: isLoading || retranslatingMessageId !== null,
    })
  }

  return items
}

export const MessageActionBar = memo(function MessageActionBar({
  messageId,
  messageContent,
  role,
  isPersisted,
  isLastMessage,
  isLatestAssistant,
  developerMode,
  isLoading,
  isReprocessing,
  reprocessingMessageId,
  isRetranslating,
  retranslatingMessageId,
  onStartEdit,
  onDelete,
  onRegenerate,
  onReprocess,
  onShowDebugInfo,
  onRetranslate,
}: MessageActionBarProps) {
  const items = resolveMessageActionItems({
    role,
    isPersisted,
    isLastMessage,
    isLatestAssistant,
    developerMode,
    isLoading,
    isReprocessing,
    reprocessingMessageId,
    isRetranslating,
    retranslatingMessageId,
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const actionClassName = ACTION_CLASS_NAMES[item.id]

        const handleClick = () => {
          if (item.id === 'edit') {
            onStartEdit(messageId, messageContent)
            return
          }

          if (item.id === 'delete') {
            onDelete(messageId)
            return
          }

          if (item.id === 'regenerate') {
            onRegenerate(messageId)
            return
          }

          if (item.id === 'reprocess') {
            onReprocess(messageId)
            return
          }

          if (item.id === 'debug') {
            onShowDebugInfo(messageId)
            return
          }

          onRetranslate(messageId)
        }

        return (
          <button
            key={item.id}
            type="button"
            onClick={handleClick}
            className={`text-xs transition-colors ${actionClassName}`}
            title={item.title}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
})
