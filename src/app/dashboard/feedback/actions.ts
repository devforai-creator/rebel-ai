'use server'

import { createClient } from '@/lib/supabase/server'
import { MAX_FEEDBACK_LENGTH } from './config'

export type FeedbackFormState = {
  error: string | null
  success: boolean
}

export async function submitFeedback(
  _prevState: FeedbackFormState,
  formData: FormData,
): Promise<FeedbackFormState> {
  const rawMessage = formData.get('message')
  const sourcePageRaw = formData.get('source_page')

  if (typeof rawMessage !== 'string') {
    return { error: 'Please enter feedback.', success: false }
  }

  const normalizedMessage = rawMessage.trim()

  if (!normalizedMessage) {
    return { error: 'Please write feedback content.', success: false }
  }

  if (normalizedMessage.length > MAX_FEEDBACK_LENGTH) {
    return {
      error: `Feedback must be ${MAX_FEEDBACK_LENGTH} characters or less.`,
      success: false,
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required.', success: false }
  }

  const sourcePage =
    typeof sourcePageRaw === 'string' && sourcePageRaw.trim().length > 0
      ? sourcePageRaw.slice(0, 120)
      : null

  const { error } = await supabase.from('user_feedback').insert({
    user_id: user.id,
    message: normalizedMessage,
    source_page: sourcePage,
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
