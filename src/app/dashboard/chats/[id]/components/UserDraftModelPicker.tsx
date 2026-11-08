'use client'

import React, { useMemo } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import {
  buildLlmModelOptions,
  parseLlmModelSelection,
  serializeLlmModelSelection,
  type LlmModelSelection,
} from '@/lib/llm/model-selection'
import {
  formatChatModelOptionLabel,
  type ChatSelectableApiKeyOption,
} from '@/app/dashboard/chats/api-key-options'
import type { UserDraftModelConfig } from '@/lib/chat/user-draft-model-config'

export interface UserDraftModelPickerProps {
  apiKeys: ChatSelectableApiKeyOption[]
  config: UserDraftModelConfig | null
  disabled?: boolean
  saving?: boolean
  onSelect: (selection: LlmModelSelection | null) => void
}

// A native <select> laid over the chevron: OS pickers on mobile, and no popover clipped by the
// scrollable composer container.
export function UserDraftModelPicker({
  apiKeys,
  config,
  disabled = false,
  saving = false,
  onSelect,
}: UserDraftModelPickerProps) {
  const options = useMemo(
    () => buildLlmModelOptions(apiKeys.filter((key) => key.provider !== 'local')),
    [apiKeys],
  )
  if (options.length === 0) return null

  const value = config ? serializeLlmModelSelection(config) : ''
  const selected = config ? options.find((option) => option.value === value) : null
  const shortLabel = config ? (selected?.displayName ?? '다시 선택') : '답변 모델'
  const title =
    '대필 모델: ' +
    (config
      ? selected
        ? formatChatModelOptionLabel(selected)
        : '저장된 모델을 사용할 수 없습니다'
      : '답변 모델과 동일')

  return (
    <span className="relative inline-flex min-h-9 max-w-[11rem] items-center gap-1 rounded-lg border border-gray-300 px-2 text-xs text-gray-600 has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 sm:-ml-2 sm:min-h-8 sm:w-5 sm:justify-center sm:border-transparent sm:px-0 dark:sm:border-transparent dark:sm:hover:bg-gray-600">
      <span aria-hidden="true" className="truncate sm:hidden">
        {shortLabel}
      </span>
      {saving ? (
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      )}
      <select
        aria-label="대필 모델"
        title={title}
        value={value}
        disabled={disabled || saving}
        onChange={(event) => {
          if (event.target.value === value) return
          onSelect(event.target.value ? parseLlmModelSelection(event.target.value) : null)
        }}
        // Invisible itself, but the native option list inherits these colors.
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-white text-gray-900 opacity-0 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-white"
      >
        <option value="">답변 모델과 동일</option>
        {config && !selected && (
          <option value={value} disabled>
            저장된 모델을 사용할 수 없습니다. 다시 선택해주세요.
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {formatChatModelOptionLabel(option)}
          </option>
        ))}
      </select>
    </span>
  )
}
