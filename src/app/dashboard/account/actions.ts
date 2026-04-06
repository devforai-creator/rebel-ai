'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Profile } from '@/types/database.types'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'

export async function deleteAccount() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    console.error('[Account] Failed to load current user for deletion', {
      error: userError?.message,
    })
    return { error: 'Unable to verify current user information.' }
  }

  const { data: apiKeys, error: apiKeysError } = await supabase
    .from('api_keys')
    .select('vault_secret_name')
    .eq('user_id', user.id)

  if (apiKeysError) {
    console.error('[Account] Failed to load API keys before deletion', {
      userId: user.id,
      error: apiKeysError.message,
    })
    return {
      error: 'An error occurred while preparing account deletion. Please try again later.',
    }
  }

  if (apiKeys?.length) {
    for (const { vault_secret_name: secretName } of apiKeys) {
      const { error: vaultError } = await supabase.rpc('delete_secret', {
        secret_name: secretName,
      })

      if (vaultError) {
        const message = vaultError.message?.toLowerCase() ?? ''

        if (message.includes('secret not found')) {
          console.warn('[Account] delete_secret reported missing secret', {
            userId: user.id,
            secretName,
          })
          continue
        }

        console.error('[Account] delete_secret failed during account removal', {
          userId: user.id,
          secretName,
          error: vaultError.message,
        })

        return {
          error: 'An error occurred while deleting Vault secret. Please try again later.',
        }
      }
    }
  }

  const admin = createAdminClient()

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)

  if (deleteError) {
    console.error('[Account] deleteUser failed', {
      userId: user.id,
      error: deleteError.message,
    })
    return { error: 'An error occurred while deleting account. Please try again later.' }
  }

  const { error: signOutError } = await supabase.auth.signOut()

  if (signOutError) {
    console.error('[Account] signOut after deletion failed', {
      userId: user.id,
      error: signOutError.message,
    })
  }

  return { success: true }
}

/**
 * Update user's custom summary prompts
 */
export async function updateSummaryPrompts(
  chunkPrompt: string | null,
  metaPrompt: string | null,
  factPrompt: string | null,
) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      chunk_summary_prompt: chunkPrompt,
      meta_summary_prompt: metaPrompt,
      fact_extraction_prompt: factPrompt,
    })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update summary prompts:', error)
    return { error: 'Failed to update summary prompts' }
  }

  revalidatePath('/dashboard/account')
  return { success: true }
}

export type RagSettingsState = {
  error: string | null
  success: boolean
}

export async function updateRagSettings(
  _prevState: RagSettingsState,
  formData: FormData,
): Promise<RagSettingsState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const enableFlag = formData.get('enable_rag')
  const rawKeyId = formData.get('voyage_key_id')

  const enableRag = enableFlag === 'true'
  const selectedKeyId =
    typeof rawKeyId === 'string' && rawKeyId.trim().length > 0 ? rawKeyId.trim() : null

  if (enableRag) {
    if (!selectedKeyId) {
      return { error: 'Please select a Voyage Embeddings key.', success: false }
    }

    const { data: key, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', selectedKeyId)
      .eq('user_id', user.id)
      .single()

    if (keyError || !key) {
      return { error: 'Could not find the selected Voyage key.', success: false }
    }

    if (key.provider !== 'voyage_embeddings') {
      return { error: 'Only Voyage Embeddings keys can be used.', success: false }
    }

    if (!key.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const updates: Partial<Profile> = {
    enable_episodic_rag: enableRag,
    voyage_embedding_api_key_id: selectedKeyId,
  }

  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update RAG settings:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
  return { error: null, success: true }
}

export type SummaryModelPreferenceState = {
  error: string | null
  success: boolean
}

export async function updateSummaryModelPreference(
  _prevState: SummaryModelPreferenceState,
  formData: FormData,
): Promise<SummaryModelPreferenceState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const rawKeyId = formData.get('summary_key_id')
  const summaryKeyId =
    typeof rawKeyId === 'string' && rawKeyId.trim().length > 0 ? rawKeyId.trim() : null

  if (summaryKeyId) {
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', summaryKeyId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (keyError || !apiKey) {
      return { error: 'Could not find the selected API key.', success: false }
    }

    if (!isLLMProvider(apiKey.provider)) {
      return { error: 'Only LLM provider keys can be selected.', success: false }
    }

    if (!apiKey.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ summary_api_key_id: summaryKeyId })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update summary model preference:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
  return { error: null, success: true }
}

export type ReprocessSettingsState = {
  error: string | null
  success: boolean
}

export async function updateReprocessSettings(
  _prevState: ReprocessSettingsState,
  formData: FormData,
): Promise<ReprocessSettingsState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const rawPrompt = formData.get('reprocess_prompt')
  const rawKeyId = formData.get('reprocess_key_id')

  const reprocessPrompt =
    typeof rawPrompt === 'string' && rawPrompt.trim().length > 0 ? rawPrompt.trim() : null
  const reprocessKeyId =
    typeof rawKeyId === 'string' && rawKeyId.trim().length > 0 ? rawKeyId.trim() : null

  if (reprocessKeyId) {
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', reprocessKeyId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (keyError || !apiKey) {
      return { error: 'Could not find the selected API key.', success: false }
    }

    if (!isLLMProvider(apiKey.provider)) {
      return { error: 'Only LLM provider keys can be selected.', success: false }
    }

    if (!apiKey.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      reprocess_prompt: reprocessPrompt,
      reprocess_api_key_id: reprocessKeyId,
    })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update reprocess settings:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
  return { error: null, success: true }
}

export type TranslationModelPreferenceState = {
  error: string | null
  success: boolean
}

export async function updateTranslationModelPreference(
  _prevState: TranslationModelPreferenceState,
  formData: FormData,
): Promise<TranslationModelPreferenceState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const rawKeyId = formData.get('translation_key_id')
  const translationKeyId =
    typeof rawKeyId === 'string' && rawKeyId.trim().length > 0 ? rawKeyId.trim() : null

  if (translationKeyId) {
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('id, provider, is_active')
      .eq('id', translationKeyId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (keyError || !apiKey) {
      return { error: 'Could not find the selected API key.', success: false }
    }

    if (!isLLMProvider(apiKey.provider)) {
      return { error: 'Only LLM provider keys can be selected.', success: false }
    }

    if (!apiKey.is_active) {
      return { error: 'Inactive API keys cannot be used.', success: false }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      translation_api_key_id: translationKeyId,
    })
    .eq('id', user.id)

  if (error) {
    console.error('[Account] Failed to update translation model preference:', error)
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidatePath('/dashboard/account')
  return { error: null, success: true }
}

export async function changePassword(formData: FormData) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.' }
  }

  const newPassword = formData.get('new_password') as string

  if (!newPassword || newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters.' }
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (error) {
    console.error('[Account] Failed to change password:', error)
    return { error: 'An error occurred while changing password.' }
  }

  return { success: true }
}
