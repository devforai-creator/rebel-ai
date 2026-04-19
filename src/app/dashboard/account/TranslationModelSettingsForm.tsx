'use client'

import React, { useActionState, useState } from 'react'
import Link from 'next/link'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { updateTranslationModelPreference, type TranslationModelPreferenceState } from './actions'
import { formatSelectableLlmApiKeyLabel, type SelectableLlmApiKey } from './options'
import { useActionStateFeedback } from './useActionStateFeedback'

interface Props {
  initialKeyId: string | null
  apiKeys: SelectableLlmApiKey[]
}

const initialState: TranslationModelPreferenceState = {
  error: null,
  success: false,
}

export default function TranslationModelSettingsForm({ initialKeyId, apiKeys }: Props) {
  const [state, formAction] = useActionState(updateTranslationModelPreference, initialState)
  const [selectedKey, setSelectedKey] = useState(initialKeyId ?? '')
  const { feedback, clearFeedback } = useActionStateFeedback(state, {
    successMessage: 'Saved successfully.',
  })

  const hasKeys = apiKeys.length > 0

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-200">
          Translation API Key (Bilingual Memory)
        </label>
        <select
          name="translation_key_id"
          className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
          value={selectedKey}
          onChange={(event) => {
            setSelectedKey(event.target.value)
            clearFeedback()
          }}
          disabled={!hasKeys}
        >
          <option value="">Disabled (default)</option>
          {apiKeys.map((key) => (
            <option key={key.id} value={key.id}>
              {formatSelectableLlmApiKeyLabel(key)}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Experimental option. This can reduce token usage in some chats, but it adds extra
          translation calls and may not lower total cost. Use a fast, low-cost model if you enable
          it.
        </p>
      </div>

      {!hasKeys && (
        <SurfaceCard
          tone="dashed"
          padding="sm"
          className="text-sm text-gray-600 dark:text-gray-300"
        >
          No LLM API keys registered.{' '}
          <Link href="/dashboard/api-keys" className="text-blue-600 dark:text-blue-400 underline">
            API Key Management
          </Link>{' '}
          - Please register an LLM API key first.
        </SurfaceCard>
      )}

      {feedback && <InlineFeedback tone={feedback.tone}>{feedback.message}</InlineFeedback>}

      <Button type="submit" disabled={!hasKeys && selectedKey !== ''}>
        Save
      </Button>
    </form>
  )
}
