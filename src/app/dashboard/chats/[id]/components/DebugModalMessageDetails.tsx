'use client'

import React, { memo } from 'react'
import InlineFeedback from '@/app/dashboard/components/InlineFeedback'
import type { DebugInfo } from '../utils'

interface DebugModalMessageDetailsProps {
  debugInfo: DebugInfo | null | undefined
}

export const DebugModalMessageDetails = memo(function DebugModalMessageDetails({
  debugInfo,
}: DebugModalMessageDetailsProps) {
  if (debugInfo === undefined) {
    return (
      <InlineFeedback tone="info" className="py-8 text-center">
        Loading server debug_info...
      </InlineFeedback>
    )
  }

  if (!debugInfo) {
    return (
      <InlineFeedback tone="info" className="py-8 text-center">
        No server debug_info stored (only the newest assistant message retains debug_info).
      </InlineFeedback>
    )
  }

  return (
    <>
      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Sent Prompt</h4>
        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-x-auto">
          <div className="mb-3">
            <div className="text-purple-600 dark:text-purple-400 font-bold mb-1">System:</div>
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
          {debugInfo.fullPrompt?.anthropicConversationMessages ? (
            <div className="mt-3 border-t border-gray-300 dark:border-gray-600 pt-3">
              <div className="text-orange-600 dark:text-orange-400 font-bold mb-1">
                Anthropic Conversation Messages:
              </div>
              <pre className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                {JSON.stringify(debugInfo.fullPrompt.anthropicConversationMessages, null, 2)}
              </pre>
              {debugInfo.fullPrompt.anthropicPlaceholderAdded ? (
                <div className="mt-1 text-xs text-amber-600">
                  ⚠️ User placeholder added for Anthropic user-first requirement
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

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
                  Prompt: {debugInfo.modelConfig?.usage?.promptTokens?.toLocaleString() || 'N/A'}
                </div>
                <div>
                  Completion:{' '}
                  {debugInfo.modelConfig?.usage?.completionTokens?.toLocaleString() || 'N/A'}
                </div>
                <div>
                  Total: {debugInfo.modelConfig?.usage?.totalTokens?.toLocaleString() || 'N/A'}
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
            {debugInfo.anthropicCache ? (
              <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                <div className="font-bold mb-1">Anthropic Cache:</div>
                <div className="ml-4 space-y-1">
                  <div>Enabled: {debugInfo.anthropicCache.enabled ? '✅ Yes' : '❌ No'}</div>
                  <div>TTL: {debugInfo.anthropicCache.ttl || 'N/A'}</div>
                  <div>
                    Estimated Static Prompt Tokens:{' '}
                    {debugInfo.anthropicCache.staticPromptTokens?.toLocaleString() || 'N/A'}
                  </div>
                  <div>
                    Model Min Tokens:{' '}
                    {debugInfo.anthropicCache.minTokens?.toLocaleString() || 'N/A'}
                  </div>
                  <div>
                    Estimated Meets Min:{' '}
                    {debugInfo.anthropicCache.estimatedMeetsMinTokens ? '✅ Yes' : '❌ No'}
                  </div>
                  <div>
                    Dynamic Context Tokens:{' '}
                    {debugInfo.anthropicCache.dynamicContextTokens?.toLocaleString() || '0'}
                  </div>
                  <div>
                    Cache Write Tokens:{' '}
                    {debugInfo.anthropicCache.cacheCreationInputTokens?.toLocaleString() || '0'}
                  </div>
                  <div>
                    Cache Read Tokens:{' '}
                    {debugInfo.anthropicCache.cacheReadInputTokens?.toLocaleString() || '0'}
                  </div>
                </div>
              </div>
            ) : null}
            {debugInfo.googleCache ? (
              <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                <div className="font-bold mb-1">Google Cache:</div>
                <div className="ml-4 space-y-1">
                  <div>
                    Feature Enabled: {debugInfo.googleCache.featureEnabled ? '✅ Yes' : '❌ No'}
                  </div>
                  <div>
                    Cache Created: {debugInfo.googleCache.cacheCreated ? '✅ Yes' : '❌ No'}
                  </div>
                  {debugInfo.googleCache.cacheCreated ? (
                    <>
                      <div>Cache Name: {debugInfo.googleCache.cacheName || 'N/A'}</div>
                      <div>
                        Cached Tokens:{' '}
                        {debugInfo.googleCache.cachedTokenCount?.toLocaleString() || '0'}
                      </div>
                      <div>Expire Time: {debugInfo.googleCache.expireTime || 'N/A'}</div>
                      <div>TTL: {debugInfo.googleCache.actualTtl || 'N/A'}s</div>
                    </>
                  ) : null}
                  {debugInfo.googleCache.error ? (
                    <div className="text-red-500">Error: {debugInfo.googleCache.error}</div>
                  ) : null}
                  <div>
                    Min Tokens Required:{' '}
                    {debugInfo.googleCache.minTokens?.toLocaleString() || 'N/A'}
                  </div>
                  <div>
                    Meets Min Tokens: {debugInfo.googleCache.meetsMinTokens ? '✅ Yes' : '❌ No'}
                  </div>
                </div>
              </div>
            ) : null}
            <div>
              <span className="font-bold">Timestamp:</span> {debugInfo.timestamp}
            </div>
          </div>
        </div>
      </div>

      {debugInfo.actualPayload ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Actual LLM Payload (SSOT)
          </h4>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono">
            <div className="space-y-2 text-gray-800 dark:text-gray-200">
              <div>
                <span className="font-bold">Provider:</span> {debugInfo.actualPayload.provider}
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
                  (msg: { role: string; content: string; cached?: boolean }, idx: number) => (
                    <div key={idx} className="ml-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-600">[{msg.role}]</span>
                        {msg.cached !== undefined ? (
                          <span className={msg.cached ? 'text-green-600' : 'text-gray-400'}>
                            {msg.cached ? '🔒 cached' : '○ not cached'}
                          </span>
                        ) : null}
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
                  Conversation Messages ({debugInfo.actualPayload.conversationMessages?.length || 0}
                  ):
                </div>
                <div className="ml-2 text-gray-500">
                  {debugInfo.actualPayload.conversationMessages
                    ?.slice(0, 5)
                    .map((msg: { role: string; content: string }, idx: number) => (
                      <div key={idx}>
                        [{msg.role}] {msg.content.slice(0, 50)}...
                      </div>
                    ))}
                  {(debugInfo.actualPayload.conversationMessages?.length || 0) > 5 ? (
                    <div className="text-gray-400">
                      ... and {(debugInfo.actualPayload.conversationMessages?.length || 0) - 5} more
                    </div>
                  ) : null}
                </div>
              </div>
              {debugInfo.actualPayload.cache ? (
                <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                  <div className="font-bold mb-1">Cache Info:</div>
                  <div className="ml-2 space-y-1">
                    {debugInfo.actualPayload.cache.cacheName ? (
                      <div>Name: {debugInfo.actualPayload.cache.cacheName}</div>
                    ) : null}
                    {debugInfo.actualPayload.cache.cachedTokenCount !== undefined ? (
                      <div>
                        Cached Tokens:{' '}
                        {debugInfo.actualPayload.cache.cachedTokenCount.toLocaleString()}
                      </div>
                    ) : null}
                    {debugInfo.actualPayload.cache.systemPrompt ? (
                      <div className="text-gray-500">
                        System Prompt:{' '}
                        {debugInfo.actualPayload.cache.systemPrompt.length.toLocaleString()} chars
                      </div>
                    ) : null}
                    {debugInfo.actualPayload.cache.messagesToCache ? (
                      <div>
                        Messages to Cache: {debugInfo.actualPayload.cache.messagesToCache.length}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {debugInfo.rag ? (
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
                <span className="font-bold">Results:</span> {debugInfo.rag.results?.length ?? 0}
              </div>
              {debugInfo.rag.results && debugInfo.rag.results.length > 0 ? (
                <div className="border-t border-gray-300 dark:border-gray-600 pt-2 mt-2">
                  <div className="font-bold mb-2">Retrieved Facts:</div>
                  <div className="space-y-3">
                    {debugInfo.rag.results.map(
                      (
                        result: { seq: string; similarity: number; preview: string },
                        idx: number,
                      ) => (
                        <div key={idx} className="ml-2 p-2 bg-gray-100 dark:bg-gray-800 rounded">
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
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
})
