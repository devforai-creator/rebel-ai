// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatSaveWidget from './ChatSaveWidget'

const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/dashboard/saves/actions', () => ({ updateChatSave: mocks.update }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
const props = {
  chatId: 'chat',
  characterId: 'card',
  currentSaveId: 'first',
  availableSaves: [
    { id: 'first', title: '첫 이야기', character_id: 'card' },
    { id: 'second', title: '다른 이야기', character_id: 'card' },
  ],
}

describe('chat save selection', () => {
  beforeEach(() => vi.clearAllMocks())
  it('attaches another save and refreshes the current server state', async () => {
    mocks.update.mockResolvedValue({ success: true })
    const { container } = render(<ChatSaveWidget {...props} />)
    container.querySelector('details')!.open = true
    await waitFor(() =>
      expect((screen.getByLabelText('이 채팅의 세이브') as HTMLSelectElement).value).toBe('first'),
    )
    fireEvent.change(screen.getByLabelText('이 채팅의 세이브'), { target: { value: 'second' } })
    fireEvent.click(screen.getByRole('button', { name: '연결 적용' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('chat', 'second'))
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('shows a rejected detach without hiding the error', async () => {
    mocks.update.mockResolvedValue({ error: '답변 중에는 변경할 수 없습니다' })
    const { container } = render(<ChatSaveWidget {...props} />)
    container.querySelector('details')!.open = true
    await waitFor(() =>
      expect((screen.getByLabelText('이 채팅의 세이브') as HTMLSelectElement).value).toBe('first'),
    )
    fireEvent.change(screen.getByLabelText('이 채팅의 세이브'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '연결 적용' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '답변 중에는 변경할 수 없습니다',
    )
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
