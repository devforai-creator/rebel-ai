'use client'

import React, { useActionState, useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import {
  updateAgenticTranscriptRecallDefaultSettings,
  type AgenticTranscriptRecallDefaultSettingsState,
} from './actions'
import { useActionStateFeedback } from './useActionStateFeedback'

type AtrSettingsFormProps = {
  initialEnabled: boolean
}

const initialState: AgenticTranscriptRecallDefaultSettingsState = {
  error: null,
  success: false,
}

export default function AtrSettingsForm({ initialEnabled }: AtrSettingsFormProps) {
  const [state, formAction] = useActionState(
    updateAgenticTranscriptRecallDefaultSettings,
    initialState,
  )
  const [enabled, setEnabled] = useState(initialEnabled)
  const { feedback, clearFeedback } = useActionStateFeedback(state, {
    successMessage: 'Saved successfully.',
  })

  return (
    <form action={formAction} className="space-y-6">
      <input
        type="hidden"
        name="enable_agentic_transcript_recall_default"
        value={String(enabled)}
      />
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="text-base font-medium text-gray-900 dark:text-white">
            ATR Default for Chats
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Sets the default for chats that use the account setting. This does not override chats
            that are explicitly set to always on or always off.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
          <span>{enabled ? 'Enabled' : 'Disabled'}</span>
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked)
              clearFeedback()
            }}
          />
        </label>
      </div>

      {feedback && <InlineFeedback tone={feedback.tone}>{feedback.message}</InlineFeedback>}

      <Button type="submit">Save</Button>
    </form>
  )
}
