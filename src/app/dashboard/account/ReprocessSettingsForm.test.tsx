import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReprocessSettingsForm from './ReprocessSettingsForm'

vi.mock('./actions', () => ({
  updateReprocessSettings: vi.fn(),
}))

describe('ReprocessSettingsForm', () => {
  it('describes message reprocess as an experimental rewrite path', () => {
    const html = renderToStaticMarkup(
      <ReprocessSettingsForm
        initialPrompt={null}
        initialKeyId={null}
        apiKeys={[
          {
            id: 'key-1',
            key_name: 'Rewrite Key',
            provider: 'openai',
            model_preference: 'gpt-4o-mini',
            service_tier: null,
          },
        ]}
      />,
    )

    expect(html).toContain('Reprocess Prompt')
    expect(html).toContain('Experimental option.')
    expect(html).toContain('outside the supported main chat queue')
    expect(html).toContain('experimental rewrite path')
    expect(html).toContain('for="reprocess_prompt"')
    expect(html).toContain('id="reprocess_prompt"')
    expect(html).toContain('for="reprocess_key_id"')
    expect(html).toContain('id="reprocess_key_id"')
  })
})
