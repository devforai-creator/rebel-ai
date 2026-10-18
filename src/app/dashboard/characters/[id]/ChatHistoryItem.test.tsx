// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatHistoryItem from './ChatHistoryItem'

const chat = {
  id: 'room-1',
  title: 'Original',
  is_bookmarked: false,
  created_at: '2026-01-01',
  last_message_at: null,
  recency_at: '2026-01-01',
  lastMessage: null,
}
const props = () => ({
  chat,
  busy: false,
  exporting: false,
  deleting: false,
  onBookmark: vi.fn(),
  onRename: vi.fn().mockResolvedValue({}),
  onExport: vi.fn(),
  onDelete: vi.fn(),
})
afterEach(cleanup)
describe('ChatHistoryItem', () => {
  it('toggles bookmarks with an independent button outside the navigation link', async () => {
    const options = props()
    render(<ChatHistoryItem {...options} />)
    const button = screen.getByRole('button', { name: '북마크: Original' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.closest('a')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    await userEvent.click(button)
    expect(options.onBookmark).toHaveBeenCalledOnce()
  })
  it('saves a trimmed title by Enter and restores focus to the edit button', async () => {
    const user = userEvent.setup()
    const options = props()
    render(<ChatHistoryItem {...options} />)
    const edit = screen.getByRole('button', { name: '제목 변경: Original' })
    await user.click(edit)
    const input = screen.getByRole('textbox', { name: '채팅방 제목' })
    expect(document.activeElement).toBe(input)
    await user.clear(input)
    await user.type(input, '  다른 루트  {Enter}')
    await waitFor(() => expect(options.onRename).toHaveBeenCalledWith('다른 루트'))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(edit)
  })
  it('supports Escape and blocks blank titles without invoking the action', async () => {
    const user = userEvent.setup()
    const options = props()
    render(<ChatHistoryItem {...options} />)
    await user.click(screen.getByRole('button', { name: '제목 변경: Original' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, ' {Enter}')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(options.onRename).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('link', { name: /Original/ })).toBeTruthy()
  })
  it('retains the draft on save failure and prevents duplicate pending saves', async () => {
    const user = userEvent.setup()
    let finish!: (value: { error: string }) => void
    const options = props()
    options.onRename.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<ChatHistoryItem {...options} />)
    await user.click(screen.getByRole('button', { name: '제목 변경: Original' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Keep me{Enter}')
    expect((screen.getByRole('button', { name: '제목 저장' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await user.keyboard('{Enter}')
    finish({ error: 'Save failed' })
    expect(await screen.findByText('Save failed')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Keep me')
    expect(options.onRename).toHaveBeenCalledOnce()
  })

  it('does not submit Enter while composing Korean text', async () => {
    const options = props()
    render(<ChatHistoryItem {...options} />)
    await userEvent.click(screen.getByRole('button', { name: '제목 변경: Original' }))
    expect(
      fireEvent.keyDown(screen.getByRole('textbox'), {
        key: 'Enter',
        isComposing: true,
        keyCode: 229,
      }),
    ).toBe(false)
    expect(options.onRename).not.toHaveBeenCalled()
  })
})
