'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getFormDataErrorMessage, safeParseFormData } from '@/lib/form-data'
import { PROVIDERS } from '@/lib/providers/catalog'
import type { ApiServiceTier, Database, Provider, ReasoningEffort } from '@/types/database.types'
import { MAX_API_KEY_LENGTH, PROVIDER_RULES } from './providerRules'

type VaultRpcError = { message: string; code?: string | null; details?: string | null }
type VaultRpcClient = {
  rpc(
    fn: 'create_secret',
    args: Database['public']['Functions']['create_secret']['Args'],
  ): Promise<{
    data: Database['public']['Functions']['create_secret']['Returns'] | null
    error: VaultRpcError | null
  }>
  rpc(
    fn: 'delete_secret',
    args: Database['public']['Functions']['delete_secret']['Args'],
  ): Promise<{
    data: Database['public']['Functions']['delete_secret']['Returns'] | null
    error: VaultRpcError | null
  }>
}

const adminSupabase = createAdminClient() as unknown as VaultRpcClient
const allowedServiceTiers: ApiServiceTier[] = ['standard', 'flex', 'priority', 'batch']
const allowedReasoningEfforts: ReasoningEffort[] = ['none', 'low', 'medium', 'high']

const apiKeyFormSchema = z.object({
  provider: z
    .string()
    .refine((value) => PROVIDERS.includes(value as Provider), {
      message: 'Provider를 선택해주세요.',
    }),
  key_name: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: '키 이름을 입력해주세요.',
    }),
  api_key: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: 'API 키를 입력해주세요.',
    }),
  model_preference: z.string().optional().default(''),
  service_tier: z
    .string()
    .optional()
    .default('standard')
    .transform((value) => value.trim().toLowerCase()),
  reasoning_effort: z
    .string()
    .optional()
    .transform((value) => value?.trim().toLowerCase()),
})

function parseApiKeyFormData(
  formData: FormData,
): { data: z.infer<typeof apiKeyFormSchema> } | { error: string; success: false } {
  const parsed = safeParseFormData(formData, apiKeyFormSchema)

  if (!parsed.success) {
    return {
      error: getApiKeyFormErrorMessage(parsed.error),
      success: false,
    } satisfies ApiKeyFormState
  }

  return { data: parsed.data }
}

export type ApiKeyFormState = {
  error: string | null
  success: boolean
}

export async function createApiKey(
  _prevState: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const supabase = await createClient()

  // 현재 사용자 확인
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: '로그인이 필요합니다', success: false }
  }

  const parsedForm = parseApiKeyFormData(formData)

  if ('error' in parsedForm) {
    return parsedForm
  }

  const provider = parsedForm.data.provider as Provider
  const keyName = parsedForm.data.key_name
  const apiKey = parsedForm.data.api_key
  const modelPreference = parsedForm.data.model_preference
  const rawServiceTier = parsedForm.data.service_tier
  const normalizedTier = allowedServiceTiers.includes(rawServiceTier as ApiServiceTier)
    ? (rawServiceTier as ApiServiceTier)
    : 'standard'
  const serviceTier: ApiServiceTier = provider === 'openai' ? normalizedTier : 'standard'
  const rawReasoningEffort = parsedForm.data.reasoning_effort ?? null
  const reasoningEffort: ReasoningEffort | null =
    provider === 'openai' &&
    rawReasoningEffort &&
    allowedReasoningEfforts.includes(rawReasoningEffort as ReasoningEffort)
      ? (rawReasoningEffort as ReasoningEffort)
      : null

  if (apiKey.length > MAX_API_KEY_LENGTH) {
    return {
      error: `API 키 길이가 너무 깁니다. ${MAX_API_KEY_LENGTH}자 이하로 입력해주세요.`,
      success: false,
    }
  }

  const providerRule = PROVIDER_RULES[provider]

  if (providerRule) {
    if (providerRule.maxLength && apiKey.length > providerRule.maxLength) {
      return {
        error: `API 키 길이가 너무 깁니다. ${providerRule.maxLength}자 이하로 입력해주세요.`,
        success: false,
      }
    }

    if (!providerRule.pattern.test(apiKey)) {
      return { error: providerRule.description, success: false }
    }
  }

  // Vault에 API 키 저장 (암호화)
  const sanitizedUserSegment = user.id.replace(/-/g, '').slice(0, 12)
  const timestampSegment = Date.now().toString(36)
  const vaultSecretName = `apikey_${sanitizedUserSegment}_${timestampSegment}_${provider}`

  const { error: vaultError } = await adminSupabase.rpc('create_secret', {
    secret_name: vaultSecretName,
    secret_value: apiKey,
    requester: user.id,
  })

  if (vaultError) {
    console.error('[API Keys] create_secret failed', {
      code:
        vaultError && typeof vaultError === 'object' && 'code' in vaultError
          ? ((vaultError as { code?: string | null }).code ?? null)
          : null,
    })

    const normalizedMessage = vaultError.message?.toLowerCase() ?? ''

    if (normalizedMessage.includes('quota exceeded')) {
      return {
        error:
          'API 키 등록 한도를 초과했습니다. 사용하지 않는 키를 삭제하거나 비활성화 후 다시 시도해주세요.',
        success: false,
      }
    }

    if (normalizedMessage.includes('invalid secret name')) {
      return {
        error: 'API 키 이름 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        success: false,
      }
    }

    return {
      error: 'API 키 암호화 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      success: false,
    }
  }

  // 메타데이터를 api_keys 테이블에 저장
  const { error } = await supabase.from('api_keys').insert({
    user_id: user.id,
    provider,
    key_name: keyName,
    vault_secret_name: vaultSecretName,
    model_preference: modelPreference || null,
    service_tier: serviceTier,
    reasoning_effort: reasoningEffort,
  })

  if (error) {
    // 실패 시 Vault에서도 삭제
    await adminSupabase.rpc('delete_secret', {
      secret_name: vaultSecretName,
      requester: user.id,
    })
    return {
      error: 'API 키 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      success: false,
    }
  }

  revalidatePath('/dashboard/api-keys')
  return { success: true, error: null }
}

export async function deleteApiKey(id: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: '로그인이 필요합니다' }
  }

  const { data: apiKeyRecord, error: fetchError } = await supabase
    .from('api_keys')
    .select('vault_secret_name')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !apiKeyRecord) {
    return { error: 'API 키를 찾을 수 없습니다' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('voyage_embedding_api_key_id')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('[API Keys] Failed to check profile before deletion:', profileError)
    return { error: '프로필 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' }
  }

  if (profile?.voyage_embedding_api_key_id === id) {
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({
        voyage_embedding_api_key_id: null,
        enable_episodic_rag: false,
      })
      .eq('id', user.id)

    if (profileUpdateError) {
      console.error('[API Keys] Failed to clear RAG settings before deletion:', profileUpdateError)
      return { error: 'RAG 설정을 해제하지 못했습니다. 잠시 후 다시 시도해주세요.' }
    }
  }

  // Vault에서 먼저 삭제 (RLS가 소유권 확인)
  const { error: vaultError } = await adminSupabase.rpc('delete_secret', {
    secret_name: apiKeyRecord.vault_secret_name,
    requester: user.id,
  })

  if (vaultError) {
    console.error('[API Keys] delete_secret failed', {
      code:
        vaultError && typeof vaultError === 'object' && 'code' in vaultError
          ? ((vaultError as { code?: string | null }).code ?? null)
          : null,
    })

    if (vaultError.message?.toLowerCase().includes('secret not found')) {
      return {
        error: 'Vault에서 해당 시크릿을 찾을 수 없습니다. 이미 삭제된 키일 수 있습니다.',
      }
    }
  }

  // DB에서 삭제
  const { error } = await supabase.from('api_keys').delete().eq('id', id).eq('user_id', user.id)

  if (error) {
    return {
      error: 'API 키 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    }
  }

  revalidatePath('/dashboard/api-keys')
  return { success: true }
}

function getApiKeyFormErrorMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0]
  const field = typeof firstIssue?.path[0] === 'string' ? firstIssue.path[0] : null

  if (field === 'provider') {
    return 'Provider를 선택해주세요.'
  }

  if (field === 'key_name') {
    return '키 이름을 입력해주세요.'
  }

  if (field === 'api_key') {
    return 'API 키를 입력해주세요.'
  }

  return getFormDataErrorMessage(error, '입력값을 확인해주세요.')
}

export async function toggleApiKey(id: string, isActive: boolean) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: '로그인이 필요합니다' }
  }

  const { error } = await supabase
    .from('api_keys')
    .update({ is_active: !isActive })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return {
      error: '상태 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    }
  }

  revalidatePath('/dashboard/api-keys')
  return { success: true }
}
