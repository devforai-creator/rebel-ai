'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import type { CharacterAsset } from '@/lib/asset-resolver'
import {
  computeClientRenderDiagnostics,
  type DebugInfo,
  type DisplayMessage,
  type ModuleRegexEntry,
  type ModuleAssetSummary,
} from '../utils'

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
  const isAssetMode = mode === 'assets'
  const [showRawUnresolved, setShowRawUnresolved] = useState(false)

  useEffect(() => {
    setShowRawUnresolved(false)
  }, [isOpen, mode, message?.id])

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

  if (!isOpen) return null

  const modalTitle = isAssetMode ? 'Asset Diagnostics' : 'Debug Info'

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{modalTitle}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                      summary.expectedAssetCount > 0 &&
                      summary.assetCount < summary.expectedAssetCount
                    const label = summary.moduleName || summary.moduleId
                    return (
                      <div key={summary.moduleId} className="flex flex-wrap items-center gap-2">
                        <span className={isMissing ? 'text-amber-600' : 'text-gray-700'}>
                          {label}
                        </span>
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

          {renderDiagnosticsJson && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Render Diagnostics (Client)
                </h4>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(renderDiagnosticsJson)
                    } catch (error) {
                      console.error('Failed to copy render diagnostics:', error)
                    }
                  }}
                  className="px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                >
                  Copy JSON
                </button>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-x-auto">
                <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {renderDiagnosticsJson}
                </pre>
              </div>
            </div>
          )}

          {!isAssetMode && debugInfo ? (
            <>
              {/* Full Prompt */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Sent Prompt
                </h4>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-x-auto">
                  <div className="mb-3">
                    <div className="text-purple-600 dark:text-purple-400 font-bold mb-1">
                      System:
                    </div>
                    {debugInfo.fullPrompt?.system ? (
                      <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                        {debugInfo.fullPrompt.system}
                      </pre>
                    ) : (
                      <div className="text-red-500 italic text-sm">(Empty system prompt)</div>
                    )}
                  </div>
                  <div>
                    <div className="text-blue-600 dark:text-blue-400 font-bold mb-1">Messages:</div>
                    <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                      {JSON.stringify(debugInfo.fullPrompt?.messages, null, 2)}
                    </pre>
                  </div>
                  {debugInfo.fullPrompt?.anthropicConversationMessages && (
                    <div className="mt-3 border-t border-gray-300 dark:border-gray-600 pt-3">
                      <div className="text-orange-600 dark:text-orange-400 font-bold mb-1">
                        Anthropic Conversation Messages:
                      </div>
                      <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                        {JSON.stringify(
                          debugInfo.fullPrompt.anthropicConversationMessages,
                          null,
                          2,
                        )}
                      </pre>
                      {debugInfo.fullPrompt.anthropicPlaceholderAdded && (
                        <div className="mt-1 text-xs text-amber-600">
                          ⚠️ User placeholder added for Anthropic user-first requirement
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Raw Response */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Raw Response
                </h4>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-x-auto">
                  <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                    {debugInfo.rawResponse || 'N/A'}
                  </pre>
                </div>
              </div>

              {/* Model Config & Tokens */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Model Config & Tokens
                </h4>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono">
                  <div className="space-y-2 text-gray-800 dark:text-gray-200">
                    <div>
                      <span className="font-bold">Provider:</span> {debugInfo.modelConfig?.provider}
                    </div>
                    <div>
                      <span className="font-bold">Model:</span> {debugInfo.modelConfig?.modelName}
                    </div>
                    <div>
                      <span className="font-bold">Finish Reason:</span>{' '}
                      {debugInfo.modelConfig?.finishReason}
                    </div>
                    <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                      <div className="font-bold mb-1">Token Usage:</div>
                      <div className="ml-4">
                        <div>
                          Prompt:{' '}
                          {debugInfo.modelConfig?.usage?.promptTokens?.toLocaleString() || 'N/A'}
                        </div>
                        <div>
                          Completion:{' '}
                          {debugInfo.modelConfig?.usage?.completionTokens?.toLocaleString() ||
                            'N/A'}
                        </div>
                        <div>
                          Total:{' '}
                          {debugInfo.modelConfig?.usage?.totalTokens?.toLocaleString() || 'N/A'}
                        </div>
                        <div>
                          Cached Prompt:{' '}
                          {debugInfo.modelConfig?.usage?.cachedInputTokens?.toLocaleString() ?? '0'}
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                      <div className="font-bold mb-1">Prompt Cache (OpenAI):</div>
                      <div className="ml-4 space-y-1">
                        <div>Key: {debugInfo.promptCache?.key || 'N/A'}</div>
                        <div>Retention: {debugInfo.promptCache?.retention || 'N/A'}</div>
                        <div>
                          Estimated Input:{' '}
                          {debugInfo.promptCache?.totalInputTokens?.toLocaleString() || 'N/A'}
                        </div>
                        <div>Cache Hit: {debugInfo.cacheHit ? '✅ Yes' : '❌ No'}</div>
                      </div>
                    </div>
                    {debugInfo.anthropicCache && (
                      <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                        <div className="font-bold mb-1">Anthropic Cache:</div>
                        <div className="ml-4 space-y-1">
                          <div>
                            Enabled: {debugInfo.anthropicCache.enabled ? '✅ Yes' : '❌ No'}
                          </div>
                          <div>TTL: {debugInfo.anthropicCache.ttl || 'N/A'}</div>
                          <div>
                            Static Prompt Tokens:{' '}
                            {debugInfo.anthropicCache.staticPromptTokens?.toLocaleString() || 'N/A'}
                          </div>
                          <div>
                            Dynamic Context Tokens:{' '}
                            {debugInfo.anthropicCache.dynamicContextTokens?.toLocaleString() || '0'}
                          </div>
                        </div>
                      </div>
                    )}
                    {debugInfo.googleCache && (
                      <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                        <div className="font-bold mb-1">Google Cache:</div>
                        <div className="ml-4 space-y-1">
                          <div>
                            Feature Enabled:{' '}
                            {debugInfo.googleCache.featureEnabled ? '✅ Yes' : '❌ No'}
                          </div>
                          <div>
                            Cache Created: {debugInfo.googleCache.cacheCreated ? '✅ Yes' : '❌ No'}
                          </div>
                          {debugInfo.googleCache.cacheCreated && (
                            <>
                              <div>Cache Name: {debugInfo.googleCache.cacheName || 'N/A'}</div>
                              <div>
                                Cached Tokens:{' '}
                                {debugInfo.googleCache.cachedTokenCount?.toLocaleString() || '0'}
                              </div>
                              <div>Expire Time: {debugInfo.googleCache.expireTime || 'N/A'}</div>
                              <div>TTL: {debugInfo.googleCache.actualTtl || 'N/A'}s</div>
                            </>
                          )}
                          {debugInfo.googleCache.error && (
                            <div className="text-red-500">Error: {debugInfo.googleCache.error}</div>
                          )}
                          <div>
                            Min Tokens Required:{' '}
                            {debugInfo.googleCache.minTokens?.toLocaleString() || 'N/A'}
                          </div>
                          <div>
                            Meets Min Tokens:{' '}
                            {debugInfo.googleCache.meetsMinTokens ? '✅ Yes' : '❌ No'}
                          </div>
                        </div>
                      </div>
                    )}
                    <div>
                      <span className="font-bold">Timestamp:</span> {debugInfo.timestamp}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actual Payload (SSOT) */}
              {debugInfo.actualPayload && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Actual LLM Payload (SSOT)
                  </h4>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono">
                    <div className="space-y-2 text-gray-800 dark:text-gray-200">
                      <div>
                        <span className="font-bold">Provider:</span>{' '}
                        {debugInfo.actualPayload.provider}
                      </div>
                      <div>
                        <span className="font-bold">Strategy:</span>{' '}
                        <span
                          className={
                            debugInfo.actualPayload.strategy === 'google-explicit-cache'
                              ? 'text-blue-600'
                              : debugInfo.actualPayload.strategy === 'anthropic-split-system'
                                ? 'text-purple-600'
                                : 'text-gray-600'
                          }
                        >
                          {debugInfo.actualPayload.strategy}
                        </span>
                      </div>
                      <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                        <div className="font-bold mb-1">
                          System Messages ({debugInfo.actualPayload.systemMessages?.length || 0}):
                        </div>
                        {debugInfo.actualPayload.systemMessages?.map(
                          (
                            msg: { role: string; content: string; cached?: boolean },
                            idx: number,
                          ) => (
                            <div key={idx} className="ml-2 mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-purple-600">[{msg.role}]</span>
                                {msg.cached !== undefined && (
                                  <span className={msg.cached ? 'text-green-600' : 'text-gray-400'}>
                                    {msg.cached ? '🔒 cached' : '○ not cached'}
                                  </span>
                                )}
                              </div>
                              <div className="text-gray-500 text-[10px]">
                                {msg.content.length.toLocaleString()} chars
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                      <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                        <div className="font-bold mb-1">
                          Conversation Messages (
                          {debugInfo.actualPayload.conversationMessages?.length || 0}):
                        </div>
                        <div className="ml-2 text-gray-500">
                          {debugInfo.actualPayload.conversationMessages
                            ?.slice(0, 5)
                            .map((msg: { role: string; content: string }, idx: number) => (
                              <div key={idx}>
                                [{msg.role}] {msg.content.slice(0, 50)}...
                              </div>
                            ))}
                          {(debugInfo.actualPayload.conversationMessages?.length || 0) > 5 && (
                            <div className="text-gray-400">
                              ... and{' '}
                              {(debugInfo.actualPayload.conversationMessages?.length || 0) - 5} more
                            </div>
                          )}
                        </div>
                      </div>
                      {debugInfo.actualPayload.cache && (
                        <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                          <div className="font-bold mb-1">Cache Info:</div>
                          <div className="ml-2 space-y-1">
                            {debugInfo.actualPayload.cache.cacheName && (
                              <div>Name: {debugInfo.actualPayload.cache.cacheName}</div>
                            )}
                            {debugInfo.actualPayload.cache.cachedTokenCount !== undefined && (
                              <div>
                                Cached Tokens:{' '}
                                {debugInfo.actualPayload.cache.cachedTokenCount.toLocaleString()}
                              </div>
                            )}
                            {debugInfo.actualPayload.cache.systemPrompt && (
                              <div className="text-gray-500">
                                System Prompt:{' '}
                                {debugInfo.actualPayload.cache.systemPrompt.length.toLocaleString()}{' '}
                                chars
                              </div>
                            )}
                            {debugInfo.actualPayload.cache.messagesToCache && (
                              <div>
                                Messages to Cache:{' '}
                                {debugInfo.actualPayload.cache.messagesToCache.length}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* RAG (Episodic Memory) */}
              {debugInfo.rag && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    RAG (Episodic Memory)
                  </h4>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono">
                    <div className="space-y-2 text-gray-800 dark:text-gray-200">
                      <div>
                        <span className="font-bold">Enabled:</span>{' '}
                        {debugInfo.rag.enabled ? '✅ Yes' : '❌ No'}
                      </div>
                      <div>
                        <span className="font-bold">Threshold:</span> {debugInfo.rag.threshold}
                      </div>
                      <div>
                        <span className="font-bold">Top-K:</span> {debugInfo.rag.topK}
                      </div>
                      <div>
                        <span className="font-bold">Results:</span>{' '}
                        {debugInfo.rag.results?.length ?? 0}
                      </div>
                      {debugInfo.rag.results && debugInfo.rag.results.length > 0 && (
                        <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                          <div className="font-bold mb-2">Retrieved Facts:</div>
                          <div className="space-y-3">
                            {debugInfo.rag.results.map(
                              (
                                result: { seq: string; similarity: number; preview: string },
                                idx: number,
                              ) => (
                                <div
                                  key={idx}
                                  className="ml-2 p-2 bg-gray-100 dark:bg-gray-800 rounded"
                                >
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-purple-600 dark:text-purple-400">
                                      #{idx + 1} (seq: {result.seq})
                                    </span>
                                    <span
                                      className={`font-bold ${result.similarity >= 0.6 ? 'text-green-600' : result.similarity >= 0.5 ? 'text-yellow-600' : 'text-red-600'}`}
                                    >
                                      {(result.similarity * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                  <pre className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 text-xs">
                                    {result.preview}
                                  </pre>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : !isAssetMode && debugInfo === undefined ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              Loading server debug_info...
            </div>
          ) : !isAssetMode ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              No server debug_info stored (only the newest assistant message retains debug_info).
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
})
