// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmDialog from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('does not render when closed', () => {
    render(<ConfirmDialog isOpen={false} title="Hidden" onConfirm={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on escape and backdrop clicks', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ConfirmDialog
        isOpen
        title="Delete item?"
        description="This action cannot be undone."
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    await user.click(screen.getByRole('presentation'))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('runs the confirm action with the shared primary tone', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <ConfirmDialog
        isOpen
        title="Open imported chat?"
        tone="primary"
        confirmLabel="Go to chat"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Go to chat' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
