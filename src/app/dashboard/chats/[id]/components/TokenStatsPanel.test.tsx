import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TokenStatsPanel } from './TokenStatsPanel'
import type { ApiKeyOption } from '../utils'

const baseProps = {
  apiKeys: [
    {
      id: 'key-1',
      key_name: 'Primary',
      provider: 'openai',
      model_preference: 'gpt-5-mini',
      service_tier: 'standard',
    },
  ] satisfies ApiKeyOption[],
  selectedApiKeyId: 'key-1',
  selectedModelName: 'gpt-5-mini',
  secondaryApiKeyId: 'key-1',
  secondaryModelName: 'gpt-5.6',
  alternateModelsEnabled: false,
  memoryMode: 'summary_window' as const,
  anthropicBatchModeEnabled: false,
  anthropicBatchModeAvailable: false,
  onSelectPrimaryModel: () => {},
  onSelectSecondaryModel: () => {},
  onToggleAlternateModels: () => {},
  onSelectMemoryMode: () => {},
  onToggleAnthropicBatchMode: () => {},
  latestUsage: null,
  usageStatsLoading: false,
  statsExpanded: false,
  onToggleStats: () => {},
  isDeveloper: false,
  developerMode: false,
  onToggleDeveloperMode: () => {},
  onOpenAssetDiagnostics: () => {},
}

describe('TokenStatsPanel', () => {
  it('shows Anthropic input, cache reads and both write durations separately', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel
        {...baseProps}
        usageStatsEnabled
        statsExpanded
        latestUsage={{
          id: 'answer',
          createdAt: null,
          provider: 'anthropic',
          callCount: 2,
          total: 146372,
          prompt: 142244,
          uncachedPrompt: 32691,
          completion: 4128,
          cachedPrompt: 106687,
          cacheWrite5m: 0,
          cacheWrite1h: 2866,
          cacheHit: true,
          cacheKey: null,
          cacheRetention: null,
          costUsd: 0.3486585,
          promptCostUsd: 0.163455,
          completionCostUsd: 0.1032,
          cachedPromptCostUsd: 0.0533435,
          cacheWrite5mCostUsd: 0,
          cacheWrite1hCostUsd: 0.02866,
          reasoningCostUsd: 0,
          usageBreakdownAvailable: true,
        }}
      />,
    )
    for (const value of [
      '일반 입력',
      '캐시 읽기',
      '캐시 쓰기 · 5분',
      '캐시 쓰기 · 1시간',
      '142,244',
      '32,691',
      '106,687',
      '2,866',
      '$0.349',
      '$0.029',
      '2회 호출',
    ])
      expect(html).toContain(value)
  })
  it('keeps the current cost visible when details are collapsed', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel
        {...baseProps}
        usageStatsEnabled
        latestUsage={{
          id: 'answer',
          createdAt: null,
          total: null,
          prompt: 10,
          completion: 2,
          cachedPrompt: 0,
          cacheHit: false,
          cacheKey: null,
          cacheRetention: null,
          costUsd: 0.12,
          promptCostUsd: null,
          completionCostUsd: null,
          cachedPromptCostUsd: null,
          reasoningCostUsd: null,
        }}
      />,
    )
    expect(html).toContain('$0.120')
    expect(html).not.toContain('Anthropic 사용량과 추정 비용')
  })
  it('hides usage controls when usage stats are disabled', () => {
    const html = renderToStaticMarkup(<TokenStatsPanel {...baseProps} usageStatsEnabled={false} />)

    expect(html).not.toContain('Usage')
    expect(html).not.toContain('Loading latest usage')
  })

  it('renders a usage toggle when usage stats are enabled', () => {
    const html = renderToStaticMarkup(<TokenStatsPanel {...baseProps} usageStatsEnabled />)

    expect(html).toContain('Usage')
  })

  it('uses neutral user-facing memory mode labels', () => {
    const html = renderToStaticMarkup(<TokenStatsPanel {...baseProps} usageStatsEnabled={false} />)

    expect(html).toContain('메모리: Summary')
    expect(html).toContain('메모리: Prefix')
    expect(html).not.toContain('메모리: Prefix 기본')
  })

  it('labels memory support tiers for developers', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel {...baseProps} usageStatsEnabled={false} isDeveloper />,
    )

    expect(html).toContain('메모리: Summary fallback')
    expect(html).toContain('메모리: Prefix core')
  })
})
