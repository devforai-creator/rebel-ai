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
  it('shows native OpenRouter total with unknown detail costs, visible output, reasoning and ATR calls', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel
        {...baseProps}
        usageStatsEnabled
        statsExpanded
        latestUsage={{
          ...googleUsage,
          provider: 'openrouter',
          serviceTier: null,
          costSource: 'provider',
          costUsd: 0.032,
          completion: 1200,
          cacheWrite: 2000,
          cacheWriteCostUsd: null,
          promptCostUsd: null,
          completionCostUsd: null,
          cachedPromptCostUsd: null,
          reasoningCostUsd: null,
          usageBreakdownAvailable: true,
        }}
      />,
    )
    for (const text of [
      'OpenRouter 사용량과 비용',
      '캐시 쓰기',
      '2,000',
      '1,200',
      '600',
      '2회 호출',
      '$0.032',
      '응답에 보고된 실제 비용',
      '항목별 실제 금액은 미확인',
    ])
      expect(html).toContain(text)
    expect(html).not.toContain('공개 단가로 추정')
    expect(html).not.toContain('$0.0000')
  })
  it('labels the fallback OpenRouter cost as estimated', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel
        {...baseProps}
        usageStatsEnabled
        statsExpanded
        latestUsage={{
          ...googleUsage,
          provider: 'openrouter',
          serviceTier: null,
          costSource: 'estimated',
          usageBreakdownAvailable: true,
        }}
      />,
    )
    expect(html).toContain('공개 단가로 추정한 금액')
    expect(html).not.toContain('응답에 보고된 실제 비용')
  })
  it('shows DeepSeek cache misses, reasoning, response model, and mixed pricing periods without a cache-write row', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel
        {...baseProps}
        usageStatsEnabled
        statsExpanded
        latestUsage={{
          ...googleUsage,
          provider: 'deepseek',
          modelName: 'deepseek-v4-pro',
          billingModels: ['deepseek-flash'],
          serviceTier: null,
          pricingPeriod: 'mixed',
          uncachedPrompt: 5000,
          completion: 1200,
          reasoning: 600,
          cachedPromptCostUsd: 0.000024,
          costUsd: 0.00252,
          usageBreakdownAvailable: true,
        }}
      />,
    )
    for (const text of [
      'DeepSeek 사용량과 추정 비용',
      '일반 입력',
      '5,000',
      '1,200',
      '600',
      '호출별 시간대 혼합',
      '응답 모델: deepseek-flash',
      '$0.000024',
      '2회 호출',
    ])
      expect(html).toContain(text)
    expect(html).not.toContain('캐시 쓰기')
  })
  it('shows OpenAI writes, visible output, reasoning, ATR count, and returned billing mode', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel
        {...baseProps}
        usageStatsEnabled
        statsExpanded
        latestUsage={{
          ...googleUsage,
          provider: 'openai',
          serviceTier: 'priority',
          completion: 1200,
          cacheWrite: 2000,
          cacheWriteCostUsd: 0.005,
          usageBreakdownAvailable: true,
        }}
      />,
    )
    for (const text of [
      'OpenAI 사용량과 추정 비용',
      '캐시 쓰기',
      '2,000',
      '1,200',
      '600',
      'Fast / Priority',
      '2회 호출',
      '한 번만 포함',
    ])
      expect(html).toContain(text)
    expect(html).not.toContain('캐시 쓰기 · 5분')
  })
  const googleUsage = {
    id: 'answer',
    createdAt: null,
    provider: 'google',
    callCount: 2,
    serviceTier: 'flex' as const,
    prompt: 19000,
    uncachedPrompt: 5000,
    completion: 1700,
    reasoning: 600,
    total: 21300,
    cachedPrompt: 14000,
    cacheHit: true,
    cacheKey: null,
    cacheRetention: null,
    costUsd: 0.0172,
    promptCostUsd: 0.005,
    completionCostUsd: 0.0085,
    cachedPromptCostUsd: 0.0007,
    reasoningCostUsd: 0.003,
  }
  it('shows Google visible output and reasoning separately, along with all ATR calls and actual tier', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel {...baseProps} usageStatsEnabled statsExpanded latestUsage={googleUsage} />,
    )
    for (const text of [
      'Google 사용량과 추정 비용',
      '일반 입력',
      '캐시 읽기',
      '추론',
      '5,000',
      '14,000',
      '1,700',
      '600',
      'Flex',
      '2회 호출',
      '$0.017',
    ])
      expect(html).toContain(text)
    expect(html).not.toContain('캐시 쓰기')
  })
  it.each(['google', 'openai', 'deepseek', 'openrouter'])(
    'shows missing %s usage as unknown instead of a zero-dollar price',
    (provider) => {
      const html = renderToStaticMarkup(
        <TokenStatsPanel
          {...baseProps}
          usageStatsEnabled
          statsExpanded
          latestUsage={{
            ...googleUsage,
            provider,
            prompt: null,
            uncachedPrompt: null,
            completion: null,
            reasoning: null,
            cachedPrompt: null,
            costUsd: null,
            promptCostUsd: null,
            completionCostUsd: null,
            cachedPromptCostUsd: null,
            reasoningCostUsd: null,
          }}
        />,
      )
      expect(html).toContain('정보가 부족해 비용을 계산할 수 없습니다')
      expect(html).toContain('—')
      expect(html).not.toContain('$0')
    },
  )
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
