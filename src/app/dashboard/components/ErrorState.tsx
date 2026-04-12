'use client'

import React, { type HTMLAttributes, type ReactNode } from 'react'
import SurfaceCard from './SurfaceCard'
import { cx } from './classNames'

interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export default function ErrorState({
  title,
  description,
  action,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <SurfaceCard tone="subtle" padding="lg" className={cx('text-center', className)} {...props}>
      <div role="alert" className="mx-auto max-w-md space-y-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
            {title}
          </h2>
          {description ? (
            <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">{description}</p>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </SurfaceCard>
  )
}
