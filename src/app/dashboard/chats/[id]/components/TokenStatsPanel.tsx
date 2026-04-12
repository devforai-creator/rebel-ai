'use client'

import { memo } from 'react'
import Button from '@/app/dashboard/components/Button'
import type { ChatMemoryMode } from '@/lib/chat/model-config'
import {
  LatestMessageTokenStats,
  ApiKeyOption,
  formatTokenValue,
  formatUsd,
  formatServiceTierLabel,
} from '../utils'

interface TokenStatsPanelProps {
  apiKeys: ApiKeyOption[]
  selectedApiKeyId: string
  secondaryApiKeyId: string
  alternateModelsEnabled: boolean
  memoryMode: ChatMemoryMode
  anthropicBatchModeEnabled: boolean
  anthropicBatchModeAvailable: boolean
  onSelectApiKey: (id: string) => void
  onSelectSecondaryApiKey: (id: string) => void
  onToggleAlternateModels: () => void
  onSelectMemoryMode: (mode: ChatMemoryMode) => void
  onToggleAnthropicBatchMode: () => void
  latestUsage: LatestMessageTokenStats | null
  statsExpanded: boolean
  onToggleStats: () => void
  isDeveloper: boolean
  developerMode: boolean
  onToggleDeveloperMode: () => void
  onOpenAssetDiagnostics: () => void
}

export const TokenStatsPanel = memo(function TokenStatsPanel({
  apiKeys,
  selectedApiKeyId,
  secondaryApiKeyId,
  alternateModelsEnabled,
  memoryMode,
  anthropicBatchModeEnabled,
  anthropicBatchModeAvailable,
  onSelectApiKey,
  onSelectSecondaryApiKey,
  onToggleAlternateModels,
  onSelectMemoryMode,
  onToggleAnthropicBatchMode,
  latestUsage,
  statsExpanded,
  onToggleStats,
  isDeveloper,
  developerMode,
  onToggleDeveloperMode,
  onOpenAssetDiagnostics,
}: TokenStatsPanelProps) {
  return (
    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
      <div className="max-w-4xl mx-auto">
        {/* Mobile: API key only */}
        <div className="flex items-center justify-between gap-2 sm:hidden">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <select
              value={selectedApiKeyId}
              onChange={(e) => onSelectApiKey(e.target.value)}
              className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white flex-1 min-w-0"
            >
              {apiKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {key.key_name} ({key.provider})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              {formatUsd(latestUsage?.costUsd)}
            </span>
            <span className="text-gray-400">·</span>
            <span>{latestUsage?.cacheHit ? '✅' : '❌'}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:hidden">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                checked={alternateModelsEnabled}
                onChange={onToggleAlternateModels}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
              />
              교대 모드
            </label>
            <label
              className={`flex items-center gap-2 text-xs ${
                anthropicBatchModeAvailable
                  ? 'text-gray-600 dark:text-gray-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              <input
                type="checkbox"
                checked={anthropicBatchModeEnabled}
                onChange={onToggleAnthropicBatchMode}
                disabled={!anthropicBatchModeAvailable}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
              />
              Claude Batch
            </label>
            {isDeveloper && developerMode && (
              <Button
                type="button"
                onClick={onOpenAssetDiagnostics}
                variant="secondary"
                size="sm"
                className="px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-600 dark:text-amber-200"
              >
                에셋
              </Button>
            )}
          </div>
          <select
            value={memoryMode}
            onChange={(e) => onSelectMemoryMode(e.target.value as ChatMemoryMode)}
            className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="summary_window">
              {isDeveloper ? '메모리: 안전 기본' : '메모리: 기본'}
            </option>
            <option value="prefix_live_blocks">
              {isDeveloper ? '메모리: 운영 기본' : '메모리: Prefix'}
            </option>
          </select>
          <select
            value={secondaryApiKeyId}
            onChange={(e) => onSelectSecondaryApiKey(e.target.value)}
            className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            {apiKeys.map((key) => (
              <option key={key.id} value={key.id}>
                보조: {key.key_name} ({key.provider})
              </option>
            ))}
          </select>
        </div>

        {/* Desktop: Compact display + expandable panel */}
        <div className="hidden sm:block">
          {/* Main row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 dark:text-gray-400">API Key:</label>
              <select
                value={selectedApiKeyId}
                onChange={(e) => onSelectApiKey(e.target.value)}
                className="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white min-w-[220px]"
              >
                {apiKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.key_name} ({key.provider}
                    {key.provider === 'openai'
                      ? ` · ${formatServiceTierLabel(key.service_tier)}`
                      : ''}
                    )
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={alternateModelsEnabled}
                    onChange={onToggleAlternateModels}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  교대
                </label>
                <label
                  className={`flex items-center gap-2 text-xs whitespace-nowrap ${
                    anthropicBatchModeAvailable
                      ? 'text-gray-600 dark:text-gray-400'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                  title="Anthropic Opus 4.5/4.6 only. Sends through Message Batches without streaming."
                >
                  <input
                    type="checkbox"
                    checked={anthropicBatchModeEnabled}
                    onChange={onToggleAnthropicBatchMode}
                    disabled={!anthropicBatchModeAvailable}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                  />
                  Batch
                </label>
                <select
                  value={memoryMode}
                  onChange={(e) => onSelectMemoryMode(e.target.value as ChatMemoryMode)}
                  className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white max-w-[180px]"
                >
                  <option value="summary_window">
                    {isDeveloper ? '안전 기본 메모리' : '기본 메모리'}
                  </option>
                  <option value="prefix_live_blocks">
                    {isDeveloper ? '운영 기본 메모리' : 'Prefix 메모리'}
                  </option>
                </select>
                <select
                  value={secondaryApiKeyId}
                  onChange={(e) => onSelectSecondaryApiKey(e.target.value)}
                  className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white max-w-[220px]"
                >
                  {apiKeys.map((key) => (
                    <option key={key.id} value={key.id}>
                      보조: {key.key_name} ({key.provider}
                      {key.provider === 'openai'
                        ? ` · ${formatServiceTierLabel(key.service_tier)}`
                        : ''}
                      )
                    </option>
                  ))}
                </select>
              </div>
              {/* Summary info (click to expand) */}
              <Button onClick={onToggleStats} variant="ghost" size="sm" className="gap-2 px-2">
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {formatUsd(latestUsage?.costUsd)}
                </span>
                <span className="text-gray-400">·</span>
                <span>{latestUsage?.cacheHit ? '✅' : '❌'}</span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${statsExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </Button>

              {isDeveloper && (
                <div className="flex items-center gap-2 border-l border-gray-300 dark:border-gray-600 pl-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={developerMode}
                      onChange={onToggleDeveloperMode}
                      className="w-3.5 h-3.5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-gray-600 dark:text-gray-400">Dev</span>
                  </label>
                  {developerMode && (
                    <Button
                      type="button"
                      onClick={onOpenAssetDiagnostics}
                      variant="secondary"
                      size="sm"
                      className="px-2 py-0.5 text-[11px] text-amber-700 dark:border-amber-600 dark:text-amber-200"
                    >
                      에셋
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Expanded details */}
          {statsExpanded && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-sm">
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                  <span className="text-gray-600 dark:text-gray-400">Tokens:</span>
                  <span className="text-xs text-gray-500">
                    Input: {formatTokenValue(latestUsage?.prompt)} | Output:{' '}
                    {formatTokenValue(latestUsage?.completion)}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                  <span className="text-gray-600 dark:text-gray-400">Cost:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatUsd(latestUsage?.costUsd)}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <div>
                  Cache: {latestUsage?.cacheHit ? '✅ Hit' : '❌ Miss'}
                  {latestUsage?.cachedPrompt
                    ? ` (${formatTokenValue(latestUsage.cachedPrompt)} tokens)`
                    : ''}
                </div>
                <div>
                  Cost: Input {formatUsd(latestUsage?.promptCostUsd)} | Output{' '}
                  {formatUsd(latestUsage?.completionCostUsd)} | Cached{' '}
                  {formatUsd(latestUsage?.cachedPromptCostUsd)}
                  {latestUsage?.reasoningCostUsd
                    ? ` | Reasoning ${formatUsd(latestUsage?.reasoningCostUsd)}`
                    : ''}
                </div>
                <div className="text-gray-400 dark:text-gray-500 italic">
                  * Estimated. Check your AI provider dashboard for actual charges.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
