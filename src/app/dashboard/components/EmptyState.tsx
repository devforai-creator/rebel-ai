'use client'

import React, { type HTMLAttributes, type ReactNode } from 'react'
import SurfaceCard from './SurfaceCard'
import { cx } from './classNames'

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
}

export default function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <SurfaceCard
      tone="dashed"
      padding={compact ? 'md' : 'lg'}
      className={cx('text-center shadow-none', className)}
      {...props}
    >
      <div
        role="status"
        aria-live="polite"
        className={cx(
          'mx-auto flex flex-col items-center',
          compact ? 'max-w-sm gap-2' : 'max-w-md gap-3',
        )}
      >
        {icon ? <div className="text-slate-400 dark:text-slate-500">{icon}</div> : null}
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">
            {title}
          </h3>
          {description ? (
            <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">{description}</p>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </SurfaceCard>
  )
}
