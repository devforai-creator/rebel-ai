'use server'

import { z } from 'zod'
import { getFormDataErrorMessage, safeParseFormData } from '@/lib/form-data'
import { createClient } from '@/lib/supabase/server'
import { MAX_FEEDBACK_LENGTH } from './config'

export type FeedbackFormState = {
  error: string | null
  success: boolean
}

const feedbackFormSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Please write feedback content.')
    .max(MAX_FEEDBACK_LENGTH, `Feedback must be ${MAX_FEEDBACK_LENGTH} characters or less.`),
  source_page: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim()
      return trimmed && trimmed.length > 0 ? trimmed.slice(0, 120) : null
    }),
})

function parseFeedbackFormData(
  formData: FormData,
): { success: true; data: z.infer<typeof feedbackFormSchema> } | { success: false; error: string } {
  const parsed = safeParseFormData(formData, feedbackFormSchema)

  if (!parsed.success) {
    return {
      error: getFeedbackFormErrorMessage(parsed.error),
      success: false as const,
    }
  }

  return { success: true as const, data: parsed.data }
}

function getFeedbackFormErrorMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0]
  const field = typeof firstIssue?.path[0] === 'string' ? firstIssue.path[0] : null

  if (field === 'message' && firstIssue.code === 'invalid_type') {
    return 'Please enter feedback.'
  }

  return getFormDataErrorMessage(error, 'Please check your feedback and try again.')
}

export async function submitFeedback(
  _prevState: FeedbackFormState,
  formData: FormData,
): Promise<FeedbackFormState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const parsedForm = parseFeedbackFormData(formData)

  if (!parsedForm.success) {
    return { error: parsedForm.error, success: false }
  }

  const { error } = await supabase.from('user_feedback').insert({
    user_id: user.id,
    message: parsedForm.data.message,
    source_page: parsedForm.data.source_page,
  })

  if (error) {
    console.error('[feedback] failed to insert', error)
    return {
      error: 'Failed to save feedback. Please try again later.',
      success: false,
    }
  }

  return { error: null, success: true }
}
