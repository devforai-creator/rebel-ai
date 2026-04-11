'use server'

import { z } from 'zod'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'
import {
  createAuthenticatedAccountContext,
  optionalTrimmedStringSchema,
  parseAccountFormData,
  revalidateAccountSettingsPage,
  type BasicAccountActionResult,
  updateProfileForUser,
  validateSelectedApiKey,
} from './account-action-helpers'

const ragSettingsFormSchema = z.object({
  enable_rag: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
  voyage_key_id: optionalTrimmedStringSchema,
})

const summaryModelPreferenceFormSchema = z.object({
  summary_key_id: optionalTrimmedStringSchema,
})

const reprocessSettingsFormSchema = z.object({
  reprocess_prompt: optionalTrimmedStringSchema,
  reprocess_key_id: optionalTrimmedStringSchema,
})

const translationModelPreferenceFormSchema = z.object({
  translation_key_id: optionalTrimmedStringSchema,
})

export async function updateSummaryPrompts(
  chunkPrompt: string | null,
  metaPrompt: string | null,
  factPrompt: string | null,
): Promise<BasicAccountActionResult> {
  const context = await createAuthenticatedAccountContext({ error: 'Unauthorized' })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: {
      chunk_summary_prompt: chunkPrompt,
      meta_summary_prompt: metaPrompt,
      fact_extraction_prompt: factPrompt,
    },
    logLabel: '[Account] Failed to update summary prompts:',
  })

  if (error) {
    return { error: 'Failed to update summary prompts' }
  }

  revalidateAccountSettingsPage()
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
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    ragSettingsFormSchema,
    'Please check your RAG settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const enableRag = parsedForm.data.enable_rag
  const selectedKeyId = parsedForm.data.voyage_key_id

  if (enableRag) {
    if (!selectedKeyId) {
      return { error: 'Please select a Voyage Embeddings key.', success: false }
    }

    const keyValidation = await validateSelectedApiKey({
      supabase,
      userId,
      apiKeyId: selectedKeyId,
      missingMessage: 'Could not find the selected Voyage key.',
      providerMismatchMessage: 'Only Voyage Embeddings keys can be used.',
      inactiveMessage: 'Inactive API keys cannot be used.',
      lookupMode: 'single',
      isProviderAllowed: (provider) => provider === 'voyage_embeddings',
    })

    if (keyValidation) {
      return keyValidation
    }
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: {
      enable_episodic_rag: enableRag,
      voyage_embedding_api_key_id: selectedKeyId,
    },
    logLabel: '[Account] Failed to update RAG settings:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
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
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    summaryModelPreferenceFormSchema,
    'Please check your summary model settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const keyValidation = await validateSelectedApiKey({
    supabase,
    userId,
    apiKeyId: parsedForm.data.summary_key_id,
    missingMessage: 'Could not find the selected API key.',
    providerMismatchMessage: 'Only LLM provider keys can be selected.',
    inactiveMessage: 'Inactive API keys cannot be used.',
    isProviderAllowed: isLLMProvider,
  })

  if (keyValidation) {
    return keyValidation
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: { summary_api_key_id: parsedForm.data.summary_key_id },
    logLabel: '[Account] Failed to update summary model preference:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
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
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    reprocessSettingsFormSchema,
    'Please check your reprocess settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const keyValidation = await validateSelectedApiKey({
    supabase,
    userId,
    apiKeyId: parsedForm.data.reprocess_key_id,
    missingMessage: 'Could not find the selected API key.',
    providerMismatchMessage: 'Only LLM provider keys can be selected.',
    inactiveMessage: 'Inactive API keys cannot be used.',
    isProviderAllowed: isLLMProvider,
  })

  if (keyValidation) {
    return keyValidation
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: {
      reprocess_prompt: parsedForm.data.reprocess_prompt,
      reprocess_api_key_id: parsedForm.data.reprocess_key_id,
    },
    logLabel: '[Account] Failed to update reprocess settings:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
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
  const context = await createAuthenticatedAccountContext({
    error: 'Login required.',
    success: false,
  })

  if ('error' in context) {
    return context
  }

  const { supabase, userId } = context
  const parsedForm = parseAccountFormData(
    formData,
    translationModelPreferenceFormSchema,
    'Please check your translation model settings input.',
  )

  if ('error' in parsedForm) {
    return parsedForm
  }

  const keyValidation = await validateSelectedApiKey({
    supabase,
    userId,
    apiKeyId: parsedForm.data.translation_key_id,
    missingMessage: 'Could not find the selected API key.',
    providerMismatchMessage: 'Only LLM provider keys can be selected.',
    inactiveMessage: 'Inactive API keys cannot be used.',
    isProviderAllowed: isLLMProvider,
  })

  if (keyValidation) {
    return keyValidation
  }

  const error = await updateProfileForUser({
    supabase,
    userId,
    updates: {
      translation_api_key_id: parsedForm.data.translation_key_id,
    },
    logLabel: '[Account] Failed to update translation model preference:',
  })

  if (error) {
    return { error: 'An error occurred while saving settings.', success: false }
  }

  revalidateAccountSettingsPage()
  return { error: null, success: true }
}
