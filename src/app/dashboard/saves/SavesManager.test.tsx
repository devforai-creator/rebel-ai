// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterSave } from '@/types/database.types'
import SavesManager from './SavesManager'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('./actions', () => ({
  createCharacterSave: mocks.create,
  updateCharacterSave: mocks.update,
  deleteCharacterSave: mocks.remove,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))
const characters = [{ id: 'card', name: '테스트 캐릭터' }]
const personas = [{ id: 'persona', name: '테스트 페르소나' }]
const save: CharacterSave = {
  id: 'save',
  user_id: 'me',
  character_id: null,
  default_persona_id: null,
  title: '지난 이야기',
  content: '정확한 약속',
  created_at: '2026-10-26',
  updated_at: '2026-10-26',
}
const props = {
  saves: [save],
  selectedSave: save,
  characters,
  personas,
  characterFilter: '',
  returnTo: '/dashboard',
}

describe('manual save editor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('relinks orphaned saves while preserving manually entered canon', async () => {
    mocks.update.mockResolvedValue({ success: true })
    render(<SavesManager {...props} />)
    fireEvent.change(screen.getByLabelText('연결 캐릭터'), { target: { value: 'card' } })
    fireEvent.change(screen.getByLabelText('기본 페르소나'), { target: { value: 'persona' } })
    fireEvent.change(screen.getByLabelText('이어갈 이야기'), {
      target: { value: '  Exact promise.\n\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: '세이브 저장' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('save', {
        title: '지난 이야기',
        content: '  Exact promise.\n\n',
        characterId: 'card',
        defaultPersonaId: 'persona',
      }),
    )
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('keeps the text and shows server errors when a save is busy', async () => {
    mocks.update.mockResolvedValue({ error: '답변이 끝난 후 변경해주세요' })
    render(<SavesManager {...props} />)
    fireEvent.change(screen.getByLabelText('이어갈 이야기'), { target: { value: '새로운 내용' } })
    fireEvent.click(screen.getByRole('button', { name: '세이브 저장' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '답변이 끝난 후 변경해주세요',
    )
    expect((screen.getByLabelText('이어갈 이야기') as HTMLTextAreaElement).value).toBe(
      '새로운 내용',
    )
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('creates a save and opens its editor', async () => {
    mocks.create.mockResolvedValue({ saveId: 'new-save' })
    render(<SavesManager {...props} saves={[]} selectedSave={null} characterFilter="card" />)
    fireEvent.change(screen.getByLabelText('세이브 제목'), { target: { value: '새 모험' } })
    fireEvent.click(screen.getByRole('button', { name: '세이브 저장' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        title: '새 모험',
        content: '',
        characterId: 'card',
        defaultPersonaId: null,
      }),
    )
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('save=new-save'))
  })

  it('deletes only after explicit confirmation and keeps the return context', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.remove.mockResolvedValue({ success: true })
    render(<SavesManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '세이브 삭제' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('save'))
    expect(mocks.push).toHaveBeenCalledWith('/dashboard/saves?returnTo=%2Fdashboard')
    confirm.mockRestore()
  })
})
