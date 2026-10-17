'use client'

import React, { memo, useId, type ChangeEvent, type FormEvent, type RefObject } from 'react'
import { ArrowUp, Loader2, WandSparkles } from 'lucide-react'

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
  isDrafting?: boolean
  draftDisabledReason?: string | null
  draftError?: string | null
  onGenerateDraft?: () => void
  onCancelDraft?: () => void
  onRestoreDraftInput?: () => void
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
  isDrafting = false,
  draftDisabledReason,
  draftError,
  onGenerateDraft,
  onCancelDraft,
  onRestoreDraftInput,
}: ChatComposerProps) {
  const draftHintId = useId()
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
      <form
        onSubmit={(event) => {
          if (isDrafting) {
            event.preventDefault()
            return
          }
          onSubmit(event)
        }}
        className="max-w-4xl mx-auto"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 sm:gap-x-3">
          <div className="contents sm:flex sm:min-w-0 sm:flex-col sm:overflow-hidden sm:rounded-2xl sm:border sm:border-gray-300 sm:bg-white sm:shadow-sm sm:focus-within:ring-2 sm:focus-within:ring-blue-500 dark:sm:border-gray-600 dark:sm:bg-gray-700">
            {onGenerateDraft && (
              <div className="col-span-2 mb-2 flex flex-wrap items-center gap-3 text-sm sm:order-2 sm:mb-0 sm:justify-end sm:gap-2 sm:px-3 sm:pb-2 sm:pt-1">
                <button
                  type="button"
                  disabled={isLoading || isDrafting || Boolean(draftDisabledReason)}
                  aria-describedby={draftHintId}
                  title={
                    draftDisabledReason ??
                    '비워두면 다음 반응을 제안하고, 의도를 적으면 풀어 씁니다.'
                  }
                  onClick={onGenerateDraft}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 sm:border-transparent sm:text-xs dark:sm:border-transparent dark:sm:hover:bg-gray-600"
                >
                  {isDrafting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <WandSparkles className="h-4 w-4" />
                  )}
                  {isDrafting ? '작성 중...' : '대신 작성'}
                </button>
                {isDrafting && (
                  <button
                    type="button"
                    onClick={onCancelDraft}
                    className="min-h-9 text-gray-600 dark:text-gray-300"
                  >
                    취소
                  </button>
                )}
                {onRestoreDraftInput && !isDrafting && (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={onRestoreDraftInput}
                    className="min-h-9 text-gray-600 hover:underline disabled:opacity-50 dark:text-gray-300"
                  >
                    원문 복원
                  </button>
                )}
                <span
                  id={draftHintId}
                  className="text-xs text-gray-500 dark:text-gray-400 sm:sr-only"
                  role="status"
                >
                  {draftDisabledReason ??
                    (isDrafting
                      ? '초안을 작성하고 있습니다.'
                      : '비우면 다음 반응을, 의도를 적으면 풀어 씁니다.')}
                </span>
              </div>
            )}
            {draftError && (
              <p
                role="alert"
                className="col-span-2 mb-2 text-sm text-red-600 dark:text-red-400 sm:order-3 sm:px-4 sm:pb-2"
              >
                {draftError}
              </p>
            )}
            <div className="relative min-w-0 flex-1 sm:order-1">
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
                    if (!isDrafting) void onSubmit()
                  }
                }}
                placeholder="Type a message..."
                rows={1}
                className="max-h-[60vh] w-full resize-none overflow-y-auto rounded-2xl border border-gray-300 px-4 pt-3.5 pb-12 text-base leading-6 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:block sm:rounded-none sm:border-0 sm:py-3.5 sm:shadow-none sm:focus:ring-0"
                disabled={isLoading}
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-3 flex gap-2 px-4 sm:hidden"
                aria-label="Quick insert symbols"
              >
                {QUICK_INSERT_SYMBOLS.map(({ symbol, label }) => (
                  <button
                    key={symbol}
                    type="button"
                    aria-label={label}
                    title={label}
                    disabled={isLoading}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => handleQuickInsert(symbol)}
                    className="pointer-events-auto inline-flex min-w-9 items-center justify-center rounded-full border border-gray-200 bg-white/90 px-2.5 py-1 text-sm font-medium text-gray-700 shadow-sm backdrop-blur transition-colors hover:border-gray-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-500 dark:bg-gray-800/90 dark:text-gray-100 dark:hover:bg-gray-800"
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            type="submit"
            aria-label={submitLabel}
            title={submitLabel}
            disabled={isLoading || isDrafting || !input.trim()}
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
      </form>
    </div>
  )
})
