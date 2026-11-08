'use client'

import { useCallback, useOptimistic, useState, useTransition } from 'react'
import { updateUserDraftModelSettings } from '@/app/dashboard/account/user-draft-settings-actions'
import type { UserDraftModelConfig } from '@/lib/chat/user-draft-model-config'
import type { LlmModelSelection } from '@/lib/llm/model-selection'

/**
 * Switches the account-wide draft model from the chat screen. The server action revalidates the
 * chat page, so the optimistic value settles into the refreshed `savedConfig` prop (or reverts on
 * failure).
 */
export function useUserDraftModelPreference(savedConfig: UserDraftModelConfig | null) {
  const [config, setOptimisticConfig] = useOptimistic(savedConfig)
  const [saving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const selectModel = useCallback(
    (selection: LlmModelSelection | null) => {
      setError(null)
      startTransition(async () => {
        // Switching models resets reasoning/tier, matching the account settings form.
        setOptimisticConfig(selection ? { ...selection, reasoningEffort: 'default' } : null)
        const formData = new FormData()
        formData.set('user_draft_api_key_id', selection?.apiKeyId ?? '')
        formData.set('user_draft_model_name', selection?.modelName ?? '')
        try {
          const result = await updateUserDraftModelSettings(
            { error: null, success: false },
            formData,
          )
          if (result.error) setError(result.error)
        } catch {
          setError('대필 설정을 저장하지 못했습니다.')
        }
      })
    },
    [setOptimisticConfig],
  )

  return { config, saving, error, selectModel }
}
