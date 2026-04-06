'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { submitFeedback, type FeedbackFormState } from './feedback/actions'
import { MAX_FEEDBACK_LENGTH } from './feedback/config'

const INITIAL_FORM_STATE: FeedbackFormState = {
  error: null,
  success: false,
}

export default function FeedbackBox() {
  const [message, setMessage] = useState('')
  const formRef = useRef<HTMLFormElement | null>(null)
  const [formState, formAction] = useActionState<FeedbackFormState, FormData>(
    submitFeedback,
    INITIAL_FORM_STATE,
  )

  useEffect(() => {
    if (!formState.success) {
      return
    }

    formRef.current?.reset()
    setMessage('')
  }, [formState.success])

  const charactersLeft = MAX_FEEDBACK_LENGTH - message.length

  return (
    <section className="mb-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900/60">
        <p className="text-lg font-semibold text-gray-900 dark:text-white">Having issues?</p>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Every suggestion directly influences our product roadmap. Share your frustrations or
          feature requests and a developer will review them right away.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-4 text-sm text-gray-500 dark:text-gray-400">
          <li>Even small inconveniences are welcome.</li>
          <li>Include your email if you need a response within 3 minutes.</li>
          <li>A developer will personally review and respond within 24 hours.</li>
        </ul>
      </div>

      <form
        action={formAction}
        ref={formRef}
        className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
      >
        <input type="hidden" name="source_page" value="/dashboard" />
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-semibold text-gray-900 dark:text-white">Feedback Box</p>
          <div className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
            {charactersLeft} chars left
          </div>
        </div>

        {formState.error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800/80 dark:bg-red-900/20 dark:text-red-300"
          >
            {formState.error}
          </p>
        )}

        {formState.success && (
          <p
            role="status"
            className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300"
          >
            Thank you for your feedback! A developer will review it soon.
          </p>
        )}

        <label htmlFor="feedback-message" className="sr-only">
          Enter feedback
        </label>
        <textarea
          id="feedback-message"
          name="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={MAX_FEEDBACK_LENGTH}
          rows={5}
          placeholder="e.g., When I start a new chat, the first message gets sent twice."
          className="w-full rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2 text-sm text-gray-900 shadow-inner focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:bg-gray-900"
          required
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Never enter personal information or API keys. Only leave feedback for service
          improvements.
        </p>

        <div className="mt-4">
          <SubmitButton />
        </div>
      </form>
    </section>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Sending...' : 'Send Feedback'}
    </button>
  )
}
