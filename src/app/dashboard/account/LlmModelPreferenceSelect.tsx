'use client'

import React, { useMemo, useState } from 'react'
import {
  buildLlmModelOptions,
  parseLlmModelSelection,
  resolveLlmModelSelection,
  serializeLlmModelSelection,
  type LlmModelSelection,
} from '@/lib/llm/model-selection'
import { formatSelectableLlmModelLabel, type SelectableLlmApiKey } from './options'

type Props = {
  id: string
  label: string
  apiKeyInputName: string
  modelInputName: string
  initialApiKeyId: string | null
  initialModelName: string | null
  apiKeys: SelectableLlmApiKey[]
  emptyLabel: string
  onSelectionChange?: () => void
}

export default function LlmModelPreferenceSelect({
  id,
  label,
  apiKeyInputName,
  modelInputName,
  initialApiKeyId,
  initialModelName,
  apiKeys,
  emptyLabel,
  onSelectionChange,
}: Props) {
  const options = useMemo(() => buildLlmModelOptions(apiKeys), [apiKeys])
  const [selection, setSelection] = useState<LlmModelSelection | null>(() =>
    resolveLlmModelSelection({
      credentials: apiKeys,
      apiKeyId: initialApiKeyId,
      modelName: initialModelName,
    }),
  )

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-gray-900 dark:text-gray-200">
        {label}
      </label>
      <select
        id={id}
        className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
        value={selection ? serializeLlmModelSelection(selection) : ''}
        onChange={(event) => {
          setSelection(event.target.value ? parseLlmModelSelection(event.target.value) : null)
          onSelectionChange?.()
        }}
        disabled={options.length === 0}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {formatSelectableLlmModelLabel(option)}
          </option>
        ))}
      </select>
      <input type="hidden" name={apiKeyInputName} value={selection?.apiKeyId ?? ''} />
      <input type="hidden" name={modelInputName} value={selection?.modelName ?? ''} />
    </div>
  )
}
