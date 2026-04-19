import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatUsageSettingsForm from './ChatUsageSettingsForm'

vi.mock('./actions', () => ({
  updateChatUsageSettings: vi.fn(),
}))

describe('ChatUsageSettingsForm', () => {
  it('describes the usage panel as an opt-in setting', () => {
    const html = renderToStaticMarkup(<ChatUsageSettingsForm initialEnabled={false} />)

    expect(html).toContain('Chat Usage Panel')
    expect(html).toContain('Disabled by default')
    expect(html).toContain('main chat path')
  })
})
