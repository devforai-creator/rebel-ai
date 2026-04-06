'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { updateRagSettings, type RagSettingsState } from './actions'

type VoyageKey = {
  id: string
  key_name: string
  is_active: boolean
}

interface RagSettingsFormProps {
  initialEnabled: boolean
  initialKeyId: string | null
  voyageKeys: VoyageKey[]
}

const initialState: RagSettingsState = {
  error: null,
  success: false,
}

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
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    if (state.success) {
      setStatusMessage('Saved successfully.')
    } else if (state.error) {
      setStatusMessage(state.error)
    }
  }, [state])

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

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="enable_rag" value={String(enableRag)} />
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="text-base font-medium text-gray-900 dark:text-white">
            Episodic Memory RAG
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Retrieve facts extracted from past conversations via embedding search to reduce token
            usage and improve relevance.
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
                setStatusMessage('Please register and activate a Voyage Embeddings key first.')
                return
              }
              setEnableRag(event.target.checked)
              setStatusMessage(null)
            }}
            disabled={!allowToggle}
          />
        </label>
      </div>

      {!hasKeys && (
        <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          No Voyage Embeddings key found.{' '}
          <Link href="/dashboard/api-keys" className="text-blue-600 dark:text-blue-400 underline">
            API Key Management
          </Link>{' '}
          - Please register a `Voyage (Embeddings)` key first.
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-200">
          Voyage Embeddings Key to Connect
        </label>
        <select
          name="voyage_key_id"
          className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
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

      {statusMessage && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            state.error
              ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
              : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
          }`}
        >
          {statusMessage}
        </div>
      )}

      <button
        type="submit"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={enableRag && (!selectedKey || !hasActiveKey)}
      >
        Save
      </button>
    </form>
  )
}
