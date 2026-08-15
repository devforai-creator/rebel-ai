import Link from 'next/link'
import { redirect } from 'next/navigation'
import React from 'react'

import { loadRecentConversationCharacters } from '@/lib/chat/recent-characters'
import { createClient } from '@/lib/supabase/server'
import RecentCharactersList from './RecentCharactersList'

export default async function RecentConversationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/auth/login')
  }

  const initialPage = await loadRecentConversationCharacters({ supabase })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white shadow dark:bg-gray-800">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Recent Conversations</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-gray-600 dark:text-gray-400">
            Characters are ordered by the latest message across all of your chats with them.
          </p>
        </div>

        <RecentCharactersList
          initialCharacters={initialPage.characters}
          initialHasMore={initialPage.hasMore}
          initialNextCursor={initialPage.nextCursor}
          referenceTimeMs={Date.now()}
        />
      </main>
    </div>
  )
}
