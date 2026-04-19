'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InlineFeedbackTone } from '@/app/dashboard/components/InlineFeedback'

type ActionStateFeedbackLike = {
  error?: string | null
  success?: boolean
}

export type FormFeedback = {
  message: string
  tone: InlineFeedbackTone
}

export function resolveActionStateFeedback(
  state: ActionStateFeedbackLike,
  options: { successMessage: string },
): FormFeedback | null {
  if (state.error) {
    return {
      message: state.error,
      tone: 'error',
    }
  }

  if (state.success) {
    return {
      message: options.successMessage,
      tone: 'success',
    }
  }

  return null
}

export function useActionStateFeedback(
  state: ActionStateFeedbackLike,
  options: { successMessage: string },
) {
  const feedback = useMemo(
    () => resolveActionStateFeedback(state, options),
    [options.successMessage, state.error, state.success],
  )
  const feedbackKey = feedback ? `${feedback.tone}:${feedback.message}` : null
  const [dismissedFeedbackKey, setDismissedFeedbackKey] = useState<string | null>(null)

  useEffect(() => {
    setDismissedFeedbackKey(null)
  }, [feedbackKey])

  const clearFeedback = useCallback(() => {
    if (!feedbackKey) {
      return
    }

    setDismissedFeedbackKey(feedbackKey)
  }, [feedbackKey])

  return {
    feedback: feedbackKey && dismissedFeedbackKey === feedbackKey ? null : feedback,
    clearFeedback,
  }
}
