'use client'

import { useState, useEffect, ReactNode } from 'react'
import Link from 'next/link'

interface ChatHeaderProps {
  characterId: string
  characterName: string
  chatTitle: string | null
  children: ReactNode // Action buttons
}

const STORAGE_KEY = 'rebelai-chat-header-open'

export default function ChatHeader({
  characterId,
  characterName,
  chatTitle,
  children,
}: ChatHeaderProps) {
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

  if (!isOpen) {
    // Collapsed state - minimal bar
    return (
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/characters/${characterId}`}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
            >
              ← {characterName}
            </Link>
            <span className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
              {chatTitle}
            </span>
          </div>
          <button
            onClick={() => setIsOpen(true)}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Expand header"
            title="Expand header"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      </header>
    )
  }

  // Expanded state - full header
  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/dashboard/characters/${characterId}`}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← {characterName}
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{characterName}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">{chatTitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {children}
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Collapse header"
              title="Collapse header"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 15l7-7 7 7"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
