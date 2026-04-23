import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TranslationModelSettingsForm from './TranslationModelSettingsForm'

vi.mock('./actions', () => ({
  updateTranslationModelPreference: vi.fn(),
}))

describe('TranslationModelSettingsForm', () => {
  it('describes bilingual memory as an experimental option', () => {
    const html = renderToStaticMarkup(
      <TranslationModelSettingsForm
        initialKeyId={null}
        apiKeys={[
          {
            id: 'key-1',
            key_name: 'Cheap Translator',
            provider: 'google',
            model_preference: 'gemini-2.5-flash',
            service_tier: null,
          },
        ]}
      />,
    )

    expect(html).toContain('Translation API Key (Bilingual Memory)')
    expect(html).toContain('Experimental option.')
    expect(html).toContain('may not lower total cost')
    expect(html).toContain('for="translation_key_id"')
    expect(html).toContain('id="translation_key_id"')
  })
})
