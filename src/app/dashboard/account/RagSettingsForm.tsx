'use client'

import React, { useActionState, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { updateRagSettings, type RagSettingsState } from './actions'
import type { VoyageEmbeddingsKeyOption } from './options'
import { type FormFeedback, useActionStateFeedback } from './useActionStateFeedback'

interface RagSettingsFormProps {
  initialEnabled: boolean
  initialKeyId: string | null
  voyageKeys: VoyageEmbeddingsKeyOption[]
}

const initialState: RagSettingsState = {
  error: null,
  success: false,
}

const VOYAGE_KEY_ID = 'voyage_key_id'

export default function RagSettingsForm({
  initialEnabled,
  initialKeyId,
  voyageKeys,
}: RagSettingsFormProps) {
  const [state, formAction] = useActionState(updateRagSettings, initialState)
  const [enableRag, setEnableRag] = useState(initialEnabled)
  const defaultKeyId = useMemo(() => {
    if (initialKeyId) {
      return initialKeyId
    }
    const firstActive = voyageKeys.find((key) => key.is_active)
    return firstActive?.id ?? ''
  }, [initialKeyId, voyageKeys])
  const [selectedKey, setSelectedKey] = useState(defaultKeyId)
  const [localFeedback, setLocalFeedback] = useState<FormFeedback | null>(null)
  const { feedback: actionFeedback, clearFeedback } = useActionStateFeedback(state, {
    successMessage: 'Saved successfully.',
  })

  useEffect(() => {
    if (enableRag && !selectedKey) {
      const firstActive = voyageKeys.find((key) => key.is_active)
      if (firstActive) {
        setSelectedKey(firstActive.id)
      }
    }
  }, [enableRag, selectedKey, voyageKeys])

  const hasKeys = voyageKeys.length > 0
  const hasActiveKey = voyageKeys.some((key) => key.is_active)
  const allowToggle = hasActiveKey
  const feedback = localFeedback ?? actionFeedback

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="enable_rag" value={String(enableRag)} />
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="text-base font-medium text-gray-900 dark:text-white">
            Episodic Memory RAG
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Retrieve facts extracted from past conversations via embedding search. When disabled,
            new episodic facts are not generated and stored facts are not sent in prompt context.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
          <span>{enableRag ? 'Enabled' : 'Disabled'}</span>
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={enableRag}
            onChange={(event) => {
              if (!allowToggle && event.target.checked) {
                setLocalFeedback({
                  message: 'Please register and activate a Voyage Embeddings key first.',
                  tone: 'warning',
                })
                clearFeedback()
                return
              }
              setEnableRag(event.target.checked)
              setLocalFeedback(null)
              clearFeedback()
            }}
            disabled={!allowToggle}
          />
        </label>
      </div>

      {!hasKeys && (
        <SurfaceCard
          tone="dashed"
          padding="sm"
          className="text-sm text-gray-600 dark:text-gray-300"
        >
          No Voyage Embeddings key found.{' '}
          <Link href="/dashboard/api-keys" className="text-blue-600 dark:text-blue-400 underline">
            API Key Management
          </Link>{' '}
          - Please register a `Voyage (Embeddings)` key first.
        </SurfaceCard>
      )}

      <div className="space-y-2">
        <label
          htmlFor={VOYAGE_KEY_ID}
          className="block text-sm font-medium text-gray-900 dark:text-gray-200"
        >
          Voyage Embeddings Key to Connect
        </label>
        <select
          id={VOYAGE_KEY_ID}
          name="voyage_key_id"
          className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          value={selectedKey}
          onChange={(event) => {
            setSelectedKey(event.target.value)
            setLocalFeedback(null)
            clearFeedback()
          }}
          disabled={!hasKeys}
        >
          <option value="">None</option>
          {voyageKeys.map((key) => (
            <option key={key.id} value={key.id} disabled={!key.is_active}>
              {key.key_name} {key.is_active ? '' : '(Inactive)'}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Voyage Embeddings keys can be created in the API Key Management page.
        </p>
      </div>

      {feedback && <InlineFeedback tone={feedback.tone}>{feedback.message}</InlineFeedback>}

      <Button type="submit" disabled={enableRag && (!selectedKey || !hasActiveKey)}>
        Save
      </Button>
    </form>
  )
}
