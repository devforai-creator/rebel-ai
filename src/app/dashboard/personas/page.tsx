import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { resolveDashboardReturnPath } from '@/lib/navigation/dashboard-return'
import PersonaList from './PersonaList'

interface Props {
  searchParams: Promise<{ returnTo?: string }>
}

export default async function PersonasPage({ searchParams }: Props) {
  const { returnTo } = await searchParams
  const returnHref = resolveDashboardReturnPath(returnTo)
  const returnPathname = returnHref.split(/[?#]/, 1)[0]
  const returnLabel =
    returnPathname === '/dashboard/chats/new'
      ? '← 새 채팅으로 돌아가기'
      : returnPathname.startsWith('/dashboard/chats/')
        ? '← 채팅으로 돌아가기'
        : '← Dashboard'
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch user's personas
  const { data: personas } = await supabase
    .from('personas')
    .select('id, name, description, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('name', { ascending: true })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={returnHref}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                {returnLabel}
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Persona Management
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Set up your character profile to use in chats
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PersonaList initialPersonas={personas || []} />
      </main>
    </div>
  )
}
