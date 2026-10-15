// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TokenStatsPanel } from './TokenStatsPanel'

afterEach(cleanup)

describe('chat model options', () => {
  it('discloses controls on demand, only offers supported reasoning, and forwards the selected model', () => {
    const onSelectReasoning = vi.fn()
    const onSelectServiceTier = vi.fn()
    render(
      <TokenStatsPanel
        apiKeys={[
          {
            id: 'key',
            key_name: 'Google',
            provider: 'google',
            model_preference: 'gemini-4-argon',
            service_tier: 'standard',
          },
        ]}
        selectedApiKeyId="key"
        selectedModelName="gemini-4-argon"
        secondaryApiKeyId="key"
        secondaryModelName="gemini-3.8-flash"
        alternateModelsEnabled={false}
        memoryMode="summary_window"
        anthropicBatchModeEnabled={false}
        anthropicBatchModeAvailable={false}
        onSelectPrimaryModel={vi.fn()}
        onSelectSecondaryModel={vi.fn()}
        onToggleAlternateModels={vi.fn()}
        onSelectMemoryMode={vi.fn()}
        onToggleAnthropicBatchMode={vi.fn()}
        latestUsage={null}
        usageStatsEnabled={false}
        usageStatsLoading={false}
        statsExpanded={false}
        onToggleStats={vi.fn()}
        isDeveloper={false}
        developerMode={false}
        onToggleDeveloperMode={vi.fn()}
        onOpenAssetDiagnostics={vi.fn()}
        resolveModelReasoning={() => 'default'}
        onSelectReasoning={onSelectReasoning}
        resolveModelServiceTier={() => 'standard'}
        onSelectServiceTier={onSelectServiceTier}
      />,
    )
    const toggle = screen.getByRole('button', { name: /모델 옵션/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('combobox', { name: /사용 모델 추론/ })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const tier = screen.getByRole('combobox', { name: /사용 모델 요금 방식/ })
    expect(Array.from(tier.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'standard',
      'flex',
    ])
    fireEvent.change(tier, { target: { value: 'flex' } })
    expect(onSelectServiceTier).toHaveBeenCalledWith(
      { apiKeyId: 'key', modelName: 'gemini-4-argon' },
      'flex',
    )
    const reasoning = screen.getByRole('combobox', { name: /사용 모델 추론/ })
    expect(Array.from(reasoning.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'default',
      'low',
      'medium',
      'high',
    ])
    expect(screen.queryByRole('combobox', { name: '보조 모델' })).toBeNull()
    fireEvent.change(reasoning, { target: { value: 'low' } })
    expect(onSelectReasoning).toHaveBeenCalledWith(
      { apiKeyId: 'key', modelName: 'gemini-4-argon' },
      'low',
    )
    fireEvent.click(toggle)
    expect(screen.queryByRole('combobox', { name: /사용 모델 추론/ })).toBeNull()
  })
})
