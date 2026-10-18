// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UserDraftModelSettingsForm from './UserDraftModelSettingsForm'
import type { SelectableLlmApiKey } from './options'
import { updateUserDraftModelSettings } from './user-draft-settings-actions'

vi.mock('./user-draft-settings-actions', () => ({ updateUserDraftModelSettings: vi.fn() }))
const keys: SelectableLlmApiKey[] = [
  {
    id: 'google-key',
    key_name: 'Cloud',
    provider: 'google',
    model_preference: 'gemini-4-argon',
    service_tier: null,
  },
  {
    id: 'openai-key',
    key_name: 'OpenAI',
    provider: 'openai',
    model_preference: 'gpt-5.4',
    service_tier: 'standard',
  },
  {
    id: 'local-key',
    key_name: 'Local',
    provider: 'local',
    model_preference: 'local-rp-base',
    service_tier: null,
  },
]
afterEach(cleanup)

describe('UserDraftModelSettingsForm', () => {
  it('keeps the selected default visible after a successful action resets the form', async () => {
    vi.mocked(updateUserDraftModelSettings).mockResolvedValue({ error: null, success: true })
    const { container } = render(
      <UserDraftModelSettingsForm
        initialConfig={{
          apiKeyId: 'google-key',
          modelName: 'gemini-4-argon',
          reasoningEffort: 'low',
          serviceTier: 'flex',
        }}
        apiKeys={keys}
      />,
    )
    fireEvent.change(screen.getByLabelText('대필 모델'), { target: { value: '' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(screen.getByText('대필 모델 설정을 저장했습니다.')).toBeTruthy())
    expect(updateUserDraftModelSettings).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('대필 모델') as HTMLSelectElement).value).toBe('')
    expect(new FormData(container.querySelector('form')!).get('user_draft_api_key_id')).toBe('')
    fireEvent.change(screen.getByLabelText('대필 모델'), {
      target: { value: JSON.stringify(['google-key', 'gemini-4-argon']) },
    })
    expect(screen.queryByText('대필 모델 설정을 저장했습니다.')).toBeNull()
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(screen.getByText('대필 모델 설정을 저장했습니다.')).toBeTruthy())
    expect(updateUserDraftModelSettings).toHaveBeenCalledTimes(2)
  })

  it('shows one selector by default and excludes local models', () => {
    render(<UserDraftModelSettingsForm initialConfig={null} apiKeys={keys} />)
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect((screen.getByLabelText('대필 모델') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByRole('option', { name: /Local/ })).toBeNull()
    expect(screen.queryByLabelText('대필 추론 강도')).toBeNull()
    expect(screen.queryByLabelText('대필 서비스 티어')).toBeNull()
  })

  it('reveals supported controls and resets them when the selected model changes', () => {
    const { container } = render(<UserDraftModelSettingsForm initialConfig={null} apiKeys={keys} />)
    fireEvent.change(screen.getByLabelText('대필 모델'), {
      target: { value: JSON.stringify(['google-key', 'gemini-4-argon']) },
    })
    fireEvent.change(screen.getByLabelText('대필 추론 강도'), { target: { value: 'low' } })
    fireEvent.change(screen.getByLabelText('대필 서비스 티어'), { target: { value: 'flex' } })
    const form = container.querySelector('form')!
    expect(Object.fromEntries(new FormData(form))).toMatchObject({
      user_draft_api_key_id: 'google-key',
      user_draft_model_name: 'gemini-4-argon',
      user_draft_reasoning_effort: 'low',
      user_draft_service_tier: 'flex',
    })
    fireEvent.change(screen.getByLabelText('대필 모델'), {
      target: { value: JSON.stringify(['openai-key', 'gpt-5.4']) },
    })
    expect((screen.getByLabelText('대필 추론 강도') as HTMLSelectElement).value).toBe('default')
    expect((screen.getByLabelText('대필 서비스 티어') as HTMLSelectElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('대필 모델'), { target: { value: '' } })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(new FormData(form).get('user_draft_api_key_id')).toBe('')
  })

  it('offers Luna and keeps legacy OpenAI defaults until an explicit tier is saved', () => {
    const { container } = render(
      <UserDraftModelSettingsForm
        initialConfig={{ apiKeyId: 'openai-key', modelName: 'gpt-6-luna', reasoningEffort: 'low' }}
        apiKeys={[{ ...keys[1], service_tier: 'flex' }]}
      />,
    )
    expect(screen.getByRole('option', { name: /GPT-6 Luna/ })).toBeTruthy()
    const tier = screen.getByLabelText('대필 서비스 티어') as HTMLSelectElement
    expect(tier.value).toBe('')
    expect(screen.getByRole('option', { name: /기존 키 설정.*flex/ })).toBeTruthy()
    fireEvent.change(tier, { target: { value: 'standard' } })
    expect(new FormData(container.querySelector('form')!).get('user_draft_service_tier')).toBe(
      'standard',
    )
    fireEvent.change(tier, { target: { value: '' } })
    expect(new FormData(container.querySelector('form')!).get('user_draft_service_tier')).toBe('')
  })

  it('loads saved preferences and keeps unavailable saved selections visible', () => {
    const view = render(
      <UserDraftModelSettingsForm
        initialConfig={{
          apiKeyId: 'google-key',
          modelName: 'gemini-4-argon',
          reasoningEffort: 'high',
          serviceTier: 'flex',
        }}
        apiKeys={keys}
      />,
    )
    expect((screen.getByLabelText('대필 추론 강도') as HTMLSelectElement).value).toBe('high')
    expect((screen.getByLabelText('대필 서비스 티어') as HTMLSelectElement).value).toBe('flex')
    view.unmount()
    const { container } = render(
      <UserDraftModelSettingsForm
        initialConfig={{ apiKeyId: 'removed-key', modelName: 'gpt-5.4', reasoningEffort: 'low' }}
        apiKeys={keys}
      />,
    )
    expect(screen.getByText('저장된 모델을 사용할 수 없습니다. 다시 선택해주세요.')).toBeTruthy()
    expect(new FormData(container.querySelector('form')!).get('user_draft_api_key_id')).toBe(
      'removed-key',
    )
  })
})
