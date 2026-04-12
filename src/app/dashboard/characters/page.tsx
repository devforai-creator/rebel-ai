import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import EmptyState from '@/app/dashboard/components/EmptyState'
import {
  DashboardCallout,
  DashboardPageShell,
  DashboardSectionHeading,
} from '@/app/dashboard/components/DashboardPageShell'
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
    <DashboardPageShell
      width="wide"
      title="Character Management"
      eyebrow="Library"
      description="Build focused personas, world simulations, and importable packages with a clearer path from browsing to conversation."
      backHref="/dashboard"
      backLabel="Back to Dashboard"
      actions={
        <Link
          href="/dashboard/characters/new"
          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_34px_-18px_rgba(37,99,235,0.78)] transition-colors hover:bg-blue-700"
        >
          + New Character
        </Link>
      }
    >
      <DashboardCallout
        tone="info"
        eyebrow="Entry Paths"
        title="Characters and simulations share one authoring flow"
        description="Create one-on-one personas, broader story worlds, or import RBX packages without switching mental models between pages."
      >
        <ul className="space-y-1">
          <li>
            * <strong>1:1 Character:</strong> Chat with a specific persona
          </li>
          <li>
            * <strong>Simulation:</strong> Build a world with multiple characters and system rules
          </li>
          <li>* All settings remain configurable through the system prompt and linked resources</li>
        </ul>
      </DashboardCallout>

      {activeJobs.length > 0 && (
        <DashboardCallout
          tone="warm"
          eyebrow="Background Jobs"
          title="Processing character imports"
          description="Imported characters may show partial artwork until asset upload completes. The job continues even if you leave this page."
        >
          <ul className="space-y-2">
            {activeJobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-col gap-2 rounded-2xl border border-white/70 bg-white/70 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-950/45 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{job.original_filename}</p>
                  <p className="text-xs opacity-80">
                    Job ID: {job.id.slice(0, 8)}... Started:{' '}
                    {new Date(job.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                  {job.status === 'pending' ? 'Pending' : 'Processing'}
                </span>
              </li>
            ))}
          </ul>
        </DashboardCallout>
      )}

      {recentJobs.length > 0 && (
        <DashboardCallout
          tone="neutral"
          eyebrow="Recent Imports"
          title="Review the latest import outcomes"
          description="Completed jobs stay visible briefly so you can confirm regex cleanup and import results after the redirect finishes."
        >
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
                  className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white/78 px-4 py-3 dark:border-slate-800/80 dark:bg-slate-950/45"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-950 dark:text-slate-100">
                        {job.original_filename}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {new Date(job.created_at).toLocaleString()} · Job ID {job.id.slice(0, 8)}...
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
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
                    <p className="text-xs text-slate-700 dark:text-slate-300">{regexSummary}</p>
                  ) : job.result?.error ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Error: {job.result.error}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No regex stats recorded.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </DashboardCallout>
      )}

      {starterCharacters.length > 0 ? (
        <section className="space-y-6">
          <DashboardSectionHeading
            title="Get Started"
            badge="Recommended"
            description="Ready-to-use characters you can open immediately while you shape your own library."
          />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {starterCharacters.map((character) => (
              <CharacterCard key={character.id} character={character} isStarter={true} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-6">
        <DashboardSectionHeading
          title="My Characters"
          description="Your private personas, simulations, and imported packages stay here once they are ready to iterate on."
        />
        {myCharacters && myCharacters.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {myCharacters.map((character) => (
              <CharacterCard key={character.id} character={character} isStarter={false} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No characters yet"
            description="Create your first character or import an RBX package to start building your library."
            action={
              <Link
                href="/dashboard/characters/new"
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_34px_-18px_rgba(37,99,235,0.78)] transition-colors hover:bg-blue-700"
              >
                Create First Character
              </Link>
            }
          />
        )}
      </section>
    </DashboardPageShell>
  )
}
