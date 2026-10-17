'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  getUserDraftModelConfigError,
  userDraftModelConfigSchema,
  type UserDraftModelConfig,
} from '@/lib/chat/user-draft-model-config'
import { resolveActiveLlmConfigForUser } from '@/lib/chat/llm-config-resolver'
import {
  createAuthenticatedAccountContext,
  optionalTrimmedStringSchema,
  parseAccountFormData,
  revalidateAccountSettingsPage,
  updateProfileForUser,
} from './account-action-helpers'

export type UserDraftModelSettingsState = { error: string | null; success: boolean }

const formSchema = z.object({
  user_draft_api_key_id: optionalTrimmedStringSchema,
  user_draft_model_name: optionalTrimmedStringSchema,
  user_draft_reasoning_effort: optionalTrimmedStringSchema,
  user_draft_service_tier: optionalTrimmedStringSchema,
})

export async function updateUserDraftModelSettings(
  _previous: UserDraftModelSettingsState,
  formData: FormData,
): Promise<UserDraftModelSettingsState> {
  const context = await createAuthenticatedAccountContext({
    error: '로그인이 필요합니다.',
    success: false,
  })
  if ('error' in context) return context
  const parsed = parseAccountFormData(formData, formSchema, '대필 모델 설정을 확인해주세요.')
  if ('error' in parsed) return parsed
  const { supabase, userId } = context
  const data = parsed.data
  let config: UserDraftModelConfig | null = null
  if (data.user_draft_api_key_id || data.user_draft_model_name) {
    const preference = userDraftModelConfigSchema.safeParse({
      apiKeyId: data.user_draft_api_key_id,
      modelName: data.user_draft_model_name,
      reasoningEffort: data.user_draft_reasoning_effort ?? 'default',
      ...(data.user_draft_service_tier ? { serviceTier: data.user_draft_service_tier } : {}),
    })
    if (!preference.success)
      return { error: '대필 모델과 설정을 다시 선택해주세요.', success: false }
    config = preference.data
    const resolved = await resolveActiveLlmConfigForUser({
      supabase,
      userId,
      apiKeyId: config.apiKeyId,
      preferredModelName: config.modelName,
    })
    if (resolved.status !== 'success')
      return { error: '선택한 API 키 또는 모델을 사용할 수 없습니다.', success: false }
    const error = getUserDraftModelConfigError(resolved.config.provider, config)
    if (error) return { error, success: false }
  }
  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: { user_draft_model_config: config },
    logLabel: '[Account] Failed to update user draft model settings:',
  })
  if (error) return { error: '대필 설정을 저장하지 못했습니다.', success: false }
  revalidateAccountSettingsPage()
  revalidatePath('/dashboard/chats/[id]', 'page')
  return { error: null, success: true }
}
