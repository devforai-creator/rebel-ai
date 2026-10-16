'use client'

import {
  getReasoningControl,
  REASONING_LABELS,
  type ReasoningPreference,
} from '@/lib/llm/reasoning'
import { supportsGoogleFlex, type GoogleServiceTier } from '@/lib/llm/service-tier'
import React, { memo, useId, useState } from 'react'
import Button from '@/app/dashboard/components/Button'
import { formatChatModelOptionLabel } from '../../api-key-options'
import type { ChatMemoryMode } from '@/lib/chat/model-config'
import {
  buildLlmModelOptions,
  parseLlmModelSelection,
  serializeLlmModelSelection,
  type LlmModelSelection,
} from '@/lib/llm/model-selection'
import {
  LatestMessageTokenStats,
  ApiKeyOption,
  formatTokenValue,
  formatUsd,
  formatServiceTierLabel,
} from '../utils'

interface TokenStatsPanelProps {
  resolveModelServiceTier?: (selection: LlmModelSelection) => GoogleServiceTier | undefined
  onSelectServiceTier?: (selection: LlmModelSelection, tier: GoogleServiceTier) => void
  apiKeys: ApiKeyOption[]
  selectedApiKeyId: string
  selectedModelName: string
  resolveModelReasoning?: (selection: LlmModelSelection) => ReasoningPreference | undefined
  onSelectReasoning?: (selection: LlmModelSelection, preference: ReasoningPreference) => void
  secondaryApiKeyId: string
  secondaryModelName: string
  alternateModelsEnabled: boolean
  memoryMode: ChatMemoryMode
  anthropicBatchModeEnabled: boolean
  anthropicBatchModeAvailable: boolean
  onSelectPrimaryModel: (selection: LlmModelSelection) => void
  onSelectSecondaryModel: (selection: LlmModelSelection) => void
  onToggleAlternateModels: () => void
  onSelectMemoryMode: (mode: ChatMemoryMode) => void
  onToggleAnthropicBatchMode: () => void
  latestUsage: LatestMessageTokenStats | null
  usageStatsEnabled: boolean
  usageStatsLoading: boolean
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
  selectedModelName,
  resolveModelReasoning,
  onSelectReasoning,
  resolveModelServiceTier,
  onSelectServiceTier,
  secondaryApiKeyId,
  secondaryModelName,
  alternateModelsEnabled,
  memoryMode,
  anthropicBatchModeEnabled,
  anthropicBatchModeAvailable,
  onSelectPrimaryModel,
  onSelectSecondaryModel,
  onToggleAlternateModels,
  onSelectMemoryMode,
  onToggleAnthropicBatchMode,
  latestUsage,
  usageStatsEnabled,
  usageStatsLoading,
  statsExpanded,
  onToggleStats,
  isDeveloper,
  developerMode,
  onToggleDeveloperMode,
  onOpenAssetDiagnostics,
}: TokenStatsPanelProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsId = useId()
  const modelOptions = buildLlmModelOptions(apiKeys)
  const selectedModelValue = serializeLlmModelSelection({
    apiKeyId: selectedApiKeyId,
    modelName: selectedModelName,
  })
  const secondaryModelValue = serializeLlmModelSelection({
    apiKeyId: secondaryApiKeyId,
    modelName: secondaryModelName,
  })
  const handleModelChange = (value: string, onChange: (selection: LlmModelSelection) => void) => {
    const selection = parseLlmModelSelection(value)
    if (selection) {
      onChange(selection)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 basis-40 items-center gap-2">
            <span className="sr-only">사용 모델</span>
            <select
              aria-label="사용 모델"
              value={selectedModelValue}
              onChange={(event) => handleModelChange(event.target.value, onSelectPrimaryModel)}
              className="min-w-0 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {formatChatModelOptionLabel(option, {
                    extraProviderDetail:
                      option.credential.provider === 'openai'
                        ? formatServiceTierLabel(option.credential.service_tier)
                        : null,
                  })}
                </option>
              ))}
            </select>
          </label>
          <div className="flex shrink-0 items-center gap-1">
            {usageStatsEnabled && (
              <Button
                type="button"
                onClick={onToggleStats}
                variant="ghost"
                size="sm"
                className="gap-1 px-2 text-xs"
                aria-expanded={statsExpanded}
              >
                <span>
                  {usageStatsLoading
                    ? 'Loading…'
                    : latestUsage
                      ? formatUsd(latestUsage.costUsd)
                      : 'Usage'}
                </span>
                {latestUsage && <span>{latestUsage.cacheHit ? '✅' : '❌'}</span>}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOptionsOpen((open) => !open)}
              aria-expanded={optionsOpen}
              aria-controls={optionsId}
              className="px-2 text-xs"
            >
              모델 옵션 {optionsOpen ? '▴' : '▾'}
            </Button>
          </div>
        </div>
        <div
          id={optionsId}
          hidden={!optionsOpen}
          className="mt-2 border-t border-gray-200 pt-3 dark:border-gray-700"
        >
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <ServiceTierSelect
              label="사용 모델 요금 방식"
              selection={{ apiKeyId: selectedApiKeyId, modelName: selectedModelName }}
              apiKeys={apiKeys}
              resolveModelServiceTier={resolveModelServiceTier}
              onSelectServiceTier={onSelectServiceTier}
            />
            <ReasoningSelect
              label="사용 모델 추론"
              selection={{ apiKeyId: selectedApiKeyId, modelName: selectedModelName }}
              apiKeys={apiKeys}
              resolveModelReasoning={resolveModelReasoning}
              onSelectReasoning={onSelectReasoning}
            />
            <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
              메모리
              <select
                value={memoryMode}
                onChange={(event) => onSelectMemoryMode(event.target.value as ChatMemoryMode)}
                className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="summary_window">
                  {isDeveloper ? '메모리: Summary fallback' : '메모리: Summary'}
                </option>
                <option value="prefix_live_blocks">
                  {isDeveloper ? '메모리: Prefix core' : '메모리: Prefix'}
                </option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={alternateModelsEnabled}
                onChange={onToggleAlternateModels}
                className="h-4 w-4"
              />
              교대 모드
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={anthropicBatchModeEnabled}
                onChange={onToggleAnthropicBatchMode}
                disabled={!anthropicBatchModeAvailable}
                className="h-4 w-4"
              />
              Claude Batch
            </label>
            {alternateModelsEnabled && (
              <>
                <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
                  보조 모델
                  <select
                    value={secondaryModelValue}
                    onChange={(event) =>
                      handleModelChange(event.target.value, onSelectSecondaryModel)
                    }
                    className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  >
                    {modelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {formatChatModelOptionLabel(option, { prefix: '보조' })}
                      </option>
                    ))}
                  </select>
                </label>
                <ServiceTierSelect
                  label="보조 모델 요금 방식"
                  selection={{ apiKeyId: secondaryApiKeyId, modelName: secondaryModelName }}
                  apiKeys={apiKeys}
                  resolveModelServiceTier={resolveModelServiceTier}
                  onSelectServiceTier={onSelectServiceTier}
                />
                <ReasoningSelect
                  label="보조 모델 추론"
                  selection={{ apiKeyId: secondaryApiKeyId, modelName: secondaryModelName }}
                  apiKeys={apiKeys}
                  resolveModelReasoning={resolveModelReasoning}
                  onSelectReasoning={onSelectReasoning}
                />
              </>
            )}
            {isDeveloper && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={developerMode}
                    onChange={onToggleDeveloperMode}
                    className="h-4 w-4"
                  />
                  Dev
                </label>
                {developerMode && (
                  <Button
                    type="button"
                    onClick={onOpenAssetDiagnostics}
                    variant="secondary"
                    size="sm"
                  >
                    에셋
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {usageStatsEnabled && statsExpanded && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-sm">
            {usageStatsLoading && !latestUsage ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading latest usage…</div>
            ) : latestUsage ? (
              <>
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">Tokens:</span>
                    <span className="text-xs text-gray-500">
                      Input: {formatTokenValue(latestUsage.prompt)} | Output:{' '}
                      {formatTokenValue(latestUsage.completion)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">Cost:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatUsd(latestUsage.costUsd)}
                    </span>
                  </div>
                </div>
                {latestUsage.provider === 'anthropic' ? (
                  <AnthropicUsageDetails usage={latestUsage} />
                ) : (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                    <div>
                      Cache: {latestUsage.cacheHit ? '✅ Hit' : '❌ Miss'}
                      {latestUsage.cachedPrompt
                        ? ` (${formatTokenValue(latestUsage.cachedPrompt)} tokens)`
                        : ''}
                    </div>
                    <div>
                      Cost: Input {formatUsd(latestUsage.promptCostUsd)} | Output{' '}
                      {formatUsd(latestUsage.completionCostUsd)} | Cached{' '}
                      {formatUsd(latestUsage.cachedPromptCostUsd)}
                      {latestUsage.reasoningCostUsd
                        ? ` | Reasoning ${formatUsd(latestUsage.reasoningCostUsd)}`
                        : ''}
                    </div>
                    <div className="text-gray-400 dark:text-gray-500 italic">
                      * Estimated. Check your AI provider dashboard for actual charges.
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                No assistant usage has been recorded yet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

function AnthropicUsageDetails({ usage }: { usage: LatestMessageTokenStats }) {
  const rows = [
    [
      '일반 입력',
      usage.uncachedPrompt ?? usage.prompt,
      usage.usageBreakdownAvailable ? usage.promptCostUsd : null,
    ],
    ['캐시 읽기', usage.cachedPrompt, usage.cachedPromptCostUsd],
    ['캐시 쓰기 · 5분', usage.cacheWrite5m, usage.cacheWrite5mCostUsd],
    ['캐시 쓰기 · 1시간', usage.cacheWrite1h, usage.cacheWrite1hCostUsd],
    ['출력', usage.completion, usage.completionCostUsd],
  ] as const
  return (
    <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
      <div className="overflow-x-auto">
        <table className="w-full text-left" aria-label="Anthropic 사용량과 추정 비용">
          <thead>
            <tr>
              <th className="py-1 font-medium">항목</th>
              <th className="py-1 text-right font-medium">토큰</th>
              <th className="py-1 text-right font-medium">추정 비용</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, tokens, cost]) => (
              <tr key={label}>
                <th className="py-1 font-normal" scope="row">
                  {label}
                </th>
                <td className="py-1 text-right tabular-nums">{formatTokenValue(tokens)}</td>
                <td className="py-1 text-right tabular-nums">{formatUsd(cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(usage.callCount ?? 1) > 1 && (
        <p className="mt-1">과거 대화 조회를 포함한 {usage.callCount}회 호출의 합계입니다.</p>
      )}
      {!usage.usageBreakdownAvailable && (
        <p className="mt-1">이전 기록은 일반 입력과 캐시 쓰기의 상세 비용을 구분할 수 없습니다.</p>
      )}
      <p className="mt-1 text-gray-400 dark:text-gray-500">
        제공자 사용량과 공개 단가에 따른 추정 비용입니다. 실제 청구액은 제공자 대시보드에서
        확인해주세요.
      </p>
    </div>
  )
}

function ReasoningSelect({
  label,
  selection,
  apiKeys,
  resolveModelReasoning,
  onSelectReasoning,
}: {
  label: string
  selection: LlmModelSelection
  apiKeys: ApiKeyOption[]
  resolveModelReasoning?: (selection: LlmModelSelection) => ReasoningPreference | undefined
  onSelectReasoning?: (selection: LlmModelSelection, preference: ReasoningPreference) => void
}) {
  const credential = apiKeys.find((key) => key.id === selection.apiKeyId)
  const control = credential
    ? getReasoningControl(credential.provider, selection.modelName)
    : undefined
  if (!control || !onSelectReasoning)
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {label}: 모델의 기본 동작을 사용합니다.
      </p>
    )
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
      {label}
      <select
        aria-label={label}
        value={resolveModelReasoning?.(selection) ?? 'default'}
        onChange={(event) =>
          onSelectReasoning(selection, event.target.value as ReasoningPreference)
        }
        className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      >
        <option value="default">모델 기본값 ({REASONING_LABELS[control.defaultLevel]})</option>
        {control.levels.map((level) => (
          <option key={level} value={level}>
            {REASONING_LABELS[level]}
          </option>
        ))}
      </select>
      <span className="text-gray-500">이 채팅방의 모델별로 저장됩니다.</span>
    </label>
  )
}

function ServiceTierSelect({
  label,
  selection,
  apiKeys,
  resolveModelServiceTier,
  onSelectServiceTier,
}: {
  label: string
  selection: LlmModelSelection
  apiKeys: ApiKeyOption[]
  resolveModelServiceTier?: TokenStatsPanelProps['resolveModelServiceTier']
  onSelectServiceTier?: TokenStatsPanelProps['onSelectServiceTier']
}) {
  const credential = apiKeys.find((key) => key.id === selection.apiKeyId)
  if (
    !credential ||
    !supportsGoogleFlex(credential.provider, selection.modelName) ||
    !onSelectServiceTier
  )
    return null
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
      {label}
      <select
        value={resolveModelServiceTier?.(selection) ?? 'standard'}
        onChange={(event) =>
          onSelectServiceTier(selection, event.target.value as GoogleServiceTier)
        }
        className="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      >
        <option value="standard">Standard (기본 요금)</option>
        <option value="flex">Flex (요금 50% · 느릴 수 있음)</option>
      </select>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        Flex는 최대 12분 대기하며 혼잡하면 실패할 수 있습니다. 실패해도 Standard로 자동 전환하지
        않습니다.
      </span>
    </label>
  )
}
