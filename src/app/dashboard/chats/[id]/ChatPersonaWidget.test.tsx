// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPersonaWidget from './ChatPersonaWidget'

const refreshMock = vi.fn()
const updatePersonaMock = vi.fn()
const updateChatPersonaMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}))

vi.mock('@/app/dashboard/personas/actions', () => ({
  updatePersona: (...args: unknown[]) => updatePersonaMock(...args),
}))

vi.mock('./actions', () => ({
  updateChatPersona: (...args: unknown[]) => updateChatPersonaMock(...args),
}))

describe('ChatPersonaWidget', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    updatePersonaMock.mockReset()
    updateChatPersonaMock.mockReset()
  })

  it('shows server validation errors when persona editing fails', async () => {
    updatePersonaMock.mockResolvedValue({ error: 'Name cannot be empty' })

    render(
      <ChatPersonaWidget
        chatId="chat-1"
        personaId="persona-1"
        initialName="Existing Persona"
        initialDescription="Existing description"
        availablePersonas={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit persona/i }))
    fireEvent.change(screen.getByLabelText('Persona Name'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updatePersonaMock).toHaveBeenCalledWith('persona-1', {
        name: '   ',
        description: 'Existing description',
      })
    })

    expect(await screen.findByText('Name cannot be empty')).toBeTruthy()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('updates the persona through the shared server action boundary', async () => {
    updatePersonaMock.mockResolvedValue({
      persona: {
        id: 'persona-1',
        name: 'Updated Persona',
        description: 'Updated description',
      },
    })

    render(
      <ChatPersonaWidget
        chatId="chat-1"
        personaId="persona-1"
        initialName="Existing Persona"
        initialDescription="Existing description"
        availablePersonas={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit persona/i }))
    fireEvent.change(screen.getByLabelText('Persona Name'), {
      target: { value: 'Updated Persona' },
    })
    fireEvent.change(screen.getByLabelText('Persona Content (Markdown supported)'), {
      target: { value: 'Updated description' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updatePersonaMock).toHaveBeenCalledWith('persona-1', {
        name: 'Updated Persona',
        description: 'Updated description',
      })
    })

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })

    expect(updateChatPersonaMock).not.toHaveBeenCalled()
  })

  it('selects a persona through the chat action boundary', async () => {
    updateChatPersonaMock.mockResolvedValue({ success: true })

    render(
      <ChatPersonaWidget
        chatId="chat-1"
        personaId={null}
        initialName={null}
        initialDescription={null}
        availablePersonas={[
          { id: 'persona-1', name: 'Scout' },
          { id: 'persona-2', name: 'Guide' },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /select persona/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Scout' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm selection/i }))

    await waitFor(() => {
      expect(updateChatPersonaMock).toHaveBeenCalledWith('chat-1', 'persona-1')
    })

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })

    expect(updatePersonaMock).not.toHaveBeenCalled()
  })
})
