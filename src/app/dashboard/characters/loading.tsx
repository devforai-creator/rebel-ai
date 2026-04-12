import LoadingState from '@/app/dashboard/components/LoadingState'

export default function CharactersLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <LoadingState
          title="Loading characters"
          description="Preparing your character library, starter picks, and recent import activity."
        >
          <div className="space-y-6">
            <div className="h-28 rounded-lg bg-white dark:bg-gray-800" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-56 rounded-lg bg-white dark:bg-gray-800" />
              ))}
            </div>
          </div>
        </LoadingState>
      </main>
    </div>
  )
}
