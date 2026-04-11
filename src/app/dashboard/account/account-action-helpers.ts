import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getFormDataErrorMessage, safeParseFormData } from '@/lib/form-data'
import type { Profile } from '@/types/database.types'
import { createClient } from '@/lib/supabase/server'

export const optionalTrimmedStringSchema = z
  .string()
  .optional()
  .transform((value) => normalizeOptionalString(value))

export type AccountActionSupabase = Awaited<ReturnType<typeof createClient>>
export type AccountActionFailureResult = { error: string; success: false }
export type BasicAccountActionResult =
  | { success: true; error?: undefined }
  | { error: string; success?: false }

export function revalidateAccountSettingsPage() {
  revalidatePath('/dashboard/account')
}

export async function createAuthenticatedAccountContext<TResult extends { error: string }>(
  failureResult: TResult,
): Promise<
  | {
      supabase: AccountActionSupabase
      userId: string
    }
  | TResult
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return failureResult
  }

  return {
    supabase,
    userId: user.id,
  }
}

export async function validateSelectedApiKey({
  supabase,
  userId,
  apiKeyId,
  missingMessage,
  providerMismatchMessage,
  inactiveMessage,
  lookupMode = 'maybeSingle',
  isProviderAllowed,
}: {
  supabase: Pick<AccountActionSupabase, 'from'>
  userId: string
  apiKeyId: string | null
  missingMessage: string
  providerMismatchMessage: string
  inactiveMessage: string
  lookupMode?: 'single' | 'maybeSingle'
  isProviderAllowed: (provider: string) => boolean
}): Promise<AccountActionFailureResult | null> {
  if (!apiKeyId) {
    return null
  }

  const query = supabase
    .from('api_keys')
    .select('id, provider, is_active')
    .eq('id', apiKeyId)
    .eq('user_id', userId)

  const { data: apiKey, error: keyError } =
    lookupMode === 'single' ? await query.single() : await query.maybeSingle()

  if (keyError || !apiKey) {
    return { error: missingMessage, success: false }
  }

  if (!isProviderAllowed(apiKey.provider)) {
    return { error: providerMismatchMessage, success: false }
  }

  if (!apiKey.is_active) {
    return { error: inactiveMessage, success: false }
  }

  return null
}

export async function updateProfileForUser({
  supabase,
  userId,
  updates,
  logLabel,
}: {
  supabase: Pick<AccountActionSupabase, 'from'>
  userId: string
  updates: Partial<Profile>
  logLabel: string
}) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId)

  if (error) {
    console.error(logLabel, error)
  }

  return error
}

export function normalizeOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

export function parseAccountFormData<TSchema extends z.ZodTypeAny>(
  formData: FormData,
  schema: TSchema,
  fallbackMessage: string,
): { data: z.infer<TSchema> } | { error: string; success: false } {
  const parsed = safeParseFormData(formData, schema)

  if (!parsed.success) {
    return {
      error: getFormDataErrorMessage(parsed.error, fallbackMessage),
      success: false,
    }
  }

  return { data: parsed.data }
}

export function getAccountFormErrorMessage(error: z.ZodError, fallbackMessage: string): string {
  const firstIssue = error.issues[0]
  const field = typeof firstIssue?.path[0] === 'string' ? firstIssue.path[0] : null

  if (field === 'new_password') {
    return 'Password must be at least 6 characters.'
  }

  return getFormDataErrorMessage(error, fallbackMessage)
}
