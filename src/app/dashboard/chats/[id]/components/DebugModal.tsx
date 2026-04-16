'use client'

import React, { memo } from 'react'
import Button from '@/app/dashboard/components/Button'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import type { CharacterAsset } from '@/lib/asset-resolver'
import type { DebugInfo, DisplayMessage, ModuleRegexEntry, ModuleAssetSummary } from '../utils'
import { DebugModalAssetDiagnostics } from './DebugModalAssetDiagnostics'
import { DebugModalMessageDetails } from './DebugModalMessageDetails'

interface DebugModalProps {
  isOpen: boolean
  debugInfo: DebugInfo | null | undefined
  message: DisplayMessage | null
  moduleRegex?: ModuleRegexEntry[]
  assetUrlMap?: Record<string, string>
  defaultVariables?: Record<string, unknown>
  characterName?: string
  moduleAssetSummary?: ModuleAssetSummary[]
  characterAssetCount?: number
  characterAssets?: CharacterAsset[]
  imageCommandUrlMap?: Record<string, string>
  mode?: 'message' | 'assets'
  onClose: () => void
}

export const DebugModal = memo(function DebugModal({
  isOpen,
  debugInfo,
  message,
  moduleRegex,
  assetUrlMap,
  defaultVariables,
  characterName,
  moduleAssetSummary,
  characterAssetCount,
  characterAssets,
  imageCommandUrlMap,
  mode = 'message',
  onClose,
}: DebugModalProps) {
  if (!isOpen) return null

  const isAssetMode = mode === 'assets'
  const modalTitle = isAssetMode ? 'Asset Diagnostics' : 'Debug Info'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <SurfaceCard
        padding="none"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden shadow-xl"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{modalTitle}</h3>
          <Button
            onClick={onClose}
            variant="ghost"
            size="icon"
            className="rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <DebugModalAssetDiagnostics
            isOpen={isOpen}
            message={message}
            moduleRegex={moduleRegex}
            assetUrlMap={assetUrlMap}
            defaultVariables={defaultVariables}
            characterName={characterName}
            moduleAssetSummary={moduleAssetSummary}
            characterAssetCount={characterAssetCount}
            characterAssets={characterAssets}
            imageCommandUrlMap={imageCommandUrlMap}
          />

          {!isAssetMode ? <DebugModalMessageDetails debugInfo={debugInfo} /> : null}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <Button onClick={onClose} variant="secondary">
            Close
          </Button>
        </div>
      </SurfaceCard>
    </div>
  )
})
