import Link from 'next/link'
import React, { type ReactNode } from 'react'
import SurfaceCard from './SurfaceCard'
import { cx } from './classNames'

type DashboardPageWidth = 'narrow' | 'content' | 'wide'
type DashboardCalloutTone = 'info' | 'warm' | 'neutral'

const WIDTH_CLASS_NAMES: Record<DashboardPageWidth, string> = {
  narrow: 'max-w-3xl',
  content: 'max-w-5xl',
  wide: 'max-w-7xl',
}

const CALLOUT_CLASS_NAMES: Record<DashboardCalloutTone, string> = {
  info: 'border-sky-200/80 bg-sky-50/90 text-sky-950 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-50',
  warm: 'border-amber-200/80 bg-amber-50/90 text-amber-950 dark:border-amber-900/80 dark:bg-amber-950/35 dark:text-amber-50',
  neutral:
    'border-slate-200/80 bg-white/85 text-slate-950 dark:border-slate-800/80 dark:bg-slate-950/45 dark:text-slate-50',
}

export const dashboardPageBackgroundClassName =
  'min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_22%),linear-gradient(180deg,#f8fafc_0%,#eef4ff_48%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_18%),radial-gradient(circle_at_top_right,rgba(37,99,235,0.18),transparent_22%),linear-gradient(180deg,#020617_0%,#0f172a_55%,#111827_100%)]'

interface DashboardPageShellProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  backHref?: string
  backLabel?: ReactNode
  width?: DashboardPageWidth
  children: ReactNode
  className?: string
}

export function dashboardPageShellContentClassName(width: DashboardPageWidth = 'wide') {
  return cx('mx-auto px-4 py-8 sm:px-6 lg:px-8 lg:py-10', WIDTH_CLASS_NAMES[width])
}

export function DashboardPageShell({
  title,
  description,
  eyebrow,
  actions,
  backHref = '/dashboard',
  backLabel = 'Back to Dashboard',
  width = 'wide',
  children,
  className,
}: DashboardPageShellProps) {
  return (
    <div className={cx(dashboardPageBackgroundClassName, className)}>
      <div className={dashboardPageShellContentClassName(width)}>
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:text-slate-950 dark:border-slate-800/80 dark:bg-slate-950/45 dark:text-slate-300 dark:hover:text-white"
        >
          <span aria-hidden>←</span>
          {backLabel}
        </Link>

        <SurfaceCard
          padding="none"
          className="mt-5 overflow-hidden bg-white/82 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.45)] backdrop-blur-sm dark:bg-slate-950/68"
        >
          <div className="px-6 py-7 sm:px-8 sm:py-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                {eyebrow ? (
                  <div className="inline-flex items-center rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300">
                    {eyebrow}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-[2rem]">
                    {title}
                  </h1>
                  {description ? (
                    <p className="max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                      {description}
                    </p>
                  ) : null}
                </div>
              </div>
              {actions ? (
                <div className="flex flex-wrap items-center gap-3 lg:justify-end">{actions}</div>
              ) : null}
            </div>
          </div>
        </SurfaceCard>

        <div className="mt-8 space-y-8">{children}</div>
      </div>
    </div>
  )
}

interface DashboardSectionHeadingProps {
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  className?: string
}

export function DashboardSectionHeading({
  title,
  description,
  badge,
  actions,
  className,
}: DashboardSectionHeadingProps) {
  return (
    <div
      className={cx('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
            {title}
          </h2>
          {badge ? (
            <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:border-slate-700/80 dark:bg-slate-950/45 dark:text-slate-300">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  )
}

interface DashboardCalloutProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  tone?: DashboardCalloutTone
  children?: ReactNode
  className?: string
}

export function DashboardCallout({
  title,
  description,
  eyebrow,
  tone = 'neutral',
  children,
  className,
}: DashboardCalloutProps) {
  return (
    <SurfaceCard
      padding="lg"
      className={cx(
        'overflow-hidden border shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)] backdrop-blur-sm',
        CALLOUT_CLASS_NAMES[tone],
        className,
      )}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {eyebrow ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
              {eyebrow}
            </div>
          ) : null}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            {description ? <p className="text-sm leading-7 opacity-90">{description}</p> : null}
          </div>
        </div>
        {children ? <div className="text-sm leading-7 opacity-90">{children}</div> : null}
      </div>
    </SurfaceCard>
  )
}
