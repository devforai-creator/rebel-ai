'use client'

import { useMemo, useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import type { AnnouncementPayload, AnnouncementResponse } from '@/lib/announcements/contracts'
import { createApiError } from '@/lib/http/api-contract'

const fetchAnnouncement = async (url: string): Promise<AnnouncementPayload | null> => {
  const response = await fetch(url, { cache: 'no-store' })

  if (!response.ok) {
    if (response.status === 401) {
      return null
    }
    throw await createApiError(response, 'Failed to load announcement')
  }

  const payload = (await response.json()) as AnnouncementResponse
  return payload.announcement ?? null
}

const severityTokens = {
  info: {
    wrapper: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400',
    icon: 'text-blue-500',
    text: 'text-blue-900 dark:text-blue-100',
    description: 'text-blue-800 dark:text-blue-200',
    link: 'text-blue-700 dark:text-blue-200',
    button: 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500',
  },
  warning: {
    wrapper: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-400',
    icon: 'text-yellow-500',
    text: 'text-yellow-900 dark:text-yellow-200',
    description: 'text-yellow-800 dark:text-yellow-200',
    link: 'text-yellow-700 dark:text-yellow-200',
    button: 'bg-yellow-600 hover:bg-yellow-700 focus-visible:ring-yellow-500',
  },
  critical: {
    wrapper: 'bg-red-50 dark:bg-red-900/25 border-red-500',
    icon: 'text-red-500',
    text: 'text-red-900 dark:text-red-100',
    description: 'text-red-800 dark:text-red-200',
    link: 'text-red-700 dark:text-red-200',
    button: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500',
  },
} as const

export default function AnnouncementBanner() {
  const { data: announcement } = useSWR<AnnouncementPayload | null>(
    '/api/announcements',
    fetchAnnouncement,
    {
      revalidateOnFocus: false,
    },
  )

  const [isDismissed, setIsDismissed] = useState(false)

  const dismissalKey = useMemo(() => {
    return announcement ? `announcement-dismissed-${announcement.id}` : null
  }, [announcement])

  useEffect(() => {
    if (!dismissalKey || !announcement) {
      setIsDismissed(false)
      return
    }
    const stored = localStorage.getItem(dismissalKey)
    setIsDismissed(stored === 'true')
  }, [dismissalKey, announcement])

  if (!announcement) {
    return null
  }

  const style = severityTokens[announcement.severity] ?? severityTokens.info

  const handleDismiss = () => {
    if (dismissalKey) {
      localStorage.setItem(dismissalKey, 'true')
    }
    setIsDismissed(true)
  }

  const handleRestore = () => {
    if (dismissalKey) {
      localStorage.removeItem(dismissalKey)
    }
    setIsDismissed(false)
  }

  if (isDismissed) {
    return (
      <div
        className={`border-l-4 p-3 mb-6 rounded flex items-center justify-between ${style.wrapper}`}
      >
        <p className={`text-xs font-medium ${style.description}`}>This announcement is hidden.</p>
        <button
          onClick={handleRestore}
          className={`text-xs font-semibold underline underline-offset-4 ${style.link}`}
        >
          Show announcement
        </button>
      </div>
    )
  }

  const isExternalLink = announcement.ctaUrl ? /^https?:\/\//.test(announcement.ctaUrl) : false

  const ActionButton = () => {
    if (!announcement.ctaUrl || !announcement.ctaLabel) {
      return null
    }

    const baseClass = `inline-flex items-center px-3 py-1.5 text-sm font-medium text-white rounded shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${style.button}`

    const contents = (
      <>
        {announcement.ctaLabel}
        <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 12h14M12 5l7 7-7 7"
          />
        </svg>
      </>
    )

    return isExternalLink ? (
      <a href={announcement.ctaUrl} target="_blank" rel="noopener noreferrer" className={baseClass}>
        {contents}
      </a>
    ) : (
      <Link href={announcement.ctaUrl} className={baseClass}>
        {contents}
      </Link>
    )
  }

  return (
    <div className={`border-l-4 p-4 mb-6 rounded ${style.wrapper}`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 ${style.icon}`}>
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 2a8 8 0 018 8v3.586l.707.707A1 1 0 0118.586 16H1.414a1 1 0 01-.707-1.707L1.414 13V10a8 8 0 018-8zm-.75 5.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5zm.75 6a1 1 0 100 2 1 1 0 000-2z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="flex-1">
          <p className={`text-sm font-semibold mb-1 ${style.text}`}>Service Announcement</p>
          <p className={`text-sm whitespace-pre-line ${style.description}`}>
            {announcement.message}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 items-center">
            <ActionButton />
            <button
              onClick={handleDismiss}
              className={`text-xs font-medium underline underline-offset-4 ${style.link}`}
            >
              Hide this announcement
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
