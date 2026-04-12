'use client'

import React, { type HTMLAttributes } from 'react'
import { cx } from './classNames'

export type InlineFeedbackTone = 'error' | 'success' | 'warning' | 'info'

type InlineFeedbackClassOptions = {
  tone?: InlineFeedbackTone
  className?: string
}

const BASE_CLASS_NAME = 'rounded-lg border px-4 py-3 text-sm'

const TONE_CLASS_NAMES: Record<InlineFeedbackTone, string> = {
  error:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
  success:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
}

export function inlineFeedbackClassName({
  tone = 'info',
  className,
}: InlineFeedbackClassOptions = {}) {
  return cx(BASE_CLASS_NAME, TONE_CLASS_NAMES[tone], className)
}

type InlineFeedbackProps = HTMLAttributes<HTMLDivElement> & InlineFeedbackClassOptions

export default function InlineFeedback({
  tone = 'info',
  className,
  role,
  ...props
}: InlineFeedbackProps) {
  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : 'status')}
      aria-live="polite"
      className={inlineFeedbackClassName({ tone, className })}
      {...props}
    />
  )
}
