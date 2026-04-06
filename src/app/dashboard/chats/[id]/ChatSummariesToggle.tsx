'use client'

import { useState, useEffect, ReactNode } from 'react'

interface ChatSummariesToggleProps {
  children: ReactNode
}

const STORAGE_KEY = 'rebelai-summaries-panel-open'

export default function ChatSummariesToggle({ children }: ChatSummariesToggleProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Load saved state from localStorage
  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) {
      setIsOpen(saved === 'true')
    }
  }, [])

  // Save state to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(STORAGE_KEY, String(isOpen))
    }
  }, [isOpen, mounted])

  const togglePanel = () => setIsOpen(!isOpen)

  return (
    <>
      {/* Toggle Button - Fixed position on right edge */}
      <button
        onClick={togglePanel}
        className={`hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-40 items-center justify-center w-6 h-16 bg-white dark:bg-gray-800 border border-r-0 border-gray-200 dark:border-gray-700 rounded-l-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-all ${
          isOpen ? 'right-96' : 'right-0'
        }`}
        aria-label={isOpen ? 'Close summary panel' : 'Open summary panel'}
        title={isOpen ? 'Close summary panel' : 'Open summary panel'}
      >
        <svg
          className={`w-4 h-4 text-gray-600 dark:text-gray-400 transition-transform ${
            isOpen ? 'rotate-0' : 'rotate-180'
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Panel Container */}
      <div
        className={`hidden lg:block transition-all duration-300 ease-in-out ${
          isOpen ? 'w-96 opacity-100' : 'w-0 opacity-0 overflow-hidden'
        }`}
      >
        {isOpen && children}
      </div>

      {/* Mobile Toggle Button */}
      <button
        onClick={togglePanel}
        className="lg:hidden fixed bottom-20 right-4 z-40 w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
        aria-label={isOpen ? 'Close summary panel' : 'Open summary panel'}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
      </button>

      {/* Mobile Panel (overlay) */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black bg-opacity-50"
            onClick={() => setIsOpen(false)}
          />
          {/* Panel */}
          <div className="absolute right-0 top-0 bottom-0 w-80 max-w-[90vw] bg-white dark:bg-gray-800 shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Long-term Memory Summary
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  )
}
