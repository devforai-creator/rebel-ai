'use client'

interface Props {
  error: Error
  reset: () => void
}

export default function CharactersError({ error, reset }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center space-y-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          캐릭터 목록을 불러오지 못했습니다
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {error.message || '알 수 없는 오류가 발생했습니다.'}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          다시 시도
        </button>
      </div>
    </div>
  )
}
