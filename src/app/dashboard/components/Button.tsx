'use client'

import React, { type ButtonHTMLAttributes } from 'react'
import { cx } from './classNames'

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'ghostDestructive'

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

type ButtonClassOptions = {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
}

const BASE_CLASS_NAME =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-[-0.01em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-900'

const VARIANT_CLASS_NAMES: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white shadow-[0_16px_34px_-18px_rgba(37,99,235,0.78)] hover:bg-blue-700 focus-visible:ring-blue-500',
  secondary:
    'border border-gray-300 bg-white/90 text-gray-700 shadow-sm backdrop-blur-sm hover:bg-gray-50 focus-visible:ring-gray-400 dark:border-gray-600 dark:bg-gray-800/90 dark:text-gray-200 dark:hover:bg-gray-700',
  destructive:
    'bg-red-600 text-white shadow-[0_16px_34px_-18px_rgba(220,38,38,0.72)] hover:bg-red-700 focus-visible:ring-red-500 dark:bg-red-500 dark:hover:bg-red-600',
  ghost:
    'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-400 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
  ghostDestructive:
    'text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300',
}

const SIZE_CLASS_NAMES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-sm',
  icon: 'h-9 w-9 text-sm',
}

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonClassOptions = {}) {
  return cx(
    BASE_CLASS_NAME,
    VARIANT_CLASS_NAMES[variant],
    SIZE_CLASS_NAMES[size],
    fullWidth && 'w-full',
    className,
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonClassOptions

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      {...props}
    />
  )
}
