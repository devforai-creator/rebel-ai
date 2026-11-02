'use client'

import React, { memo, useEffect, useId, useRef, useState } from 'react'
import type { Character } from '@/types/database.types'
import type { ChatAssetData } from '../[id]/utils/types'
import { renderMessageContent } from '../[id]/utils/message-renderer'
import { useChatMetadataViews } from '../[id]/hooks/useChatMetadataViews'
import { resolveNextRuntimeVariables } from '../[id]/hooks/useChatRuntimeVariables'

const EMPTY_ASSETS: ChatAssetData = {
  characterAssets: [],
  assetUrlMap: {},
  imageCommandUrlMap: {},
  moduleRegex: [],
  moduleAssetSummary: [],
}

type Props = {
  content: string | null
  characterName: string
  metadata: Character['metadata']
  assetData?: ChatAssetData | null
  previewKey: string
  index: number
  count: number
  onPrevious: () => void
  onNext: () => void
}

function GreetingNavigation({
  count,
  onPrevious,
  onNext,
}: Pick<Props, 'count' | 'onPrevious' | 'onNext'>) {
  if (count < 2) return null

  return (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        onClick={onPrevious}
        title="이전 인사말"
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        ← 이전
      </button>
      <button
        type="button"
        onClick={onNext}
        title="다음 인사말"
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        다음 →
      </button>
    </div>
  )
}

const GreetingBody = memo(function GreetingBody({
  content,
  characterName,
  metadata,
  assetData,
  previewKey,
}: Pick<Props, 'content' | 'characterName' | 'metadata' | 'assetData' | 'previewKey'>) {
  const [runtimeVariables, setRuntimeVariables] = useState<Record<string, unknown>>({})
  const characterMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null
  const { mergedVariables, uiCard, uiCardRegistry, imageDisplay } = useChatMetadataViews(
    { name: characterName, avatar_url: null, metadata: characterMetadata },
    runtimeVariables,
  )
  const assets = assetData ?? EMPTY_ASSETS

  if (!content) {
    return (
      <p className="py-12 text-center text-base text-gray-600 dark:text-gray-300">
        (인사말 없이 시작)
      </p>
    )
  }

  return (
    <div className="min-w-0 text-base leading-relaxed text-gray-900 dark:text-gray-100">
      {assetData === null ? (
        <p role="status" className="mb-4 text-sm text-amber-700 dark:text-amber-300">
          카드와 이미지를 불러오지 못했습니다. 메시지 내용은 아래에서 확인할 수 있습니다.
        </p>
      ) : null}
      <div className="max-w-full overflow-x-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] [&_img]:block [&_img]:h-auto [&_img]:max-w-full">
        {renderMessageContent(
          content,
          assets.characterAssets,
          assets.assetUrlMap,
          assets.imageCommandUrlMap,
          assets.moduleRegex,
          undefined,
          mergedVariables,
          characterName,
          previewKey,
          undefined,
          undefined,
          uiCard,
          uiCardRegistry,
          (type, actionId, payload) => {
            setRuntimeVariables((current) =>
              resolveNextRuntimeVariables(current, type, actionId, payload),
            )
          },
          true,
          imageDisplay,
        )}
      </div>
    </div>
  )
})

export default function GreetingPreview(props: Props) {
  const { content, previewKey, index, count } = props
  const headingId = useId()
  const dialogHeadingId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [expanded, setExpanded] = useState(false)
  const body = (
    <GreetingBody
      key={previewKey}
      content={content}
      characterName={props.characterName}
      metadata={props.metadata}
      assetData={props.assetData}
      previewKey={previewKey}
    />
  )
  const label = `첫 인사 ${count > 1 ? `(${index + 1}/${count})` : ''}`.trim()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!expanded || !dialog) return

    dialog.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
    }
  }, [expanded])

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2
          id={headingId}
          aria-live="polite"
          className="text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          {label}
        </h2>
        <GreetingNavigation {...props} />
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30">
        {!expanded ? (
          <div
            key={previewKey}
            role="region"
            aria-label="첫 인사 미리보기"
            tabIndex={0}
            className="max-h-[55svh] min-h-64 overflow-y-auto p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 sm:p-6"
          >
            {body}
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center text-gray-500">
            크게 보기에서 읽는 중
          </div>
        )}
        {content ? (
          <div className="flex justify-end border-t border-gray-200 px-4 py-2 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded px-2 py-1 text-sm font-medium text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-400"
            >
              크게 보기
            </button>
          </div>
        ) : null}
      </div>
      <dialog
        ref={dialogRef}
        aria-labelledby={dialogHeadingId}
        onClose={() => {
          if (!dialogRef.current?.open) setExpanded(false)
        }}
        className="m-auto h-[90svh] max-h-[90svh] w-[calc(100%-2rem)] max-w-5xl rounded-xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      >
        {expanded ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700 sm:px-6">
              <h2 id={dialogHeadingId} aria-live="polite" className="font-semibold">
                {label} · 크게 보기
              </h2>
              <div className="flex items-center gap-3">
                <GreetingNavigation {...props} />
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-gray-700"
                >
                  닫기
                </button>
              </div>
            </div>
            <div
              key={previewKey}
              tabIndex={0}
              role="region"
              aria-label="첫 인사 전체 보기"
              className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 sm:p-8"
            >
              {body}
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  )
}
