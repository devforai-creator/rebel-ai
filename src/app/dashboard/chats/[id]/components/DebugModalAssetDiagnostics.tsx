'use client'

import React, { memo, useEffect, useMemo, useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import type { CharacterAsset } from '@/lib/asset-resolver'
import {
  computeClientRenderDiagnostics,
  type DisplayMessage,
  type ModuleRegexEntry,
  type ModuleAssetSummary,
} from '../utils'

interface DebugModalAssetDiagnosticsProps {
  isOpen: boolean
  message: DisplayMessage | null
  moduleRegex?: ModuleRegexEntry[]
  assetUrlMap?: Record<string, string>
  defaultVariables?: Record<string, unknown>
  characterName?: string
  moduleAssetSummary?: ModuleAssetSummary[]
  characterAssetCount?: number
  characterAssets?: CharacterAsset[]
  imageCommandUrlMap?: Record<string, string>
}

export const DebugModalAssetDiagnostics = memo(function DebugModalAssetDiagnostics({
  isOpen,
  message,
  moduleRegex,
  assetUrlMap,
  defaultVariables,
  characterName,
  moduleAssetSummary,
  characterAssetCount,
  characterAssets,
  imageCommandUrlMap,
}: DebugModalAssetDiagnosticsProps) {
  const [showRawUnresolved, setShowRawUnresolved] = useState(false)

  useEffect(() => {
    setShowRawUnresolved(false)
  }, [isOpen, message?.id])

  const renderDiagnostics = useMemo(() => {
    if (!isOpen || !message) return null
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
    return computeClientRenderDiagnostics(
      message.content,
      moduleRegex,
      assetUrlMap,
      screenWidth,
      defaultVariables,
      characterName,
      undefined,
      undefined,
      characterAssets,
      imageCommandUrlMap,
    )
  }, [
    isOpen,
    message,
    moduleRegex,
    assetUrlMap,
    defaultVariables,
    characterName,
    characterAssets,
    imageCommandUrlMap,
  ])

  const renderDiagnosticsJson = useMemo(() => {
    if (!renderDiagnostics) return null
    return JSON.stringify(renderDiagnostics, null, 2)
  }, [renderDiagnostics])

  const assetUrlMapKeys = useMemo(() => Object.keys(assetUrlMap ?? {}), [assetUrlMap])
  const assetUrlMapSample = useMemo(() => assetUrlMapKeys.slice(0, 10), [assetUrlMapKeys])
  const moduleAssetTotal = useMemo(() => {
    return (moduleAssetSummary ?? []).reduce((total, item) => total + item.assetCount, 0)
  }, [moduleAssetSummary])
  const strictUnresolvedTags = renderDiagnostics?.unresolvedImageTags ?? []
  const rawUnresolvedTags = renderDiagnostics?.unresolvedImageTagsRaw ?? []
  const showRawToggle = rawUnresolvedTags.length > strictUnresolvedTags.length
  const activeUnresolvedTags = showRawUnresolved ? rawUnresolvedTags : strictUnresolvedTags
  const unresolvedAssetNames = useMemo(() => {
    const seen = new Set<string>()
    const names: string[] = []
    for (const tag of activeUnresolvedTags) {
      const name = tag.extractedName
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
    return names
  }, [activeUnresolvedTags])

  return (
    <>
      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Asset Diagnostics
        </h4>
        <div className="grid gap-2 text-xs text-gray-700 dark:text-gray-300">
          <div>Character assets: {characterAssetCount ?? 0}</div>
          <div>
            Module assets: {moduleAssetTotal}
            {moduleAssetSummary?.length ? ` across ${moduleAssetSummary.length} modules` : ''}
          </div>
          <div>assetUrlMap keys: {assetUrlMapKeys.length}</div>
        </div>
        {moduleAssetSummary && moduleAssetSummary.length > 0 ? (
          <details className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-300">
              Module asset counts
            </summary>
            <div className="mt-2 space-y-2 text-xs text-gray-700 dark:text-gray-300">
              {moduleAssetSummary.map((summary) => {
                const isMissing =
                  summary.expectedAssetCount > 0 && summary.assetCount < summary.expectedAssetCount
                const label = summary.moduleName || summary.moduleId
                return (
                  <div key={summary.moduleId} className="flex flex-wrap items-center gap-2">
                    <span className={isMissing ? 'text-amber-600' : 'text-gray-700'}>{label}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {summary.assetCount}/{summary.expectedAssetCount}
                    </span>
                    {isMissing && (
                      <span className="text-[11px] text-amber-600">missing assets</span>
                    )}
                  </div>
                )
              })}
            </div>
          </details>
        ) : null}
        {assetUrlMapSample.length > 0 ? (
          <div className="mt-3">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              assetUrlMap sample keys
            </div>
            <pre className="mt-1 whitespace-pre-wrap text-xs font-mono text-gray-800 dark:text-gray-200">
              {assetUrlMapSample.join('\n')}
            </pre>
          </div>
        ) : null}
        {message ? (
          <>
            <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
              Unresolved assets (strict): {strictUnresolvedTags.length}
              {rawUnresolvedTags.length > 0 ? ` · raw: ${rawUnresolvedTags.length}` : ''}
            </div>
            {showRawToggle ? (
              <button
                type="button"
                onClick={() => setShowRawUnresolved((prev) => !prev)}
                className="mt-2 text-[11px] text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
              >
                {showRawUnresolved ? 'Show strict list' : 'Show raw list'}
              </button>
            ) : null}
            {unresolvedAssetNames.length > 0 ? (
              <div className="mt-2">
                <div className="text-[11px] text-amber-600">
                  {showRawUnresolved ? 'Raw unresolved assets' : 'Unresolved assets'}
                </div>
                <pre className="mt-1 whitespace-pre-wrap text-xs font-mono text-gray-800 dark:text-gray-200">
                  {unresolvedAssetNames.join('\n')}
                </pre>
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                No unresolved assets detected in the selected message.
              </div>
            )}
          </>
        ) : (
          <div className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
            No message selected for unresolved asset checks.
          </div>
        )}
      </div>

      {renderDiagnostics?.pipelineTrace?.length ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Pipeline Trace
          </h4>
          <div className="space-y-2">
            {renderDiagnostics.pipelineTrace.map((step, index) => (
              <div
                key={`${step.name}-${index}`}
                className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                  <span className="font-semibold">{step.name}</span>
                  <span>{step.length.toLocaleString()} chars</span>
                  <span className={step.changed ? 'text-amber-600' : 'text-gray-400'}>
                    {step.changed ? 'changed' : 'unchanged'}
                  </span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs font-mono text-gray-800 dark:text-gray-200">
                  {step.preview || '(empty)'}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {renderDiagnostics?.unresolvedImageTags?.length ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Unresolved Image Tags
          </h4>
          <div className="space-y-2">
            {renderDiagnostics.unresolvedImageTags.map((tag, index) => (
              <div
                key={`${tag.extractedName}-${index}`}
                className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-800 dark:text-gray-200"
              >
                <div>original: {tag.original}</div>
                <div>name: {tag.extractedName}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {renderDiagnosticsJson ? (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Render Diagnostics (Client)
            </h4>
            <Button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(renderDiagnosticsJson)
                } catch (error) {
                  console.error('Failed to copy render diagnostics:', error)
                }
              }}
              variant="secondary"
              size="sm"
            >
              Copy JSON
            </Button>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-x-auto">
            <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
              {renderDiagnosticsJson}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  )
})
