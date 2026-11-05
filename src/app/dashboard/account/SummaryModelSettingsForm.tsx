'use client'

import React, { startTransition, useActionState, useState } from 'react'
import Link from 'next/link'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import { updateSummaryModelPreference, type SummaryModelPreferenceState } from './actions'
import LlmModelPreferenceSelect from './LlmModelPreferenceSelect'
import { resolveLlmModelSelection, type LlmModelSelection } from '@/lib/llm/model-selection'
import {
  getReasoningControl,
  isReasoningPreference,
  REASONING_LABELS,
  supportsReasoningPreference,
  type ReasoningPreference,
} from '@/lib/llm/reasoning'
import type { SelectableLlmApiKey } from './options'
import { resolveActionStateFeedback } from './useActionStateFeedback'

interface Props {
  initialKeyId: string | null
  initialModelName: string | null
  initialReasoningEffort?: string | null
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
  initialReasoningEffort,
  apiKeys,
}: Props) {
  const [selection, setSelection] = useState<LlmModelSelection | null>(() =>
    resolveLlmModelSelection({
      credentials: apiKeys,
      apiKeyId: initialKeyId,
      modelName: initialModelName,
    }),
  )
  const selectedKey = apiKeys.find((key) => key.id === selection?.apiKeyId)
  const reasoningControl =
    selectedKey && selection ? getReasoningControl(selectedKey.provider, selection.modelName) : null
  const [reasoning, setReasoning] = useState<ReasoningPreference>(() =>
    selectedKey &&
    selection &&
    isReasoningPreference(initialReasoningEffort) &&
    supportsReasoningPreference(selectedKey.provider, selection.modelName, initialReasoningEffort)
      ? initialReasoningEffort
      : 'default',
  )
  const [state, formAction, pending] = useActionState(updateSummaryModelPreference, initialState)
  const [editedSinceSave, setEditedSinceSave] = useState(false)
  const feedback = resolveActionStateFeedback(state, {
    successMessage: 'Saved successfully.',
  })

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setEditedSinceSave(false)
        startTransition(() => formAction(data))
      }}
      className="space-y-4"
    >
      <fieldset disabled={pending} className="space-y-4">
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
            onSelectionChange={(nextSelection) => {
              setSelection(nextSelection)
              setReasoning('default')
              setEditedSinceSave(true)
            }}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Advanced option. If not selected, the model from your recent chat will continue to be
            used. A registered provider credential can be reused across all of its supported models.
          </p>
        </div>
        {reasoningControl ? (
          <div className="space-y-2">
            <label
              htmlFor="summary-reasoning"
              className="block text-sm font-medium text-gray-900 dark:text-gray-200"
            >
              요약 추론 강도
            </label>
            <select
              id="summary-reasoning"
              name="summary_reasoning_effort"
              value={reasoning}
              onChange={(event) => {
                setReasoning(event.target.value as ReasoningPreference)
                setEditedSinceSave(true)
              }}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="default">
                모델 기본값 ({REASONING_LABELS[reasoningControl.defaultLevel]})
              </option>
              {reasoningControl.levels.map((level) => (
                <option key={level} value={level}>
                  {REASONING_LABELS[level]}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              채팅의 추론 설정과 별개로 요약·상위 요약·사실 추출에 적용합니다.
            </p>
          </div>
        ) : (
          <>
            <input type="hidden" name="summary_reasoning_effort" value="default" />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {selection
                ? '이 모델은 기본 추론 동작을 사용합니다.'
                : '전용 요약 모델을 선택하면 지원되는 추론 강도를 별도로 설정할 수 있습니다.'}
            </p>
          </>
        )}
      </fieldset>

      {apiKeys.length === 0 && (
        <SurfaceCard
          tone="dashed"
          padding="sm"
          className="text-sm text-gray-600 dark:text-gray-300"
        >
          No LLM API keys registered.{' '}
          <Link href="/dashboard/api-keys" className="text-blue-600 underline dark:text-blue-400">
            API Key Management
          </Link>{' '}
          - Please register an LLM API key first.
        </SurfaceCard>
      )}

      {feedback && !pending && !editedSinceSave && (
        <InlineFeedback tone={feedback.tone}>{feedback.message}</InlineFeedback>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save'}
      </Button>
    </form>
  )
}
