// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SummaryModelSettingsForm from './SummaryModelSettingsForm'
import { updateSummaryModelPreference } from './actions'
import type { SelectableLlmApiKey } from './options'

vi.mock('./actions', () => ({ updateSummaryModelPreference: vi.fn() }))

const apiKeys: SelectableLlmApiKey[] = [
  {
    id: 'deepseek-key',
    key_name: 'DeepSeek',
    provider: 'deepseek',
    model_preference: 'deepseek-v4-flash',
    service_tier: null,
  },
  {
    id: 'openai-key',
    key_name: 'OpenAI',
    provider: 'openai',
    model_preference: 'gpt-4o-mini',
    service_tier: null,
  },
  {
    id: 'google-key',
    key_name: 'Google',
    provider: 'google',
    model_preference: 'gemini-4-argon',
    service_tier: null,
  },
]

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('summary reasoning settings', () => {
  it('loads the saved preference and submits it without resetting the visible selection', async () => {
    vi.mocked(updateSummaryModelPreference).mockResolvedValue({ error: null, success: true })
    const { container } = render(
      <SummaryModelSettingsForm
        initialKeyId="deepseek-key"
        initialModelName="deepseek-v4-flash"
        initialReasoningEffort="low"
        apiKeys={apiKeys}
      />,
    )
    const reasoning = screen.getByLabelText('요약 추론 강도') as HTMLSelectElement
    expect(reasoning.value).toBe('low')
    expect(Array.from(reasoning.options, (option) => option.value)).toEqual([
      'default',
      'none',
      'low',
      'high',
      'max',
    ])
    fireEvent.change(reasoning, { target: { value: 'max' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(screen.getByText('Saved successfully.')).toBeTruthy())
    const submitted = vi.mocked(updateSummaryModelPreference).mock.calls[0][1]
    expect(Object.fromEntries(submitted)).toEqual({
      summary_key_id: 'deepseek-key',
      summary_model_name: 'deepseek-v4-flash',
      summary_reasoning_effort: 'max',
    })
    expect(reasoning.value).toBe('max')
    fireEvent.change(reasoning, { target: { value: 'none' } })
    expect(screen.queryByText('Saved successfully.')).toBeNull()
  })

  it('resets incompatible reasoning when changing models or following the chat model', () => {
    const { container } = render(
      <SummaryModelSettingsForm
        initialKeyId="deepseek-key"
        initialModelName="deepseek-v4-pro"
        initialReasoningEffort="max"
        apiKeys={apiKeys}
      />,
    )
    const selection = screen.getByLabelText('Summary-dedicated Model')
    fireEvent.change(selection, {
      target: { value: JSON.stringify(['google-key', 'gemini-4-argon']) },
    })
    const reasoning = screen.getByLabelText('요약 추론 강도') as HTMLSelectElement
    expect(reasoning.value).toBe('default')
    expect(Array.from(reasoning.options, (option) => option.value)).toEqual([
      'default',
      'low',
      'medium',
      'high',
    ])
    fireEvent.change(selection, {
      target: { value: JSON.stringify(['openai-key', 'gpt-4o-mini']) },
    })
    expect(screen.queryByLabelText('요약 추론 강도')).toBeNull()
    expect(new FormData(container.querySelector('form')!).get('summary_reasoning_effort')).toBe(
      'default',
    )
    fireEvent.change(selection, { target: { value: '' } })
    expect(Object.fromEntries(new FormData(container.querySelector('form')!))).toEqual({
      summary_key_id: '',
      summary_model_name: '',
      summary_reasoning_effort: 'default',
    })
  })

  it('discards unsupported stored reasoning for the selected model', () => {
    render(
      <SummaryModelSettingsForm
        initialKeyId="deepseek-key"
        initialModelName="deepseek-v4-flash"
        initialReasoningEffort="xhigh"
        apiKeys={apiKeys}
      />,
    )
    expect((screen.getByLabelText('요약 추론 강도') as HTMLSelectElement).value).toBe('default')
  })
})
