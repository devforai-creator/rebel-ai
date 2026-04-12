'use client'

import React, { type HTMLAttributes, type ReactNode } from 'react'
import SurfaceCard from './SurfaceCard'
import { cx } from './classNames'

interface LoadingStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  compact?: boolean
  children?: ReactNode
}

export default function LoadingState({
  title,
  description,
  compact = false,
  className,
  children,
  ...props
}: LoadingStateProps) {
  return (
    <SurfaceCard tone="subtle" padding={compact ? 'md' : 'lg'} className={cx(className)} {...props}>
      <div role="status" aria-live="polite" className={cx('space-y-4', compact && 'space-y-3')}>
        <div className="flex items-start gap-3">
          <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-blue-500 animate-pulse" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
            {description ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
            ) : null}
          </div>
        </div>
        {children ? <div className="animate-pulse">{children}</div> : null}
      </div>
    </SurfaceCard>
  )
}
