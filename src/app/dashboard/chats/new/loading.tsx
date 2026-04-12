import LoadingState from '@/app/dashboard/components/LoadingState'

export default function NewChatLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <div className="h-5 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-7 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <LoadingState
          title="Preparing new chat"
          description="Loading the selected character, your API keys, and available personas."
        >
          <div className="space-y-6">
            <div>
              <div className="mb-2 h-4 w-16 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="rounded-lg bg-white p-4 dark:bg-gray-800">
                <div className="h-6 w-40 rounded bg-gray-200 dark:bg-gray-600" />
              </div>
            </div>

            <div>
              <div className="mb-2 h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-10 w-full rounded-lg bg-white dark:bg-gray-800" />
            </div>

            <div>
              <div className="mb-2 h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-10 w-full rounded-lg bg-white dark:bg-gray-800" />
            </div>

            <div className="h-12 w-full rounded-lg bg-white dark:bg-gray-800" />
          </div>
        </LoadingState>
      </main>
    </div>
  )
}
