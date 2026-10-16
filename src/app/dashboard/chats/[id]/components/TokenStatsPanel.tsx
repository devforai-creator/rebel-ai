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
  const detailedUsageProvider =
    latestUsage?.provider === 'google' ||
    latestUsage?.provider === 'openai' ||
    latestUsage?.provider === 'deepseek' ||
    latestUsage?.provider === 'openrouter'
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
                {latestUsage && latestUsage.cachedPrompt !== null && (
                  <span>{latestUsage.cacheHit ? '✅' : '❌'}</span>
                )}
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
                      {detailedUsageProvider && (
                        <> | 추론: {formatTokenValue(latestUsage.reasoning)}</>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <span className="text-gray-600 dark:text-gray-400">Cost:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatUsd(latestUsage.costUsd)}
                    </span>
                  </div>
                </div>
                {detailedUsageProvider ? (
                  <TokenUsageDetails usage={latestUsage} />
                ) : latestUsage.provider === 'anthropic' ? (
                  <AnthropicUsageDetails usage={latestUsage} />
                ) : (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                    <div>
                      Cache:{' '}
                      {latestUsage.cachedPrompt === null
                        ? '미확인'
                        : latestUsage.cacheHit
                          ? '✅ Hit'
                          : '❌ Miss'}
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
                    {(latestUsage.callCount ?? 1) > 1 && (
                      <p>과거 대화 조회를 포함한 {latestUsage.callCount}회 호출의 합계입니다.</p>
                    )}
                    {latestUsage.costUsd === null && (
                      <p>사용량 또는 단가 정보가 부족해 비용을 계산할 수 없습니다.</p>
                    )}
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

function TokenUsageDetails({ usage }: { usage: LatestMessageTokenStats }) {
  const openai = usage.provider === 'openai'
  const deepseek = usage.provider === 'deepseek'
  const openrouter = usage.provider === 'openrouter'
  const providerLabel = openai
    ? 'OpenAI'
    : deepseek
      ? 'DeepSeek'
      : openrouter
        ? 'OpenRouter'
        : 'Google'
  const rows = [
    [
      '일반 입력',
      usage.uncachedPrompt,
      openai && !usage.usageBreakdownAvailable ? null : usage.promptCostUsd,
    ],
    ['캐시 읽기', usage.cachedPrompt, usage.cachedPromptCostUsd],
    ...(openai || openrouter
      ? [['캐시 쓰기', usage.cacheWrite, usage.cacheWriteCostUsd] as const]
      : []),
    [
      '출력',
      usage.completion,
      (deepseek || openrouter) && !usage.usageBreakdownAvailable ? null : usage.completionCostUsd,
    ],
    [
      '추론',
      usage.reasoning,
      (deepseek || openrouter) && !usage.usageBreakdownAvailable ? null : usage.reasoningCostUsd,
    ],
  ] as const
  return (
    <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
      <UsageDetailsTable
        label={`${providerLabel} 사용량과 ${openrouter && usage.costSource === 'provider' ? '비용' : '추정 비용'}`}
        rows={rows}
        costLabel={openrouter && usage.costSource === 'provider' ? '세부 비용' : undefined}
      />
      {openrouter && usage.costSource === 'provider' && (
        <p className="mt-1">
          총액은 OpenRouter 응답에 보고된 실제 비용입니다. 항목별 실제 금액은 미확인입니다.
        </p>
      )}
      {openrouter && usage.costSource === 'estimated' && (
        <p className="mt-1">모든 호출의 실제 비용을 받지 못해 공개 단가로 추정한 금액입니다.</p>
      )}
      {deepseek && usage.pricingPeriod && (
        <p className="mt-1">
          요금 시간대:{' '}
          {
            { peak: '혼잡', off_peak: '비혼잡', mixed: '호출별 시간대 혼합', unknown: '미확인' }[
              usage.pricingPeriod
            ]
          }
        </p>
      )}
      {(deepseek || openrouter) &&
      usage.billingModels?.length &&
      (usage.billingModels.length > 1 || usage.billingModels[0] !== usage.modelName) ? (
        <p className="mt-1 break-all">응답 모델: {usage.billingModels.join(', ')}</p>
      ) : null}
      {usage.serviceTier && (
        <p className="mt-1">
          요금:{' '}
          {usage.serviceTier === 'mixed'
            ? '호출별 요금 방식 혼합'
            : usage.serviceTier === 'flex'
              ? 'Flex'
              : usage.serviceTier === 'priority'
                ? 'Fast / Priority'
                : usage.serviceTier === 'batch'
                  ? 'Batch'
                  : usage.serviceTier === 'unknown'
                    ? '미확인'
                    : 'Standard'}
        </p>
      )}
      {(usage.callCount ?? 1) > 1 && (
        <p className="mt-1">과거 대화 조회를 포함한 {usage.callCount}회 호출의 합계입니다.</p>
      )}
      {usage.costUsd === null && (
        <p className="mt-1">사용량 또는 단가 정보가 부족해 비용을 계산할 수 없습니다.</p>
      )}
      {openai && !usage.usageBreakdownAvailable && (
        <p className="mt-1">이전 기록은 캐시 쓰기와 출력의 상세 사용량을 확인할 수 없습니다.</p>
      )}
      {openrouter && !usage.usageBreakdownAvailable && (
        <p className="mt-1">
          이전 기록은 캐시 쓰기와 출력·추론의 상세 사용량을 확인할 수 없습니다.
        </p>
      )}
      {deepseek && !usage.usageBreakdownAvailable && (
        <p className="mt-1">이전 기록은 추론 사용량과 요금 시간대를 확인할 수 없습니다.</p>
      )}
      {(deepseek || openrouter) && usage.usageBreakdownAvailable && usage.reasoning == null && (
        <p className="mt-1">추론 사용량을 받지 못해 출력·추론의 상세 구분은 미확인입니다.</p>
      )}
      <p className="mt-1 text-gray-400 dark:text-gray-500">
        {openrouter
          ? '출력은 추론을 제외한 토큰입니다. 추론은 출력에 한 번만 포함됩니다.'
          : deepseek
            ? '출력은 추론을 제외한 토큰입니다. 추론도 출력 단가로 한 번만 계산합니다. 요금 시간대는 제공자 응답 시각 기준 추정치입니다.'
            : openai
              ? '출력은 추론을 제외한 토큰입니다. 추론도 출력 단가로 계산하며, 합계에 한 번만 포함됩니다. 제공자 사용량과 공개 단가에 따른 추정 비용입니다.'
              : '출력과 추론은 별도 항목이며, 둘 다 합계 비용에 포함됩니다. 생성 요청의 토큰 비용 추정치로, 명시 캐시 보관료는 포함하지 않습니다.'}
      </p>
    </div>
  )
}

type UsageDetailRows = ReadonlyArray<
  readonly [string, number | null | undefined, number | null | undefined]
>

function UsageDetailsTable({
  label,
  rows,
  costLabel = '추정 비용',
}: {
  label: string
  rows: UsageDetailRows
  costLabel?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" aria-label={label}>
        <thead>
          <tr>
            <th className="py-1 font-medium">항목</th>
            <th className="py-1 text-right font-medium">토큰</th>
            <th className="py-1 text-right font-medium">{costLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([title, tokens, cost]) => (
            <tr key={title}>
              <th className="py-1 font-normal" scope="row">
                {title}
              </th>
              <td className="py-1 text-right tabular-nums">{formatTokenValue(tokens)}</td>
              <td className="py-1 text-right tabular-nums">{formatUsd(cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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
      <UsageDetailsTable label="Anthropic 사용량과 추정 비용" rows={rows} />
      {(usage.callCount ?? 1) > 1 && (
        <p className="mt-1">과거 대화 조회를 포함한 {usage.callCount}회 호출의 합계입니다.</p>
      )}
      {!usage.usageBreakdownAvailable && (
        <p className="mt-1">이전 기록은 일반 입력과 캐시 쓰기의 상세 비용을 구분할 수 없습니다.</p>
      )}
      {usage.costUsd === null && (
        <p className="mt-1">사용량 또는 단가 정보가 부족해 비용을 계산할 수 없습니다.</p>
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
