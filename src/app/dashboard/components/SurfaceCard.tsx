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

const BASE_CLASS_NAME = 'rounded-[1.25rem] border'

const TONE_CLASS_NAMES: Record<SurfaceCardTone, string> = {
  default:
    'border-slate-200/80 bg-white/88 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)] backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-950/72 dark:shadow-[0_26px_60px_-44px_rgba(2,6,23,0.9)]',
  subtle:
    'border-white/70 bg-white/55 shadow-none backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-950/45',
  dashed:
    'border-dashed border-slate-300/90 bg-white/65 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/45',
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
