'use client'

import React, { memo, type ChangeEvent, type FormEvent, type RefObject } from 'react'

export interface ChatComposerProps {
  composerRef: RefObject<HTMLTextAreaElement | null>
  input: string
  isLoading: boolean
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void
}

export const ChatComposer = memo(function ChatComposer({
  composerRef,
  input,
  isLoading,
  onInputChange,
  onSubmit,
}: ChatComposerProps) {
  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
      <form onSubmit={onSubmit} className="max-w-4xl mx-auto">
        <div className="flex flex-col gap-3 sm:flex-row">
          <textarea
            ref={composerRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void onSubmit()
              }
            }}
            placeholder="Enter your message... (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="w-full flex-1 px-4 py-3 text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none max-h-[60vh] overflow-y-auto"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:self-end"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
})
