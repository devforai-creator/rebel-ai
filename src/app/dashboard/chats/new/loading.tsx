export default function NewChatLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 animate-pulse">
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <div className="h-5 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-7 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 space-y-6">
          {/* 캐릭터 정보 */}
          <div>
            <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="h-6 w-40 bg-gray-200 dark:bg-gray-600 rounded" />
            </div>
          </div>

          {/* API 키 선택 */}
          <div>
            <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
            <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded-lg" />
          </div>

          {/* 페르소나 선택 */}
          <div>
            <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
            <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded-lg" />
          </div>

          {/* 버튼 */}
          <div className="h-12 w-full bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </main>
    </div>
  )
}
