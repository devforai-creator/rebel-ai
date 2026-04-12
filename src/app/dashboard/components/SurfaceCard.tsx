'use client'

import React, { type HTMLAttributes } from 'react'
import { cx } from './classNames'

export type SurfaceCardTone = 'default' | 'subtle' | 'dashed'
export type SurfaceCardPadding = 'none' | 'sm' | 'md' | 'lg'

type SurfaceCardClassOptions = {
  tone?: SurfaceCardTone
  padding?: SurfaceCardPadding
  className?: string
}

const BASE_CLASS_NAME = 'rounded-lg border'

const TONE_CLASS_NAMES: Record<SurfaceCardTone, string> = {
  default: 'border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800',
  subtle: 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900',
  dashed: 'border-dashed border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800',
}

const PADDING_CLASS_NAMES: Record<SurfaceCardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export function surfaceCardClassName({
  tone = 'default',
  padding = 'md',
  className,
}: SurfaceCardClassOptions = {}) {
  return cx(BASE_CLASS_NAME, TONE_CLASS_NAMES[tone], PADDING_CLASS_NAMES[padding], className)
}

type SurfaceCardProps = HTMLAttributes<HTMLDivElement> & SurfaceCardClassOptions

export default function SurfaceCard({
  tone = 'default',
  padding = 'md',
  className,
  ...props
}: SurfaceCardProps) {
  return <div className={surfaceCardClassName({ tone, padding, className })} {...props} />
}
