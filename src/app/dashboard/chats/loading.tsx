import React from 'react'

export default function RecentConversationsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-5xl animate-pulse px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 h-8 w-64 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="space-y-3" aria-label="Loading recent conversations">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-24 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
