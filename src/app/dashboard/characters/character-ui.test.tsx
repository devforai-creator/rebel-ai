import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CharacterCard from './CharacterCard'
import CharacterForm from './CharacterForm'
import CharacterImport from './CharacterImport'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
  }),
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

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

describe('CharacterCard', () => {
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
})

describe('CharacterForm', () => {
  it('renders the shared dashed empty-state when no modules are available', () => {
    const html = renderToStaticMarkup(<CharacterForm showResourceSelectors modules={[]} />)

    expect(html).toContain('사용 가능한 모듈이 없습니다.')
    expect(html).toContain('border-dashed')
  })
})

describe('CharacterImport', () => {
  it('renders the shared import notes and primary submit action', () => {
    const html = renderToStaticMarkup(<CharacterImport />)

    expect(html).toContain('RBX Import Notes')
    expect(html).toContain('Import RBX')
    expect(html).toContain('bg-blue-600')
  })
})
