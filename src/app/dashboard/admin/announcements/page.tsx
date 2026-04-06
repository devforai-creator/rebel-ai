import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AnnouncementAdminPanel, { type AnnouncementListItem } from './AnnouncementAdminPanel'

export default async function AdminAnnouncementsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, display_name')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    redirect('/dashboard')
  }

  const { data: announcements } = await supabase
    .from('announcements')
    .select(
      'id, message, cta_label, cta_url, severity, is_active, starts_at, ends_at, created_at, updated_at',
    )
    .order('created_at', { ascending: false })
    .limit(50)
  const initialAnnouncements: AnnouncementListItem[] = announcements ?? []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm"
          >
            ← Dashboard
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Admin Announcement Center
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Manage urgent alerts and maintenance notices without SQL.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnnouncementAdminPanel initialAnnouncements={initialAnnouncements} />
      </main>
    </div>
  )
}
