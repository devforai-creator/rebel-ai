import { describe, expect, it, vi } from 'vitest'
import {
  buildPendingImportedChat,
  deriveChatImportTitle,
  getChatImportErrorMessage,
  submitChatImport,
} from './chat-import-logic'

describe('chat-import-logic', () => {
  it('derives a default title from compatible export filenames', () => {
    expect(deriveChatImportTitle('hero_chat.json')).toBe('hero')
    expect(deriveChatImportTitle('hero.json')).toBe('hero')
    expect(deriveChatImportTitle('hero transcript')).toBe('hero transcript')
  })

  it('builds pending imported chat state only when a chat id exists', () => {
    expect(buildPendingImportedChat({ chatId: 'chat-1', messageCount: 12 })).toEqual({
      chatId: 'chat-1',
      messageCount: 12,
    })
    expect(buildPendingImportedChat({ messageCount: 12 })).toBeNull()
  })

  it('normalizes unknown import errors to a file-read message', () => {
    expect(getChatImportErrorMessage(new Error('bad file'))).toBe('bad file')
    expect(getChatImportErrorMessage('bad file')).toBe('Failed to read file')
  })

  it('returns a validation error when no file is selected', async () => {
    await expect(
      submitChatImport({
        characterId: 'char-1',
        selectedFile: null,
        chatTitle: '',
        importChatImpl: vi.fn(),
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'Please select a file',
    })
  })

  it('returns import failures and transport failures', async () => {
    const file = {
      name: 'hero_chat.json',
    }

    await expect(
      submitChatImport({
        characterId: 'char-1',
        selectedFile: file,
        chatTitle: 'Imported Chat',
        importChatImpl: vi.fn().mockResolvedValue({
          success: false,
          error: 'invalid export',
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'invalid export',
    })

    await expect(
      submitChatImport({
        characterId: 'char-1',
        selectedFile: {
          name: 'hero_chat.json',
        },
        chatTitle: '',
        importChatImpl: vi.fn().mockRejectedValue(new Error('cannot upload file')),
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'cannot upload file',
    })
  })

  it('returns pending imported chat metadata on success', async () => {
    const importChatImpl = vi.fn().mockResolvedValue({
      success: true,
      chatId: 'chat-1',
      messageCount: 24,
    })

    await expect(
      submitChatImport({
        characterId: 'char-1',
        selectedFile: {
          name: 'hero_chat.json',
        },
        chatTitle: '',
        importChatImpl,
      }),
    ).resolves.toEqual({
      ok: true,
      pendingImportedChat: {
        chatId: 'chat-1',
        messageCount: 24,
      },
    })

    expect(importChatImpl).toHaveBeenCalledWith(
      'char-1',
      {
        name: 'hero_chat.json',
      },
      undefined,
    )
  })
})
