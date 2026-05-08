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
  secondaryApiKeyId: 'key-1',
  alternateModelsEnabled: false,
  memoryMode: 'summary_window' as const,
  anthropicBatchModeEnabled: false,
  anthropicBatchModeAvailable: false,
  onSelectApiKey: () => {},
  onSelectSecondaryApiKey: () => {},
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
  it('hides usage controls when usage stats are disabled', () => {
    const html = renderToStaticMarkup(<TokenStatsPanel {...baseProps} usageStatsEnabled={false} />)

    expect(html).not.toContain('Usage')
    expect(html).not.toContain('Loading latest usage')
  })

  it('renders a usage toggle when usage stats are enabled', () => {
    const html = renderToStaticMarkup(<TokenStatsPanel {...baseProps} usageStatsEnabled />)

    expect(html).toContain('Usage')
  })

  it('labels prefix memory as the default user-facing mode', () => {
    const html = renderToStaticMarkup(<TokenStatsPanel {...baseProps} usageStatsEnabled={false} />)

    expect(html).toContain('메모리: Summary')
    expect(html).toContain('메모리: Prefix 기본')
  })

  it('labels memory support tiers for developers', () => {
    const html = renderToStaticMarkup(
      <TokenStatsPanel {...baseProps} usageStatsEnabled={false} isDeveloper />,
    )

    expect(html).toContain('메모리: Summary fallback')
    expect(html).toContain('메모리: Prefix core')
  })
})
