'use client'

import React, { startTransition, useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/app/dashboard/components/Button'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import {
  buildLlmModelOptions,
  parseLlmModelSelection,
  serializeLlmModelSelection,
  type LlmModelSelection,
} from '@/lib/llm/model-selection'
import {
  getReasoningControl,
  REASONING_LABELS,
  type ReasoningPreference,
} from '@/lib/llm/reasoning'
import { supportsGoogleFlex, type GoogleServiceTier } from '@/lib/llm/service-tier'
import type { UserDraftModelConfig } from '@/lib/chat/user-draft-model-config'
import type { SelectableLlmApiKey } from './options'
import { resolveActionStateFeedback } from './useActionStateFeedback'
import {
  updateUserDraftModelSettings,
  type UserDraftModelSettingsState,
} from './user-draft-settings-actions'

const INITIAL_STATE: UserDraftModelSettingsState = { error: null, success: false }
const SELECT_CLASS =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white'
const LABEL_CLASS = 'block text-sm font-medium text-gray-900 dark:text-gray-200'

export default function UserDraftModelSettingsForm({
  initialConfig,
  apiKeys,
}: {
  initialConfig: UserDraftModelConfig | null
  apiKeys: SelectableLlmApiKey[]
}) {
  const options = useMemo(
    () => buildLlmModelOptions(apiKeys.filter((key) => key.provider !== 'local')),
    [apiKeys],
  )
  const [selection, setSelection] = useState<LlmModelSelection | null>(initialConfig)
  const [reasoning, setReasoning] = useState<ReasoningPreference>(
    initialConfig?.reasoningEffort ?? 'default',
  )
  const [tier, setTier] = useState<GoogleServiceTier>(initialConfig?.serviceTier ?? 'standard')
  const [state, formAction, pending] = useActionState(updateUserDraftModelSettings, INITIAL_STATE)
  const [editedSinceSave, setEditedSinceSave] = useState(false)
  const feedback = resolveActionStateFeedback(state, {
    successMessage: '대필 모델 설정을 저장했습니다.',
  })
  const clearFeedback = () => setEditedSinceSave(true)
  const selected = selection
    ? options.find((option) => option.value === serializeLlmModelSelection(selection))
    : null
  const reasoningControl = selected
    ? getReasoningControl(selected.credential.provider, selected.modelName)
    : null
  const supportsFlex = selected
    ? supportsGoogleFlex(selected.credential.provider, selected.modelName)
    : false

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setEditedSinceSave(false)
        // Keep these controlled inputs intact after the server action completes.
        startTransition(() => formAction(data))
      }}
      className="space-y-4"
    >
      <fieldset disabled={pending} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="user-draft-model" className={LABEL_CLASS}>
            대필 모델
          </label>
          <select
            id="user-draft-model"
            className={SELECT_CLASS}
            value={selection ? serializeLlmModelSelection(selection) : ''}
            onChange={(event) => {
              setSelection(event.target.value ? parseLlmModelSelection(event.target.value) : null)
              setReasoning('default')
              setTier('standard')
              clearFeedback()
            }}
          >
            <option value="">답변 모델과 동일 (기본값)</option>
            {selection && !selected && (
              <option value={serializeLlmModelSelection(selection)} disabled>
                저장된 모델을 사용할 수 없습니다. 다시 선택해주세요.
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.displayName} · {option.credential.key_name} ({option.credential.provider})
              </option>
            ))}
          </select>
          <input type="hidden" name="user_draft_api_key_id" value={selection?.apiKeyId ?? ''} />
          <input type="hidden" name="user_draft_model_name" value={selection?.modelName ?? ''} />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {selection
              ? '대필에만 선택한 모델과 아래 설정을 사용합니다.'
              : '각 채팅에서 선택한 주 모델과 추론 강도·서비스 티어를 그대로 사용합니다.'}
          </p>
        </div>
        {selected && (reasoningControl || supportsFlex) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {reasoningControl && (
              <div className="space-y-2">
                <label htmlFor="user-draft-reasoning" className={LABEL_CLASS}>
                  대필 추론 강도
                </label>
                <select
                  id="user-draft-reasoning"
                  name="user_draft_reasoning_effort"
                  className={SELECT_CLASS}
                  value={reasoning}
                  onChange={(event) => {
                    setReasoning(event.target.value as ReasoningPreference)
                    clearFeedback()
                  }}
                >
                  <option value="default">{REASONING_LABELS.default}</option>
                  {reasoningControl.levels.map((level) => (
                    <option key={level} value={level}>
                      {REASONING_LABELS[level]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {supportsFlex && (
              <div className="space-y-2">
                <label htmlFor="user-draft-tier" className={LABEL_CLASS}>
                  대필 서비스 티어
                </label>
                <select
                  id="user-draft-tier"
                  name="user_draft_service_tier"
                  className={SELECT_CLASS}
                  value={tier}
                  onChange={(event) => {
                    setTier(event.target.value as GoogleServiceTier)
                    clearFeedback()
                  }}
                >
                  <option value="standard">Standard</option>
                  <option value="flex">Flex</option>
                </select>
                {tier === 'flex' && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Flex는 응답이 느릴 수 있어 대필 요청의 50초 제한에 걸릴 수 있습니다.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </fieldset>
      {options.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          전용 모델을 선택하려면{' '}
          <Link href="/dashboard/api-keys" className="text-blue-600 underline dark:text-blue-400">
            클라우드 API 키를 등록
          </Link>
          해주세요.
        </p>
      )}
      {feedback && !pending && !editedSinceSave && (
        <InlineFeedback tone={feedback.tone}>{feedback.message}</InlineFeedback>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? '저장 중...' : '저장'}
      </Button>
    </form>
  )
}
