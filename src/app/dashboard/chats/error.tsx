'use client'

import Button from '@/app/dashboard/components/Button'
import ErrorState from '@/app/dashboard/components/ErrorState'

interface Props {
  error: Error
  reset: () => void
}

export default function ChatsError({ error, reset }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <ErrorState
        className="w-full max-w-md"
        title="채팅 목록을 불러오지 못했습니다"
        description={error.message || '알 수 없는 오류가 발생했습니다.'}
        action={<Button onClick={reset}>다시 시도</Button>}
      />
    </div>
  )
}
