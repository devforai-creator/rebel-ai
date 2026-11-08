// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateUserDraftModelSettings } from '@/app/dashboard/account/user-draft-settings-actions'
import type { ChatSelectableApiKeyOption } from '@/app/dashboard/chats/api-key-options'
import type { UserDraftModelConfig } from '@/lib/chat/user-draft-model-config'
import { useUserDraftModelPreference } from '../hooks/useUserDraftModelPreference'
import { UserDraftModelPicker } from './UserDraftModelPicker'

vi.mock('@/app/dashboard/account/user-draft-settings-actions', () => ({
  updateUserDraftModelSettings: vi.fn(),
}))

const keys: ChatSelectableApiKeyOption[] = [
  { id: 'google-key', key_name: 'Cloud', provider: 'google', model_preference: 'gemini-4-argon' },
  { id: 'openai-key', key_name: 'OpenAI', provider: 'openai', model_preference: 'gpt-5.4' },
  { id: 'local-key', key_name: 'Local', provider: 'local', model_preference: 'local-rp-base' },
]
const googleValue = JSON.stringify(['google-key', 'gemini-4-argon'])

function Harness({
  savedConfig,
  apiKeys = keys,
  disabled,
}: {
  savedConfig: UserDraftModelConfig | null
  apiKeys?: ChatSelectableApiKeyOption[]
  disabled?: boolean
}) {
  const preference = useUserDraftModelPreference(savedConfig)
  return (
    <>
      <UserDraftModelPicker
        apiKeys={apiKeys}
        config={preference.config}
        disabled={disabled}
        saving={preference.saving}
        onSelect={preference.selectModel}
      />
      {preference.error && <p role="alert">{preference.error}</p>}
    </>
  )
}

function picker() {
  return screen.getByLabelText('대필 모델') as HTMLSelectElement
}

afterEach(() => {
  cleanup()
  vi.mocked(updateUserDraftModelSettings).mockReset()
})

describe('UserDraftModelPicker', () => {
  it('renders nothing without a cloud API key', () => {
    const { container } = render(<Harness savedConfig={null} apiKeys={[keys[2]]} />)
    expect(container.innerHTML).toBe('')
  })

  it('offers the reply-model default and cloud models only', () => {
    render(
      <Harness
        savedConfig={{
          apiKeyId: 'google-key',
          modelName: 'gemini-4-argon',
          reasoningEffort: 'default',
        }}
      />,
    )
    expect(picker().value).toBe(googleValue)
    const labels = Array.from(picker().options).map((option) => option.textContent ?? '')
    expect(labels[0]).toBe('답변 모델과 동일')
    expect(labels.some((label) => label.includes('(local)'))).toBe(false)
    expect(labels.some((label) => label.includes('(google)'))).toBe(true)
    expect(labels.some((label) => label.includes('(openai)'))).toBe(true)
  })

  it('saves the account-wide preference and shows it while pending', async () => {
    let resolve!: (value: { error: string | null; success: boolean }) => void
    vi.mocked(updateUserDraftModelSettings).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    render(<Harness savedConfig={null} />)
    fireEvent.change(picker(), { target: { value: googleValue } })

    await waitFor(() => expect(picker().value).toBe(googleValue))
    expect(picker().disabled).toBe(true)
    const formData = vi.mocked(updateUserDraftModelSettings).mock.calls[0][1]
    expect(formData.get('user_draft_api_key_id')).toBe('google-key')
    expect(formData.get('user_draft_model_name')).toBe('gemini-4-argon')
    expect(formData.get('user_draft_reasoning_effort')).toBeNull()

    await act(async () => resolve({ error: null, success: true }))
  })

  it('clears the preference when the reply-model default is chosen', async () => {
    vi.mocked(updateUserDraftModelSettings).mockResolvedValue({ error: null, success: true })
    render(
      <Harness
        savedConfig={{
          apiKeyId: 'google-key',
          modelName: 'gemini-4-argon',
          reasoningEffort: 'low',
        }}
      />,
    )
    fireEvent.change(picker(), { target: { value: '' } })
    await waitFor(() => expect(updateUserDraftModelSettings).toHaveBeenCalledTimes(1))
    const formData = vi.mocked(updateUserDraftModelSettings).mock.calls[0][1]
    expect(formData.get('user_draft_api_key_id')).toBe('')
    expect(formData.get('user_draft_model_name')).toBe('')
  })

  it('reverts and reports when saving fails', async () => {
    vi.mocked(updateUserDraftModelSettings).mockResolvedValue({
      error: '선택한 API 키 또는 모델을 사용할 수 없습니다.',
      success: false,
    })
    render(<Harness savedConfig={null} />)
    fireEvent.change(picker(), { target: { value: googleValue } })
    expect((await screen.findByRole('alert')).textContent).toBe(
      '선택한 API 키 또는 모델을 사용할 수 없습니다.',
    )
    await waitFor(() => expect(picker().value).toBe(''))
  })

  it('flags a saved model whose key is gone', () => {
    render(
      <Harness
        savedConfig={{ apiKeyId: 'deleted-key', modelName: 'gpt-5.4', reasoningEffort: 'default' }}
      />,
    )
    const stale = Array.from(picker().options).find((option) => option.disabled)
    expect(stale?.textContent).toContain('저장된 모델을 사용할 수 없습니다')
    expect(picker().title).toContain('저장된 모델을 사용할 수 없습니다')
  })

  it('does not save when the current value is re-selected or the picker is disabled', () => {
    render(<Harness savedConfig={null} disabled />)
    expect(picker().disabled).toBe(true)
    fireEvent.change(picker(), { target: { value: '' } })
    expect(updateUserDraftModelSettings).not.toHaveBeenCalled()
  })
})
