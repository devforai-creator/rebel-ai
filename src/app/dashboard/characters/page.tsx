import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CharacterCard, { type CharacterListItem } from './CharacterCard'

type ImportJob = {
  id: string
  status: 'pending' | 'processing' | 'success' | 'error'
  original_filename: string
  created_at: string
}

type ImportJobWithResult = ImportJob & {
  result?: {
    stats?: {
      regexLimits?: {
        total: number
        kept: number
        strippedScripts: number
        invalidPatterns: number
        trimmedPatterns: number
        missingPatterns: number
      }
      regexRejected?: Array<{
        pattern?: string
        type?: string
        reason: string
      }>
    }
    error?: string
  } | null
}

// Minimal fields for card display
const CHARACTER_CARD_FIELDS = `
  id,
  name,
  avatar_url,
  created_at,
  visibility
`

export default async function CharactersPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const [starterResult, myResult, jobsResult, recentJobsResult] = await Promise.all([
    supabase
      .from('characters')
      .select(CHARACTER_CARD_FIELDS)
      .is('user_id', null)
      .is('archived_at', null)
      .eq('visibility', 'public')
      .order('created_at', { ascending: true }),
    supabase
      .from('characters')
      .select(CHARACTER_CARD_FIELDS)
      .eq('user_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('charx_import_jobs')
      .select('id, status, original_filename, created_at')
      .eq('user_id', user.id)
      .in('status', ['pending', 'processing']),
    supabase
      .from('charx_import_jobs')
      .select('id, status, original_filename, created_at, result')
      .eq('user_id', user.id)
      .in('status', ['success', 'error'])
      .order('created_at', { ascending: false })
      .limit(3),
  ])

  if (myResult.error) {
    console.error('Error fetching characters:', myResult.error)
  }

  if (jobsResult.error) {
    console.error('Error fetching import jobs:', jobsResult.error)
  }

  if (recentJobsResult.error) {
    console.error('Error fetching completed import jobs:', recentJobsResult.error)
  }

  const starterCharacters = (starterResult.data ?? []) as CharacterListItem[]
  const myCharacters = (myResult.data ?? []) as CharacterListItem[]
  const activeJobs = (jobsResult.data ?? []) as ImportJob[]
  const recentJobs = (recentJobsResult.data ?? []) as ImportJobWithResult[]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Character Management
            </h1>
          </div>
          <Link
            href="/dashboard/characters/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            + New Character
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Info Message */}
        <div className="mb-8 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-300 mb-2">
            Characters & Simulations
          </h3>
          <p className="text-sm text-purple-800 dark:text-purple-300 mb-3">
            Create 1:1 conversation characters or multi-character simulations freely.
          </p>
          <ul className="text-sm text-purple-700 dark:text-purple-400 space-y-1">
            <li>
              * <strong>1:1 Character:</strong> Chat with a specific persona
            </li>
            <li>
              * <strong>Simulation:</strong> World with multiple characters (story writing, etc.)
            </li>
            <li>* All settings configurable in system prompt</li>
          </ul>
        </div>

        {/* Character Import Progress */}
        {activeJobs.length > 0 && (
          <div className="mb-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-5">
            <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-200 mb-2">
              Processing Character Imports
            </h3>
            <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
              Newly imported characters may have missing thumbnails or expression images until asset
              upload completes. The job will continue even if you navigate away or close the
              dashboard.
            </p>
            <ul className="space-y-2">
              {activeJobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm bg-white/60 dark:bg-gray-900/30 rounded-md px-3 py-2"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {job.original_filename}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400 text-xs">
                      Job ID: {job.id.slice(0, 8)}... Started:{' '}
                      {new Date(job.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                    {job.status === 'pending' ? 'Pending' : 'Processing'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent Character Import Results */}
        {recentJobs.length > 0 && (
          <div className="mb-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Recent Character Imports
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Completed jobs remain here briefly so you can review import outcomes after the page
              redirects.
            </p>
            <ul className="space-y-3">
              {recentJobs.map((job) => {
                const limits = job.result?.stats?.regexLimits
                const rejectedCount = job.result?.stats?.regexRejected?.length ?? 0
                const regexSummary =
                  limits && limits.total > 0
                    ? `Regex kept ${limits.kept}/${limits.total} · scripts ${limits.strippedScripts} · invalid ${limits.invalidPatterns} · trimmed ${limits.trimmedPatterns} · missing ${limits.missingPatterns}${
                        rejectedCount > 0 ? ` · examples ${Math.min(rejectedCount, 5)}` : ''
                      }`
                    : null
                const jobStatusLabel =
                  job.status === 'success'
                    ? 'Success'
                    : job.status === 'error'
                      ? 'Error'
                      : job.status === 'processing'
                        ? 'Processing'
                        : 'Pending'

                return (
                  <li
                    key={job.id}
                    className="flex flex-col gap-1 rounded-md border border-gray-100 dark:border-gray-700 px-3 py-2 bg-gray-50/60 dark:bg-gray-900/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {job.original_filename}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {new Date(job.created_at).toLocaleString()} · Job ID {job.id.slice(0, 8)}
                          ...
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                          job.status === 'success'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-100'
                            : job.status === 'error'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                        }`}
                      >
                        {jobStatusLabel}
                      </span>
                    </div>
                    {regexSummary ? (
                      <p className="text-xs text-gray-700 dark:text-gray-300">{regexSummary}</p>
                    ) : job.result?.error ? (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        Error: {job.result.error}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        No regex stats recorded.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Starter Characters Section */}
        {starterCharacters && starterCharacters.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center mb-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl"></span>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Get Started</h2>
              </div>
              <span className="ml-3 px-3 py-1 text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full">
                Recommended
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Ready-to-use characters you can start chatting with right away
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {starterCharacters.map((character) => (
                <CharacterCard key={character.id} character={character} isStarter={true} />
              ))}
            </div>
          </div>
        )}

        {/* My Characters Section */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">My Characters</h2>
          {myCharacters && myCharacters.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myCharacters.map((character) => (
                <CharacterCard key={character.id} character={character} isStarter={false} />
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700">
              <svg
                className="mx-auto h-12 w-12 text-gray-400 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 mb-4">No characters created yet</p>
              <Link
                href="/dashboard/characters/new"
                className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Create First Character
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
