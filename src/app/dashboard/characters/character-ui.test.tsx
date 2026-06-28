// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import CharacterCard from './CharacterCard'
import CharacterForm from './CharacterForm'
import CharacterImport from './CharacterImport'
import { createCharacter, deleteCharacter, updateCharacter } from './actions'

const { pushMock, refreshMock, toastMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean
  }) => (
    <a
      href={typeof href === 'string' ? href : '#'}
      data-prefetch={prefetch === false ? 'false' : undefined}
      {...props}
    >
      {children}
    </a>
  ),
}))

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}))

vi.mock('sonner', () => ({
  toast: toastMock,
}))

vi.mock('./actions', () => ({
  createCharacter: vi.fn(),
  updateCharacter: vi.fn(),
  deleteCharacter: vi.fn(),
}))

vi.mock('@/hooks/useUserResources', () => ({
  useUserModules: (modules: Array<{ id: string; name: string }>) => ({
    modules,
  }),
}))

describe('CharacterCard', () => {
  it('does not prefetch character detail routes from the character list', () => {
    render(
      <CharacterCard
        character={{
          id: 'char-1',
          name: 'Guide',
          created_at: '2026-04-12T00:00:00.000Z',
          visibility: 'private',
          avatar_url: null,
        }}
      />,
    )

    expect(screen.getByRole('link', { name: /Guide/ }).getAttribute('data-prefetch')).toBe('false')
  })

  it('renders the shared destructive action for deletable characters', () => {
    const html = renderToStaticMarkup(
      <CharacterCard
        character={{
          id: 'char-1',
          name: 'Guide',
          created_at: '2026-04-12T00:00:00.000Z',
          visibility: 'private',
          avatar_url: null,
        }}
      />,
    )

    expect(html).toContain('Delete')
    expect(html).toContain('border-red-300')
  })

  it('confirms deletion and refreshes the character list on success', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteCharacter).mockResolvedValue({ success: true })

    render(
      <CharacterCard
        character={{
          id: 'char-1',
          name: 'Guide',
          created_at: '2026-04-12T00:00:00.000Z',
          visibility: 'private',
          avatar_url: null,
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete character' }))

    await waitFor(() => {
      expect(deleteCharacter).toHaveBeenCalledWith('char-1')
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('CharacterForm', () => {
  it('renders the shared dashed empty-state when no modules are available', () => {
    const html = renderToStaticMarkup(<CharacterForm showResourceSelectors modules={[]} />)

    expect(html).toContain('사용 가능한 모듈이 없습니다.')
    expect(html).toContain('border-dashed')
  })

  it('submits selected modules through the create action', async () => {
    vi.mocked(createCharacter).mockResolvedValue({
      data: {
        name: 'Guide',
        description: '',
        system_prompt: 'prompt',
        greeting_message: '',
        module_ids: 'module-1',
      },
    })

    const { container } = render(
      <CharacterForm
        showResourceSelectors
        modules={[
          { id: 'module-1', name: 'Worldbook' },
          { id: 'module-2', name: 'Image cards' },
        ]}
      />,
    )

    fireEvent.click(screen.getByLabelText('Worldbook'))
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => {
      expect(createCharacter).toHaveBeenCalledTimes(1)
    })

    const submittedFormData = vi.mocked(createCharacter).mock.calls[0][0]
    expect(submittedFormData).toBeInstanceOf(FormData)
    expect((submittedFormData as FormData).get('module_ids')).toBe('module-1')
  })

  it('surfaces update errors and exits the loading state', async () => {
    vi.mocked(updateCharacter).mockResolvedValue({
      error: 'Update failed',
    })

    const { container } = render(
      <CharacterForm
        character={{
          id: 'char-1',
          name: 'Guide',
          description: 'desc',
          system_prompt: 'prompt',
          greeting_message: 'hello',
        }}
        showResourceSelectors={false}
      />,
    )

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => {
      expect(updateCharacter).toHaveBeenCalledWith('char-1', expect.any(FormData))
    })
    expect(await screen.findByText('Update failed')).toBeTruthy()
    expect(screen.getByRole('button', { name: '캐릭터 수정' })).toBeTruthy()
  })
})

describe('CharacterImport', () => {
  it('renders the shared import notes and primary submit action', () => {
    const html = renderToStaticMarkup(<CharacterImport />)

    expect(html).toContain('RBX Import Notes')
    expect(html).toContain('Import RBX')
    expect(html).toContain('bg-blue-600')
  })

  it('routes back to the character list from the cancel action', async () => {
    const user = userEvent.setup()

    render(<CharacterImport />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(pushMock).toHaveBeenCalledWith('/dashboard/characters')
  })

  it('rejects unsupported file types before upload', async () => {
    const { container } = render(<CharacterImport />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, {
      target: {
        files: [new File(['{}'], 'bad.json', { type: 'application/json' })],
      },
    })

    expect(await screen.findByText('Supported files: .rbx only')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Import RBX' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('uploads an RBX package, tracks the background job, and redirects on success', async () => {
    const user = userEvent.setup()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: 'user-1/imports/job-1-guide-export.rbx',
          signedUrl: 'https://storage.test/upload?token=abc',
          token: 'abc',
          uploadTicket: 'ticket-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'job-1', status: 'pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          result: {
            stats: {
              assetsUploaded: 2,
              failedAssets: 1,
              failedAssetSamples: [
                {
                  fileName: 'broken.webp',
                  reason: 'Unsupported format',
                },
              ],
              modulesCreated: 1,
              lorebookEntries: 3,
              moduleAssetsUploaded: 4,
              validationWarnings: ['Missing optional lorebook metadata'],
            },
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<CharacterImport />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(
      input,
      new File(['rbx-data'], 'Guide Export.rbx', {
        type: 'application/octet-stream',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Import RBX' }))

    expect(await screen.findByText('Background import job is in progress.')).toBeTruthy()
    expect(await screen.findByText('Import complete.')).toBeTruthy()
    expect(screen.getByText('Some assets failed to import.')).toBeTruthy()
    expect(screen.getByText('Missing optional lorebook metadata')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(4)

    await waitFor(
      () => {
        expect(pushMock).toHaveBeenCalledWith('/dashboard/characters')
      },
      { timeout: 2500 },
    )
  })

  it('reports polling failures from the background import status check', async () => {
    const user = userEvent.setup()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: 'user-1/imports/job-2-guide.rbx',
          signedUrl: 'https://storage.test/upload?token=def',
          token: 'def',
          uploadTicket: 'ticket-2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobId: 'job-2', status: 'pending' }),
      })
      .mockRejectedValueOnce(new Error('network offline'))
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<CharacterImport />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await user.upload(
      input,
      new File(['rbx-data'], 'Guide.rbx', {
        type: 'application/octet-stream',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Import RBX' }))

    expect(await screen.findByText('Status check failed: network offline')).toBeTruthy()
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
