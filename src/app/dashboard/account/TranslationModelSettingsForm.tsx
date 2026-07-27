'use client'

import React, { useActionState } from 'react'
import Link from 'next/link'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { updateTranslationModelPreference, type TranslationModelPreferenceState } from './actions'
import LlmModelPreferenceSelect from './LlmModelPreferenceSelect'
import type { SelectableLlmApiKey } from './options'
import { useActionStateFeedback } from './useActionStateFeedback'

interface Props {
  initialKeyId: string | null
  initialModelName: string | null
  apiKeys: SelectableLlmApiKey[]
}

const initialState: TranslationModelPreferenceState = {
  error: null,
  success: false,
}

const TRANSLATION_KEY_ID = 'translation_key_id'

export default function TranslationModelSettingsForm({
  initialKeyId,
  initialModelName,
  apiKeys,
}: Props) {
  const [state, formAction] = useActionState(updateTranslationModelPreference, initialState)
  const { feedback, clearFeedback } = useActionStateFeedback(state, {
    successMessage: 'Saved successfully.',
  })

  const hasKeys = apiKeys.length > 0

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <LlmModelPreferenceSelect
          id={TRANSLATION_KEY_ID}
          label="Translation Model (Bilingual Memory)"
          apiKeyInputName="translation_key_id"
          modelInputName="translation_model_name"
          initialApiKeyId={initialKeyId}
          initialModelName={initialModelName}
          apiKeys={apiKeys}
          emptyLabel="Disabled (default)"
          onSelectionChange={clearFeedback}
        />
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

      <Button type="submit">Save</Button>
    </form>
  )
}
