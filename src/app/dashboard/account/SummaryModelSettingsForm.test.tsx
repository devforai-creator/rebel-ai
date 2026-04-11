import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SummaryModelSettingsForm from './SummaryModelSettingsForm'

vi.mock('./actions', () => ({
  updateSummaryModelPreference: vi.fn(),
}))

describe('SummaryModelSettingsForm', () => {
  it('describes the summary-dedicated model as an advanced option', () => {
    const html = renderToStaticMarkup(
      <SummaryModelSettingsForm
        initialKeyId={null}
        apiKeys={[
          {
            id: 'key-1',
            key_name: 'Budget Summary',
            provider: 'openai',
            model_preference: 'gpt-4o-mini',
            service_tier: null,
          },
        ]}
      />,
    )

    expect(html).toContain('Summary-dedicated API Key')
    expect(html).toContain('Advanced option.')
    expect(html).toContain('Same as chat (default)')
  })
})
