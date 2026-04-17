'use client'

import React, { memo, type ChangeEvent, type FormEvent, type RefObject } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'

const QUICK_INSERT_SYMBOLS = [
  { symbol: '"', label: 'Insert double quote' },
  { symbol: "'", label: 'Insert apostrophe' },
  { symbol: '*', label: 'Insert asterisk' },
] as const

export interface ChatComposerProps {
  composerRef: RefObject<HTMLTextAreaElement | null>
  input: string
  isLoading: boolean
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onQuickInsert: (
    text: string,
    selectionStart?: number | null,
    selectionEnd?: number | null,
  ) => void
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void
}

export function shouldSubmitChatComposerOnEnter({
  key,
  shiftKey,
  isComposing = false,
  mobileViewport = false,
}: {
  key: string
  shiftKey: boolean
  isComposing?: boolean
  mobileViewport?: boolean
}): boolean {
  return key === 'Enter' && !shiftKey && !isComposing && !mobileViewport
}

function isCompactComposerViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(max-width: 639px)').matches
}

export const ChatComposer = memo(function ChatComposer({
  composerRef,
  input,
  isLoading,
  onInputChange,
  onQuickInsert,
  onSubmit,
}: ChatComposerProps) {
  const submitLabel = isLoading ? 'Sending message' : 'Send message'
  const handleQuickInsert = (text: string) => {
    const composer = composerRef.current
    const selectionStart = composer?.selectionStart ?? input.length
    const selectionEnd = composer?.selectionEnd ?? selectionStart
    const nextCursorPosition = selectionStart + text.length

    onQuickInsert(text, selectionStart, selectionEnd)

    if (!composer || typeof window === 'undefined') {
      return
    }

    window.requestAnimationFrame(() => {
      composer.focus()
      composer.setSelectionRange(nextCursorPosition, nextCursorPosition)
    })
  }

  return (
    <div className="border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4">
      <form onSubmit={onSubmit} className="max-w-4xl mx-auto">
        <div className="flex items-end gap-2 sm:gap-3">
          <textarea
            ref={composerRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={(event) => {
              const isComposing =
                'isComposing' in event.nativeEvent
                  ? Boolean((event.nativeEvent as KeyboardEvent).isComposing)
                  : false

              if (
                shouldSubmitChatComposerOnEnter({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing,
                  mobileViewport: isCompactComposerViewport(),
                })
              ) {
                event.preventDefault()
                void onSubmit()
              }
            }}
            placeholder="Type a message..."
            rows={1}
            className="max-h-[60vh] w-full flex-1 resize-none overflow-y-auto rounded-2xl border border-gray-300 px-4 py-3.5 text-base leading-6 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            disabled={isLoading}
          />
          <button
            type="submit"
            aria-label={submitLabel}
            title={submitLabel}
            disabled={isLoading || !input.trim()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[96px] sm:w-auto sm:px-5 sm:rounded-lg"
          >
            <span className="sm:hidden" aria-hidden="true">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </span>
            <span className="hidden sm:inline">{isLoading ? 'Sending...' : 'Send'}</span>
          </button>
        </div>
        <div className="mt-2 flex gap-2 sm:hidden" aria-label="Quick insert symbols">
          {QUICK_INSERT_SYMBOLS.map(({ symbol, label }) => (
            <button
              key={symbol}
              type="button"
              aria-label={label}
              title={label}
              disabled={isLoading}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => handleQuickInsert(symbol)}
              className="inline-flex min-w-10 items-center justify-center rounded-full border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {symbol}
            </button>
          ))}
        </div>
      </form>
    </div>
  )
})
