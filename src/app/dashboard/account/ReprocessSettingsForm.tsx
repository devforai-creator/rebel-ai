'use client'

import React, { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { updateReprocessSettings, type ReprocessSettingsState } from './actions'

type ApiKeyOption = {
  id: string
  key_name: string
  provider: string
  model_preference: string | null
  service_tier: string | null
}

interface Props {
  initialPrompt: string | null
  initialKeyId: string | null
  apiKeys: ApiKeyOption[]
}

const initialState: ReprocessSettingsState = {
  error: null,
  success: false,
}

function formatOptionLabel(key: ApiKeyOption): string {
  const modelInfo = key.model_preference ? key.model_preference : 'No model set'
  const serviceTier = key.service_tier ? ` · ${key.service_tier}` : ''
  return `${key.key_name} · ${key.provider}${serviceTier} · ${modelInfo}`
}

export default function ReprocessSettingsForm({ initialPrompt, initialKeyId, apiKeys }: Props) {
  const [state, formAction] = useActionState(updateReprocessSettings, initialState)
  const [selectedKey, setSelectedKey] = useState(initialKeyId ?? '')
  const [prompt, setPrompt] = useState(initialPrompt ?? '')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    if (state.success) {
      setStatusMessage('Saved successfully.')
    } else if (state.error) {
      setStatusMessage(state.error)
    }
  }, [state])

  const hasKeys = apiKeys.length > 0

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-200">
          Reprocess Prompt
        </label>
        <textarea
          name="reprocess_prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a system prompt for reprocessing (e.g., 'Translate the following text to Korean while preserving the original tone and style.')"
          className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 min-h-[100px] resize-y"
          rows={4}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Experimental option. This prompt is used only for the reprocess flow. The original message
          content will be sent as the user message, outside the supported main chat queue.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-200">
          Reprocess API Key
        </label>
        <select
          name="reprocess_key_id"
          className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          disabled={!hasKeys}
        >
          <option value="">Select an API key</option>
          {apiKeys.map((key) => (
            <option key={key.id} value={key.id}>
              {formatOptionLabel(key)}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Select which API key and model to use for this experimental rewrite path.
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

      {statusMessage && (
        <InlineFeedback tone={state.error ? 'error' : 'success'}>{statusMessage}</InlineFeedback>
      )}

      <Button type="submit">Save</Button>
    </form>
  )
}
