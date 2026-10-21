import React from 'react'
import type { UserDraftUsage } from '@/lib/chat/user-draft-contract'

export function UserDraftUsageDetails({ usage }: { usage: UserDraftUsage }) {
  const hitRate =
    usage.inputTokens !== null && usage.inputTokens > 0 && usage.cacheHitTokens !== null
      ? ((usage.cacheHitTokens / usage.inputTokens) * 100).toFixed(1) + '%'
      : '미확인'
  const rows = [
    ['입력 토큰', usage.inputTokens],
    ['캐시 hit 토큰', usage.cacheHitTokens],
    ['캐시 miss 토큰', usage.cacheMissTokens],
    ['출력 토큰 (추론 포함)', usage.outputTokens],
  ] as const

  return (
    <details className="mt-2 text-xs text-gray-500 dark:text-gray-400">
      <summary className="w-fit cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
        대필 사용량 · 캐시 적중률 {hitRate}
      </summary>
      <div className="mt-2 max-w-sm rounded-lg border border-gray-200 p-3 dark:border-gray-600">
        <p className="break-all">
          DeepSeek · {usage.modelName} ·{' '}
          {usage.memoryMode === 'prefix_live_blocks' ? 'Prefix' : 'Summary'}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {rows.map(([label, count]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="text-right tabular-nums">
                {count === null ? '미확인' : count.toLocaleString('en-US')}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2">마지막 대필 요청의 사용량입니다. 새로고침하면 초기화됩니다.</p>
      </div>
    </details>
  )
}
