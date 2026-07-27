'use client'

import React, { useActionState } from 'react'
import Link from 'next/link'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { updateSummaryModelPreference, type SummaryModelPreferenceState } from './actions'
import LlmModelPreferenceSelect from './LlmModelPreferenceSelect'
import type { SelectableLlmApiKey } from './options'
import { useActionStateFeedback } from './useActionStateFeedback'

interface Props {
  initialKeyId: string | null
  initialModelName: string | null
  apiKeys: SelectableLlmApiKey[]
}

const initialState: SummaryModelPreferenceState = {
  error: null,
  success: false,
}

const SUMMARY_KEY_ID = 'summary_key_id'

export default function SummaryModelSettingsForm({
  initialKeyId,
  initialModelName,
  apiKeys,
}: Props) {
  const [state, formAction] = useActionState(updateSummaryModelPreference, initialState)
  const { feedback, clearFeedback } = useActionStateFeedback(state, {
    successMessage: 'Saved successfully.',
  })

  const hasKeys = apiKeys.length > 0

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <LlmModelPreferenceSelect
          id={SUMMARY_KEY_ID}
          label="Summary-dedicated Model"
          apiKeyInputName="summary_key_id"
          modelInputName="summary_model_name"
          initialApiKeyId={initialKeyId}
          initialModelName={initialModelName}
          apiKeys={apiKeys}
          emptyLabel="Same as chat (default)"
          onSelectionChange={clearFeedback}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Advanced option. If not selected, the model from your recent chat will continue to be
          used. A registered provider credential can be reused across all of its supported models.
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
